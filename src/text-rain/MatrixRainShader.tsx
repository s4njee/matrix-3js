import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { MatrixPalette } from './matrix-effects-config'
import { ATLAS_COLS, ATLAS_ROWS, CHAR_COUNT, buildAtlas } from './matrix-atlas'
import { FS, VS } from './matrix-rain-shader.glsl'
import { useFrameRate, type FrameRateQualityTier } from '../../../../src/shared/performance/index.ts'

const STREAM_COUNT = 2
const BOOST_STREAM = 1
const MIN_DENSITY_OFFSET = -80
const MAX_DENSITY_OFFSET = 140
const DENSITY_STEP = 40
const MAX_SIMULATION_DT = 1 / 30
const PARKED_HEAD = -9999
const COLUMN_HEIGHT = 18
const COLUMN_FIELD_WIDTH = 28
const COLUMN_FIELD_DEPTH = 24
const COLUMN_MIN_WIDTH = 0.1
const COLUMN_MAX_WIDTH = 0.18

const rand = (lo: number, hi: number) => Math.random() * (hi - lo) + lo

interface ShaderColumnState {
  cols: number
  data: Float32Array
  head: Float32Array
  trail: Float32Array
  phase: Float32Array
  speed: Float32Array
  resetAfter: Uint16Array
}

interface ShaderColumnTransform {
  x: number
  z: number
  width: number
}

interface MatrixRainShaderProps {
  palette: MatrixPalette
  rainBoost?: boolean
  onPerfStats?: (stats: {
    activeColumns: number
    activeInstances: number
    uploadedBytesPerFrame: number
    qualityTier: FrameRateQualityTier
  }) => void
}

function getColumnIndex(state: ShaderColumnState, streamIndex: number, columnIndex: number) {
  return streamIndex * state.cols + columnIndex
}

function randomTrailLength() {
  return Math.floor(rand(22, 38))
}

function randomSpeed() {
  return rand(10, 22)
}

function randomResetAfter() {
  return Math.floor(rand(12, 28))
}

function initialHeadY(trail: number, rows: number) {
  return Math.floor(rand(-rows * 1.5 - trail, rows + trail))
}

function resetHeadY(trail: number) {
  return -trail - Math.floor(rand(5, 30))
}

function writeColumnState(state: ShaderColumnState, index: number) {
  const off = index * 4
  state.data[off] = state.head[index]
  state.data[off + 1] = state.trail[index]
  state.data[off + 2] = state.phase[index]
  state.data[off + 3] = state.speed[index]
}

function seedColumn(
  state: ShaderColumnState,
  streamIndex: number,
  columnIndex: number,
  headY: number,
  trail = randomTrailLength(),
) {
  const index = getColumnIndex(state, streamIndex, columnIndex)

  state.head[index] = headY
  state.trail[index] = trail
  state.phase[index] = rand(0, Math.PI * 2)
  state.speed[index] = randomSpeed()
  state.resetAfter[index] = randomResetAfter()
  writeColumnState(state, index)
}

function parkColumn(state: ShaderColumnState, streamIndex: number, columnIndex: number) {
  const index = getColumnIndex(state, streamIndex, columnIndex)

  state.head[index] = PARKED_HEAD
  state.trail[index] = 0
  state.phase[index] = 0
  state.speed[index] = 0
  state.resetAfter[index] = 0
  writeColumnState(state, index)
}

function createShaderColumnState(cols: number, rows: number) {
  const entryCount = cols * STREAM_COUNT
  const state: ShaderColumnState = {
    cols,
    data: new Float32Array(entryCount * 4),
    head: new Float32Array(entryCount),
    trail: new Float32Array(entryCount),
    phase: new Float32Array(entryCount),
    speed: new Float32Array(entryCount),
    resetAfter: new Uint16Array(entryCount),
  }

  for (let columnIndex = 0; columnIndex < cols; columnIndex += 1) {
    const trail = randomTrailLength()
    seedColumn(state, 0, columnIndex, initialHeadY(trail, rows), trail)
    parkColumn(state, BOOST_STREAM, columnIndex)
  }

  return state
}

function stepColumn(
  state: ShaderColumnState,
  streamIndex: number,
  columnIndex: number,
  rows: number,
  dt: number,
  shouldContinue: boolean,
) {
  const index = getColumnIndex(state, streamIndex, columnIndex)

  if (state.head[index] <= PARKED_HEAD + 1) {
    writeColumnState(state, index)
    return
  }

  state.head[index] += state.speed[index] * dt

  if (state.head[index] - state.trail[index] > rows + state.resetAfter[index]) {
    if (shouldContinue) {
      state.trail[index] = randomTrailLength()
      state.head[index] = resetHeadY(state.trail[index])
      state.phase[index] = rand(0, Math.PI * 2)
      state.speed[index] = randomSpeed()
      state.resetAfter[index] = randomResetAfter()
    } else {
      parkColumn(state, streamIndex, columnIndex)
      return
    }
  }

  writeColumnState(state, index)
}

function stepColumns(
  state: ShaderColumnState,
  rows: number,
  dt: number,
  rainBoost: boolean,
  boostStarted: boolean,
) {
  if (boostStarted) {
    for (let columnIndex = 0; columnIndex < state.cols; columnIndex += 1) {
      const trail = randomTrailLength()
      seedColumn(state, BOOST_STREAM, columnIndex, resetHeadY(trail), trail)
    }
  }

  for (let columnIndex = 0; columnIndex < state.cols; columnIndex += 1) {
    stepColumn(state, 0, columnIndex, rows, dt, true)
    stepColumn(state, BOOST_STREAM, columnIndex, rows, dt, rainBoost)
  }
}

function createColumnGeometry(cols: number) {
  const geometry = new THREE.PlaneGeometry(1, 1)
  const columnIndexData = new Float32Array(cols)

  for (let columnIndex = 0; columnIndex < cols; columnIndex += 1) {
    columnIndexData[columnIndex] = columnIndex
  }

  geometry.setAttribute('aColumnIndex', new THREE.InstancedBufferAttribute(columnIndexData, 1))
  return geometry
}

function getRowsForTier(qualityTier: FrameRateQualityTier) {
  if (qualityTier === 'low') return 90
  if (qualityTier === 'medium') return 125
  return 160
}

function getColumnsForRows(rows: number) {
  return Math.max(80, Math.round(rows * 4.2))
}

function clampDensityOffset(value: number) {
  return Math.min(MAX_DENSITY_OFFSET, Math.max(MIN_DENSITY_OFFSET, value))
}

function createColumnTransforms(cols: number) {
  const transforms: ShaderColumnTransform[] = []

  for (let columnIndex = 0; columnIndex < cols; columnIndex += 1) {
    const band = columnIndex / Math.max(1, cols - 1)
    const x = (band - 0.5) * COLUMN_FIELD_WIDTH + rand(-0.12, 0.12)
    const z = rand(-COLUMN_FIELD_DEPTH / 2, COLUMN_FIELD_DEPTH / 2)
    const width = rand(COLUMN_MIN_WIDTH, COLUMN_MAX_WIDTH)

    transforms.push({ x, z, width })
  }

  transforms.sort((a, b) => a.z - b.z)
  return transforms
}

export default function MatrixRainShader({
  palette,
  rainBoost = false,
  onPerfStats,
}: MatrixRainShaderProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const { qualityTier } = useFrameRate()
  const [densityOffset, setDensityOffset] = useState(0)
  const previousBoostRef = useRef(false)

  // Lock the quality tier at mount time so the grid dimensions stay stable.
  // Tier changes mid-session no longer reset the entire rain scene.
  const initialTierRef = useRef(qualityTier)

  const grid = useMemo(() => {
    const rows = Math.max(30, getRowsForTier(initialTierRef.current) + Math.round(densityOffset / 4))
    const cols = getColumnsForRows(rows + densityOffset)

    return { cols, rows }
  }, [densityOffset])

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
  const columnState = useMemo(
    () => createShaderColumnState(grid.cols, grid.rows),
    [grid.cols, grid.rows],
  )
  const stateTexture = useMemo(() => {
    const texture = new THREE.DataTexture(
      columnState.data,
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
  }, [columnState, grid.cols])

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
  }), [atlas, grid.cols, grid.rows, palette.dimTrailColor, palette.fog, palette.headColor, palette.trailColor, stateTexture])

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return

    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()

    for (let columnIndex = 0; columnIndex < grid.cols; columnIndex += 1) {
      const transform = columnTransforms[columnIndex]!

      position.set(transform.x, 0, transform.z)
      scale.set(transform.width, COLUMN_HEIGHT, 1)
      matrix.compose(position, quaternion, scale)
      mesh.setMatrixAt(columnIndex, matrix)
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
        setDensityOffset(current => clampDensityOffset(current - DENSITY_STEP))
      } else if (event.key === 'ArrowRight') {
        setDensityOffset(current => clampDensityOffset(current + DENSITY_STEP))
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useEffect(() => () => {
    atlas.dispose()
    geometry.dispose()
  }, [atlas, geometry])

  useEffect(() => () => {
    stateTexture.dispose()
  }, [stateTexture])

  useEffect(() => () => {
    material.dispose()
  }, [material])

  useFrame((_, dt) => {
    const cappedDt = Math.min(dt, MAX_SIMULATION_DT)
    const boostStarted = rainBoost && !previousBoostRef.current
    previousBoostRef.current = rainBoost

    stepColumns(columnState, grid.rows, cappedDt, rainBoost, boostStarted)

    stateTexture.needsUpdate = true
    material.uniforms.uTime.value += cappedDt
    material.uniforms.uGridCols.value = grid.cols
    material.uniforms.uGridRows.value = grid.rows

    onPerfStats?.({
      activeColumns: rainBoost ? grid.cols * STREAM_COUNT : grid.cols,
      activeInstances: grid.cols,
      uploadedBytesPerFrame: columnState.data.byteLength,
      qualityTier,
    })
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, grid.cols]}
      frustumCulled={false}
    />
  )
}
