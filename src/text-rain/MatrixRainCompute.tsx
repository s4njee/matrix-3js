/**
 * MatrixRainCompute — WebGPU compute-backed rain simulation.
 *
 * The rain state (head, trail, phase, speed) lives entirely on the GPU as a
 * storage buffer.  Each frame a WGSL compute pass advances the simulation,
 * then `copyBufferToTexture` writes the new state into the same GPUTexture
 * that backs the `uColumnState` sampler used by the fragment shader.  No CPU
 * readback, no per-frame DataTexture upload.
 *
 * Requires the WebGPURenderer (`?engine=webgpu`).  The shader engine remains
 * the portable WebGL fallback.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { MatrixPalette } from './matrix-effects-config'
import { ATLAS_COLS, ATLAS_ROWS, CHAR_COUNT, buildAtlas } from './matrix-atlas'
import { FS, VS } from './matrix-rain-shader.glsl'
import { useFrameRate, type FrameRateQualityTier } from '../../../../src/shared/performance/index.ts'

const STREAM_COUNT = 2
const MIN_DENSITY_OFFSET = -80
const MAX_DENSITY_OFFSET = 140
const DENSITY_STEP = 40
const PARKED_HEAD = -9999
const COLUMN_HEIGHT = 18
const COLUMN_FIELD_WIDTH = 28
const COLUMN_FIELD_DEPTH = 24
const COLUMN_MIN_WIDTH = 0.1
const COLUMN_MAX_WIDTH = 0.18

// WebGPU requires copyBufferToTexture's bytesPerRow to be a multiple of 256
// when the copy spans more than one texture row.  We pad the per-row stride
// of the storage buffer so the same buffer can drive both the compute pass
// and the texture upload without a separate staging copy.
const COPY_BYTES_PER_ROW_ALIGNMENT = 256
const ENTRY_BYTES = 16 // vec4<f32>

const rand = (lo: number, hi: number) => Math.random() * (hi - lo) + lo

function getRowStrideEntries(cols: number) {
  const rowBytes = cols * ENTRY_BYTES
  const paddedBytes = Math.ceil(rowBytes / COPY_BYTES_PER_ROW_ALIGNMENT) * COPY_BYTES_PER_ROW_ALIGNMENT
  return paddedBytes / ENTRY_BYTES
}

// ── WGSL compute shader ──────────────────────────────────────────
const COMPUTE_WGSL = /* wgsl */ `
  @group(0) @binding(0) var<storage, read_write> columnState: array<vec4<f32>>;
  @group(0) @binding(1) var<uniform> params: Params;

  struct Params {
    dt: f32,
    rows: f32,
    cols: f32,
    rainBoost: f32,
    boostStarted: f32,
    frame: f32,
    rowStride: f32,
    pad: f32,
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

  fn resetHeadY(trail: f32, seed: vec2<f32>) -> f32 {
    return -trail - floor(randRange(seed, 5.0, 30.0));
  }

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let col = gid.x;
    let cols = u32(params.cols);
    if (col >= cols) { return; }

    let dt = params.dt;
    let rows = params.rows;
    let frame = params.frame;
    let rowStride = u32(params.rowStride);

    for (var stream = 0u; stream < 2u; stream++) {
      let index = stream * rowStride + col;
      var state = columnState[index];
      var head = state.x;
      var trail = state.y;
      var phase = state.z;
      var speed = state.w;

      let isBoostStream = stream == 1u;
      let parkedHead = -9999.0;

      // Boost just turned on: respawn the boost stream from above-screen.
      if (isBoostStream && params.boostStarted > 0.5) {
        let seed = vec2<f32>(f32(col) + frame * 7.0, f32(stream) + 100.0);
        trail = randomTrailLength(seed);
        head = resetHeadY(trail, seed + vec2<f32>(3.0, 0.0));
        phase = randRange(seed + vec2<f32>(4.0, 0.0), 0.0, 6.2832);
        speed = randomSpeed(seed + vec2<f32>(5.0, 0.0));
      }

      if (head <= parkedHead + 1.0) {
        columnState[index] = vec4<f32>(head, trail, phase, speed);
        continue;
      }

      head += speed * dt;

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
  pipeline: GPUComputePipeline
  bindGroup: GPUBindGroup
  textureGPU: GPUTexture
  cols: number
  rowStrideEntries: number
  bytesPerRow: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRendererBackend(gl: any) {
  return gl?.backend ?? null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getGPUDevice(gl: any): GPUDevice | null {
  return getRendererBackend(gl)?.device ?? null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getTextureGPU(gl: any, texture: THREE.Texture): GPUTexture | null {
  const backend = getRendererBackend(gl)
  if (!backend) return null
  // initTexture forces the backend to allocate the GPUTexture if it doesn't
  // exist yet, so the handle is available before the first render submits.
  if (typeof gl.initTexture === 'function' && gl.hasInitialized?.()) {
    gl.initTexture(texture)
  }
  return backend.get(texture)?.texture ?? null
}

async function createGPUResources(
  device: GPUDevice,
  cols: number,
  textureGPU: GPUTexture,
  initialState: Float32Array,
  rowStrideEntries: number,
): Promise<GPUResources> {
  const bufferEntries = rowStrideEntries * STREAM_COUNT
  const stateByteSize = bufferEntries * ENTRY_BYTES
  const bytesPerRow = rowStrideEntries * ENTRY_BYTES

  const stateBuffer = device.createBuffer({
    size: stateByteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  device.queue.writeBuffer(stateBuffer, 0, initialState as BufferSource)

  const paramsBuffer = device.createBuffer({
    size: 8 * 4,
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

  return {
    device,
    stateBuffer,
    paramsBuffer,
    pipeline,
    bindGroup,
    textureGPU,
    cols,
    rowStrideEntries,
    bytesPerRow,
  }
}

function dispatchComputeAndCopy(
  resources: GPUResources,
  dt: number,
  rows: number,
  rainBoost: boolean,
  boostStarted: boolean,
  frame: number,
) {
  const {
    device, paramsBuffer, pipeline, bindGroup, cols,
    stateBuffer, textureGPU, rowStrideEntries, bytesPerRow,
  } = resources

  const paramsData = new Float32Array([
    dt,
    rows,
    cols,
    rainBoost ? 1 : 0,
    boostStarted ? 1 : 0,
    frame,
    rowStrideEntries,
    0,
  ])
  device.queue.writeBuffer(paramsBuffer, 0, paramsData as BufferSource)

  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bindGroup)
  pass.dispatchWorkgroups(Math.ceil(cols / 64))
  pass.end()

  // GPU-resident handoff: the same buffer the compute pass just wrote
  // becomes the texture the fragment shader samples this frame.
  encoder.copyBufferToTexture(
    { buffer: stateBuffer, bytesPerRow, rowsPerImage: STREAM_COUNT },
    { texture: textureGPU },
    { width: cols, height: STREAM_COUNT, depthOrArrayLayers: 1 },
  )

  device.queue.submit([encoder.finish()])
}

// ── Geometry / transforms ────────────────────────────────────────

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

// ── Initial CPU seed ─────────────────────────────────────────────
//
// Two contiguous arrays:
//   - bufferData: padded layout for the GPU storage buffer.  Stream 1 starts
//     at rowStrideEntries (not cols) so each row is 256-byte-aligned.
//   - textureData: tightly-packed layout for the DataTexture's initial upload
//     (Three.js ignores stride here — the texture is just cols × 2).

interface InitialState {
  bufferData: Float32Array
  textureData: Float32Array
}

function createInitialState(cols: number, rows: number, rowStrideEntries: number): InitialState {
  const bufferData = new Float32Array(rowStrideEntries * STREAM_COUNT * 4)
  const textureData = new Float32Array(cols * STREAM_COUNT * 4)

  for (let col = 0; col < cols; col++) {
    const trail = Math.floor(rand(22, 38))
    const head = Math.floor(rand(-rows * 1.5 - trail, rows + trail))
    const phase = rand(0, Math.PI * 2)
    const speed = rand(10, 22)

    const bufOff0 = col * 4
    bufferData[bufOff0] = head
    bufferData[bufOff0 + 1] = trail
    bufferData[bufOff0 + 2] = phase
    bufferData[bufOff0 + 3] = speed

    const bufOff1 = (rowStrideEntries + col) * 4
    bufferData[bufOff1] = PARKED_HEAD

    const texOff0 = col * 4
    textureData[texOff0] = head
    textureData[texOff0 + 1] = trail
    textureData[texOff0 + 2] = phase
    textureData[texOff0 + 3] = speed

    const texOff1 = (cols + col) * 4
    textureData[texOff1] = PARKED_HEAD
  }

  return { bufferData, textureData }
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

  const initialState = useMemo(
    () => createInitialState(grid.cols, grid.rows, getRowStrideEntries(grid.cols)),
    [grid.cols, grid.rows],
  )

  const stateTexture = useMemo(() => {
    const texture = new THREE.DataTexture(
      initialState.textureData,
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
  }, [initialState, grid.cols])

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

  useEffect(() => {
    const device = getGPUDevice(gl)
    if (!device) return

    let cancelled = false

    const init = async () => {
      // Force Three.js to allocate the texture's backing GPUTexture so we can
      // copy into it directly from the compute storage buffer.
      const textureGPU = getTextureGPU(gl, stateTexture)
      if (!textureGPU) {
        console.warn('MatrixRainCompute: GPUTexture handle unavailable; compute pass disabled.')
        return
      }

      const rowStrideEntries = getRowStrideEntries(grid.cols)
      const resources = await createGPUResources(
        device,
        grid.cols,
        textureGPU,
        initialState.bufferData,
        rowStrideEntries,
      )
      if (cancelled) {
        resources.stateBuffer.destroy()
        resources.paramsBuffer.destroy()
        return
      }
      gpuRef.current = resources
    }

    init()

    return () => {
      cancelled = true
      if (gpuRef.current) {
        gpuRef.current.stateBuffer.destroy()
        gpuRef.current.paramsBuffer.destroy()
        gpuRef.current = null
      }
    }
  }, [gl, grid.cols, grid.rows, initialState, stateTexture])

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

  useEffect(() => {
    material.uniforms.uHeadColor.value.setRGB(...palette.headColor)
    material.uniforms.uTrailColor.value.setRGB(...palette.trailColor)
    material.uniforms.uDimTrailColor.value.setRGB(...palette.dimTrailColor)
    material.uniforms.uFogColor.value.set(palette.fog)
  }, [material, palette])

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
      dispatchComputeAndCopy(gpu, cappedDt, grid.rows, rainBoost, boostStarted, frameRef.current)

      onPerfStats?.({
        activeColumns: rainBoost ? grid.cols * STREAM_COUNT : grid.cols,
        activeInstances: grid.cols,
        uploadedBytesPerFrame: 0,
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
