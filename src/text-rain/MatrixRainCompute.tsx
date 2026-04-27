/**
 * MatrixRainCompute — WebGPU compute-backed rain simulation.
 *
 * Uses the same rendering approach as MatrixRainShader (instanced column
 * strips + fragment-shader glyph lookup from a state texture) but replaces
 * the CPU stepColumns() loop with a WGSL compute shader.  The simulation
 * state lives entirely on the GPU after initial seeding.
 *
 * Requires WebGPURenderer (`?engine=webgpu`).  Falls back to the shader
 * engine automatically when WebGPU is unavailable.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { MatrixPalette } from './matrix-effects-config'
import { ATLAS_COLS, ATLAS_ROWS, CHAR_COUNT, buildAtlas } from './matrix-atlas'
import { FS, VS } from './matrix-rain-shader.glsl'
import { useFrameRate, type FrameRateQualityTier } from '../../../../src/shared/performance/index.ts'

// ── Constants (match MatrixRainShader) ────────────────────────────
const STREAM_COUNT = 2
const BOOST_STREAM = 1
const MIN_DENSITY_OFFSET = -80
const MAX_DENSITY_OFFSET = 140
const DENSITY_STEP = 40
const PARKED_HEAD = -9999
const COLUMN_HEIGHT = 18
const COLUMN_FIELD_WIDTH = 28
const COLUMN_FIELD_DEPTH = 24
const COLUMN_MIN_WIDTH = 0.1
const COLUMN_MAX_WIDTH = 0.18

const rand = (lo: number, hi: number) => Math.random() * (hi - lo) + lo

// ── WGSL compute shader ──────────────────────────────────────────
const COMPUTE_WGSL = /* wgsl */ `
  // Column state: vec4(head, trail, phase, speed) per entry.
  // Layout: entries 0..cols-1 = stream 0, cols..2*cols-1 = stream 1.
  @group(0) @binding(0) var<storage, read_write> columnState: array<vec4<f32>>;
  @group(0) @binding(1) var<uniform> params: Params;

  struct Params {
    dt: f32,
    rows: f32,
    cols: f32,
    rainBoost: f32,
    boostStarted: f32,
    frame: f32,
  };

  fn hash21(p: vec2<f32>) -> f32 {
    var q = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    q += dot(q, vec3<f32>(q.y, q.z, q.x) + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  fn randRange(seed: vec2<f32>, lo: f32, hi: f32) -> f32 {
    return lo + hash21(seed) * (hi - lo);
  }

  fn randomTrailLength(seed: vec2<f32>) -> f32 {
    return floor(randRange(seed, 22.0, 38.0));
  }

  fn randomSpeed(seed: vec2<f32>) -> f32 {
    return randRange(seed, 10.0, 22.0);
  }

  fn randomResetAfter(seed: vec2<f32>) -> f32 {
    return floor(randRange(seed, 12.0, 28.0));
  }

  fn resetHeadY(trail: f32, seed: vec2<f32>) -> f32 {
    return -trail - floor(randRange(seed, 5.0, 30.0));
  }

  fn seedColumnCompute(index: u32, headY: f32, trail: f32, seed: vec2<f32>) {
    let phase = randRange(seed + vec2<f32>(1.0, 0.0), 0.0, 6.2832);
    let speed = randomSpeed(seed + vec2<f32>(2.0, 0.0));
    columnState[index] = vec4<f32>(headY, trail, phase, speed);
  }

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let col = gid.x;
    let cols = u32(params.cols);
    if (col >= cols) { return; }

    let dt = params.dt;
    let rows = params.rows;
    let frame = params.frame;

    // Process both streams for this column
    for (var stream = 0u; stream < 2u; stream++) {
      let index = stream * cols + col;
      var state = columnState[index];
      var head = state.x;
      var trail = state.y;
      var phase = state.z;
      var speed = state.w;

      let isBoostStream = stream == 1u;
      let parkedHead = -9999.0;

      // Handle boost stream seeding
      if (isBoostStream && params.boostStarted > 0.5) {
        let seed = vec2<f32>(f32(col) + frame * 7.0, f32(stream) + 100.0);
        trail = randomTrailLength(seed);
        head = resetHeadY(trail, seed + vec2<f32>(3.0, 0.0));
        phase = randRange(seed + vec2<f32>(4.0, 0.0), 0.0, 6.2832);
        speed = randomSpeed(seed + vec2<f32>(5.0, 0.0));
      }

      // Skip parked columns
      if (head <= parkedHead + 1.0) {
        columnState[index] = vec4<f32>(head, trail, phase, speed);
        continue;
      }

      // Advance head
      head += speed * dt;

      // Reset check: compute resetAfter from a stable hash
      let resetAfterSeed = vec2<f32>(f32(col) + phase * 10.0, f32(stream) + 50.0);
      let resetAfter = floor(randRange(resetAfterSeed, 12.0, 28.0));

      if (head - trail > rows + resetAfter) {
        if (!isBoostStream || params.rainBoost > 0.5) {
          let seed = vec2<f32>(f32(col) + frame * 13.0, f32(stream) + head);
          trail = randomTrailLength(seed);
          head = resetHeadY(trail, seed + vec2<f32>(3.0, 0.0));
          phase = randRange(seed + vec2<f32>(4.0, 0.0), 0.0, 6.2832);
          speed = randomSpeed(seed + vec2<f32>(5.0, 0.0));
        } else {
          // Park the boost column
          head = parkedHead;
          trail = 0.0;
          phase = 0.0;
          speed = 0.0;
        }
      }

      columnState[index] = vec4<f32>(head, trail, phase, speed);
    }
  }
`

// ── GPU resource management ──────────────────────────────────────

interface GPUResources {
  device: GPUDevice
  stateBuffer: GPUBuffer
  paramsBuffer: GPUBuffer
  readbackBuffer: GPUBuffer
  pipeline: GPUComputePipeline
  bindGroup: GPUBindGroup
  cols: number
}

function getGPUDevice(gl: THREE.WebGLRenderer): GPUDevice | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderer = gl as any
  return renderer?.backend?.device ?? null
}

async function createGPUResources(
  device: GPUDevice,
  cols: number,
  rows: number,
  initialState: Float32Array,
): Promise<GPUResources> {
  const entryCount = cols * STREAM_COUNT
  const stateByteSize = entryCount * 4 * 4 // vec4<f32> per entry

  // State buffer: read_write storage, seeded from CPU; COPY_SRC needed for readback
  const stateBuffer = device.createBuffer({
    size: stateByteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    mappedAtCreation: false,
  })
  device.queue.writeBuffer(stateBuffer, 0, initialState)

  // Persistent readback buffer — reused every frame to avoid per-frame allocation
  const readbackBuffer = device.createBuffer({
    size: stateByteSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })

  // Params uniform buffer
  const paramsBuffer = device.createBuffer({
    size: 6 * 4, // 6 floats
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  const shaderModule = device.createShaderModule({ code: COMPUTE_WGSL })

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  })

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
  })

  const pipeline = await device.createComputePipelineAsync({
    layout: pipelineLayout,
    compute: { module: shaderModule, entryPoint: 'main' },
  })

  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: stateBuffer } },
      { binding: 1, resource: { buffer: paramsBuffer } },
    ],
  })

  return { device, stateBuffer, paramsBuffer, readbackBuffer, pipeline, bindGroup, cols }
}

function dispatchCompute(
  resources: GPUResources,
  dt: number,
  rows: number,
  rainBoost: boolean,
  boostStarted: boolean,
  frame: number,
) {
  const { device, paramsBuffer, pipeline, bindGroup, cols } = resources

  // Upload params
  const paramsData = new Float32Array([
    dt,
    rows,
    cols,
    rainBoost ? 1 : 0,
    boostStarted ? 1 : 0,
    frame,
  ])
  device.queue.writeBuffer(paramsBuffer, 0, paramsData)

  // Dispatch
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bindGroup)
  pass.dispatchWorkgroups(Math.ceil(cols / 64))
  pass.end()
  device.queue.submit([encoder.finish()])
}

// Read state back to CPU for the DataTexture upload.
// In Phase 4 this goes away — the vertex shader reads the storage buffer directly.
async function readStateBack(
  resources: GPUResources,
  target: Float32Array,
) {
  const { device, stateBuffer, readbackBuffer } = resources
  const byteSize = target.byteLength

  const encoder = device.createCommandEncoder()
  encoder.copyBufferToBuffer(stateBuffer, 0, readbackBuffer, 0, byteSize)
  device.queue.submit([encoder.finish()])

  await readbackBuffer.mapAsync(GPUMapMode.READ)
  const mapped = new Float32Array(readbackBuffer.getMappedRange())
  target.set(mapped)
  readbackBuffer.unmap()
}

// ── Geometry / transforms (same as MatrixRainShader) ─────────────

interface ColumnTransform {
  x: number
  z: number
  width: number
}

function createColumnGeometry(cols: number) {
  const geometry = new THREE.PlaneGeometry(1, 1)
  const columnIndexData = new Float32Array(cols)
  for (let i = 0; i < cols; i++) columnIndexData[i] = i
  geometry.setAttribute('aColumnIndex', new THREE.InstancedBufferAttribute(columnIndexData, 1))
  return geometry
}

function getRowsForTier(tier: FrameRateQualityTier) {
  if (tier === 'low') return 90
  if (tier === 'medium') return 125
  return 160
}

function getColumnsForRows(rows: number) {
  return Math.max(80, Math.round(rows * 4.2))
}

function clampDensityOffset(value: number) {
  return Math.min(MAX_DENSITY_OFFSET, Math.max(MIN_DENSITY_OFFSET, value))
}

function createColumnTransforms(cols: number): ColumnTransform[] {
  const transforms: ColumnTransform[] = []
  for (let i = 0; i < cols; i++) {
    const band = i / Math.max(1, cols - 1)
    transforms.push({
      x: (band - 0.5) * COLUMN_FIELD_WIDTH + rand(-0.12, 0.12),
      z: rand(-COLUMN_FIELD_DEPTH / 2, COLUMN_FIELD_DEPTH / 2),
      width: rand(COLUMN_MIN_WIDTH, COLUMN_MAX_WIDTH),
    })
  }
  transforms.sort((a, b) => a.z - b.z)
  return transforms
}

// ── Initial CPU seed (same logic as MatrixRainShader) ────────────

function createInitialStateData(cols: number, rows: number): Float32Array {
  const entryCount = cols * STREAM_COUNT
  const data = new Float32Array(entryCount * 4)

  for (let col = 0; col < cols; col++) {
    // Stream 0: active
    const trail = Math.floor(rand(22, 38))
    const head = Math.floor(rand(-rows * 1.5 - trail, rows + trail))
    const phase = rand(0, Math.PI * 2)
    const speed = rand(10, 22)
    const off0 = col * 4
    data[off0] = head
    data[off0 + 1] = trail
    data[off0 + 2] = phase
    data[off0 + 3] = speed

    // Stream 1: parked
    const off1 = (cols + col) * 4
    data[off1] = PARKED_HEAD
    data[off1 + 1] = 0
    data[off1 + 2] = 0
    data[off1 + 3] = 0
  }

  return data
}

// ── Component ────────────────────────────────────────────────────

interface MatrixRainComputeProps {
  palette: MatrixPalette
  rainBoost?: boolean
  onPerfStats?: (stats: {
    activeColumns: number
    activeInstances: number
    uploadedBytesPerFrame: number
    qualityTier: FrameRateQualityTier
  }) => void
}

export default function MatrixRainCompute({
  palette,
  rainBoost = false,
  onPerfStats,
}: MatrixRainComputeProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const { gl } = useThree()
  const { qualityTier } = useFrameRate()
  const [densityOffset, setDensityOffset] = useState(0)
  const previousBoostRef = useRef(false)
  const frameRef = useRef(0)
  const gpuRef = useRef<GPUResources | null>(null)
  const initRef = useRef(false)

  const grid = useMemo(() => {
    const rows = Math.max(30, getRowsForTier(qualityTier) + Math.round(densityOffset / 4))
    const cols = getColumnsForRows(rows + densityOffset)
    return { cols, rows }
  }, [densityOffset, qualityTier])

  const atlas = useMemo(() => {
    const texture = buildAtlas()
    texture.generateMipmaps = false
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.anisotropy = 1
    texture.needsUpdate = true
    return texture
  }, [])

  const geometry = useMemo(() => createColumnGeometry(grid.cols), [grid.cols])
  const columnTransforms = useMemo(() => createColumnTransforms(grid.cols), [grid.cols])

  // CPU-side state data for initial seeding and DataTexture bridge
  const stateData = useMemo(
    () => createInitialStateData(grid.cols, grid.rows),
    [grid.cols, grid.rows],
  )

  const stateTexture = useMemo(() => {
    const texture = new THREE.DataTexture(
      stateData,
      grid.cols,
      STREAM_COUNT,
      THREE.RGBAFormat,
      THREE.FloatType,
    )
    texture.minFilter = THREE.NearestFilter
    texture.magFilter = THREE.NearestFilter
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.generateMipmaps = false
    texture.needsUpdate = true
    return texture
  }, [stateData, grid.cols])

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VS,
    fragmentShader: FS,
    uniforms: {
      uAtlas: { value: atlas },
      uColumnState: { value: stateTexture },
      uAtlasSize: { value: new THREE.Vector2(ATLAS_COLS, ATLAS_ROWS) },
      uCharCount: { value: CHAR_COUNT },
      uGridCols: { value: grid.cols },
      uGridRows: { value: grid.rows },
      uTime: { value: 0 },
      uHeadColor: { value: new THREE.Color(...palette.headColor) },
      uTrailColor: { value: new THREE.Color(...palette.trailColor) },
      uDimTrailColor: { value: new THREE.Color(...palette.dimTrailColor) },
      uFogColor: { value: new THREE.Color(palette.fog) },
      uWobbleAmp: { value: 0.08 },
      uWobbleFreq: { value: 0.25 },
    },
    transparent: false,
    depthTest: true,
    depthWrite: true,
    blending: THREE.NoBlending,
    side: THREE.DoubleSide,
  }), [atlas, grid.cols, grid.rows, palette, stateTexture])

  // Initialize GPU compute resources
  useEffect(() => {
    const device = getGPUDevice(gl)
    if (!device) return

    let cancelled = false

    createGPUResources(device, grid.cols, grid.rows, stateData).then((resources) => {
      if (cancelled) {
        resources.stateBuffer.destroy()
        resources.paramsBuffer.destroy()
        return
      }
      gpuRef.current = resources
      initRef.current = true
    })

    return () => {
      cancelled = true
      if (gpuRef.current) {
        gpuRef.current.stateBuffer.destroy()
        gpuRef.current.paramsBuffer.destroy()
        gpuRef.current.readbackBuffer.destroy()
        gpuRef.current = null
      }
      initRef.current = false
    }
  }, [gl, grid.cols, grid.rows, stateData])

  // Set up instance matrices
  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return

    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()

    for (let i = 0; i < grid.cols; i++) {
      const t = columnTransforms[i]!
      position.set(t.x, 0, t.z)
      scale.set(t.width, COLUMN_HEIGHT, 1)
      matrix.compose(position, quaternion, scale)
      mesh.setMatrixAt(i, matrix)
    }

    mesh.count = grid.cols
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    mesh.instanceMatrix.needsUpdate = true
  }, [columnTransforms, grid.cols])

  // Sync palette colors
  useEffect(() => {
    material.uniforms.uHeadColor.value.setRGB(...palette.headColor)
    material.uniforms.uTrailColor.value.setRGB(...palette.trailColor)
    material.uniforms.uDimTrailColor.value.setRGB(...palette.dimTrailColor)
    material.uniforms.uFogColor.value.set(palette.fog)
  }, [material, palette])

  // Arrow key density control
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      if (event.key === 'ArrowLeft') {
        setDensityOffset(c => clampDensityOffset(c - DENSITY_STEP))
      } else if (event.key === 'ArrowRight') {
        setDensityOffset(c => clampDensityOffset(c + DENSITY_STEP))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Cleanup
  useEffect(() => () => { atlas.dispose(); geometry.dispose() }, [atlas, geometry])
  useEffect(() => () => { stateTexture.dispose() }, [stateTexture])
  useEffect(() => () => { material.dispose() }, [material])

  useFrame((_, dt) => {
    const cappedDt = Math.min(dt, 1 / 30)
    const boostStarted = rainBoost && !previousBoostRef.current
    previousBoostRef.current = rainBoost
    frameRef.current += 1

    const gpu = gpuRef.current
    if (gpu) {
      // GPU compute path — dispatch simulation, then read back for DataTexture
      dispatchCompute(gpu, cappedDt, grid.rows, rainBoost, boostStarted, frameRef.current)

      // Async readback — updates the DataTexture one frame behind.
      // This is the Phase 2/3 bridge; Phase 4 eliminates this entirely.
      readStateBack(gpu, stateData).then(() => {
        stateTexture.needsUpdate = true
      })

      onPerfStats?.({
        activeColumns: rainBoost ? grid.cols * STREAM_COUNT : grid.cols,
        activeInstances: grid.cols,
        uploadedBytesPerFrame: 0, // compute is GPU-resident
        qualityTier,
      })
    }

    material.uniforms.uTime.value += cappedDt
    material.uniforms.uGridCols.value = grid.cols
    material.uniforms.uGridRows.value = grid.rows
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, grid.cols]}
      frustumCulled={false}
    />
  )
}
