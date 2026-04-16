import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { MatrixPalette } from './matrix-effects-config'
import { useFrameRate } from '../../../../src/shared/performance/index.ts'

// ── Character set & atlas config ──────────────────────────────────
const CHARS =
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+=<>?/'

const CHAR_COUNT = CHARS.length
const ATLAS_COLS = 10
const ATLAS_ROWS = Math.ceil(CHAR_COUNT / ATLAS_COLS)
const CELL_PX = 64

// ── Simulation config ─────────────────────────────────────────────
const COLUMN_COUNT = 8000
const ROWS = 150
const MAX_INSTANCES = COLUMN_COUNT * ROWS
const ROW_SPACING = 0.09
const BASE_Y = 10

const rand = (lo: number, hi: number) => Math.random() * (hi - lo) + lo
const pickIdx = () => Math.floor(Math.random() * CHAR_COUNT)

// ── Sine lookup table ─────────────────────────────────────────────
const SIN_TABLE_SIZE = 1024
const SIN_TABLE = new Float32Array(SIN_TABLE_SIZE)
for (let i = 0; i < SIN_TABLE_SIZE; i++) {
  SIN_TABLE[i] = Math.sin((i / SIN_TABLE_SIZE) * Math.PI * 2)
}
const sinLUT = (x: number) => SIN_TABLE[Math.floor(((x % (Math.PI * 2)) / (Math.PI * 2)) * SIN_TABLE_SIZE) & (SIN_TABLE_SIZE - 1)]

// ── Build font atlas texture (runs once) ──────────────────────────
function buildAtlas(): THREE.CanvasTexture {
  const w = ATLAS_COLS * CELL_PX
  const h = ATLAS_ROWS * CELL_PX
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)
  ctx.font = `${CELL_PX * 0.72}px "Menlo","Consolas","Courier New",monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#fff'
  for (let i = 0; i < CHAR_COUNT; i++) {
    ctx.fillText(
      CHARS[i],
      (i % ATLAS_COLS) * CELL_PX + CELL_PX / 2,
      Math.floor(i / ATLAS_COLS) * CELL_PX + CELL_PX / 2,
    )
  }
  const tex = new THREE.CanvasTexture(c)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  return tex
}

// ── Shaders ───────────────────────────────────────────────────────
const VS = /* glsl */ `
  attribute vec2  aUvOff;
  attribute vec3  aCol;
  attribute float aOpa;

  varying vec2  vUv;
  varying vec3  vCol;
  varying float vOpa;

  uniform float uAC; // atlas cols
  uniform float uAR; // atlas rows

  void main() {
    vCol = aCol;
    vOpa = aOpa;
    vUv  = uv / vec2(uAC, uAR) + aUvOff;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`

const FS = /* glsl */ `
  uniform sampler2D uAtlas;
  varying vec2  vUv;
  varying vec3  vCol;
  varying float vOpa;

  void main() {
    float a = texture2D(uAtlas, vUv).r;
    if (a < 0.08 || vOpa < 0.001) discard;
    gl_FragColor = vec4(vCol, a * vOpa);
  }
`

// ── Column simulation state ───────────────────────────────────────
interface SimulationState {
  x: Float32Array
  z: Float32Array
  speed: Float32Array
  size: Float32Array
  phase: Float32Array
  headY: Int16Array
  trail: Uint8Array
  resetAfter: Uint16Array
  acc: Float32Array
  cellOn: Uint8Array
  cellAge: Uint8Array
  cellChar: Uint8Array
}

// Keep the simulation indexed by column + row so the render loop can walk
// contiguous typed arrays instead of nested JS objects.
function getCellIndex(columnIndex: number, rowIndex: number) {
  return columnIndex * ROWS + rowIndex
}

function initialHeadY(trail: number) {
  return Math.floor(rand(-ROWS * 1.5 - trail, ROWS + trail))
}

function resetHeadY(trail: number) {
  const min = -Math.floor(rand(trail, trail + 40))
  return Math.floor(rand(min, -4))
}

function randomResetAfter() {
  return Math.floor(rand(120, 220))
}

function clearColumnCells(state: SimulationState, columnIndex: number) {
  const start = getCellIndex(columnIndex, 0)
  const end = start + ROWS
  state.cellOn.fill(0, start, end)
  state.cellAge.fill(0, start, end)
}

function seedColumn(
  state: SimulationState,
  columnIndex: number,
  headY: number,
  trail: number,
) {
  const start = getCellIndex(columnIndex, 0)

  state.x[columnIndex] = rand(-14, 14)
  state.z[columnIndex] = rand(-12, 12)
  state.speed[columnIndex] = rand(10, 22)
  state.size[columnIndex] = rand(0.1, 0.16)
  state.phase[columnIndex] = rand(0, Math.PI * 2)
  state.headY[columnIndex] = headY
  state.trail[columnIndex] = trail
  state.resetAfter[columnIndex] = randomResetAfter()
  state.acc[columnIndex] = 0

  clearColumnCells(state, columnIndex)

  for (let j = 0; j < trail; j += 1) {
    const row = headY - j
    if (row < 0 || row >= ROWS) continue

    const cellIndex = start + row
    state.cellOn[cellIndex] = 1
    state.cellAge[cellIndex] = j
    state.cellChar[cellIndex] = pickIdx()
  }
}

function createSimulationState(): SimulationState {
  const state: SimulationState = {
    x: new Float32Array(COLUMN_COUNT),
    z: new Float32Array(COLUMN_COUNT),
    speed: new Float32Array(COLUMN_COUNT),
    size: new Float32Array(COLUMN_COUNT),
    phase: new Float32Array(COLUMN_COUNT),
    headY: new Int16Array(COLUMN_COUNT),
    trail: new Uint8Array(COLUMN_COUNT),
    resetAfter: new Uint16Array(COLUMN_COUNT),
    acc: new Float32Array(COLUMN_COUNT),
    cellOn: new Uint8Array(MAX_INSTANCES),
    cellAge: new Uint8Array(MAX_INSTANCES),
    cellChar: new Uint8Array(MAX_INSTANCES),
  }

  for (let columnIndex = 0; columnIndex < COLUMN_COUNT; columnIndex += 1) {
    const trail = Math.floor(rand(22, 38))
    seedColumn(state, columnIndex, initialHeadY(trail), trail)
  }

  return state
}

// Reset a column in place so the simulation can recycle its buffers without
// allocating new cell objects or touching inactive columns.
function resetColumn(state: SimulationState, columnIndex: number) {
  const trail = Math.floor(rand(22, 38))
  seedColumn(state, columnIndex, resetHeadY(trail), trail)
}

const DEFAULT_ACTIVE_COLUMNS = 3200
const MIN_ACTIVE_COLUMNS = 250
const ACTIVE_COLUMN_STEP = 250
const LOW_TIER_ACTIVE_COLUMNS = 600
const MEDIUM_TIER_ACTIVE_COLUMNS = 1600
const HIGH_TIER_ACTIVE_COLUMNS = 3200
const MAX_SIMULATION_DT = 1 / 30

function clampActiveColumnCount(nextCount: number) {
  return Math.min(COLUMN_COUNT, Math.max(MIN_ACTIVE_COLUMNS, nextCount))
}

function writeHiddenInstance(
  matrixArray: Float32Array,
  opacityArray: Float32Array,
  index: number,
) {
  const off = index * 16
  // Zero the entire 4×4 matrix via fill (compiles to memset), then set w=1.
  matrixArray.fill(0, off, off + 16)
  matrixArray[off + 15] = 1
  opacityArray[index] = 0
}

function writeVisibleInstanceMatrix(
  matrixArray: Float32Array,
  index: number,
  scale: number,
  x: number,
  y: number,
  z: number,
) {
  const off = index * 16
  matrixArray[off] = scale
  matrixArray[off + 1] = 0
  matrixArray[off + 2] = 0
  matrixArray[off + 3] = 0
  matrixArray[off + 4] = 0
  matrixArray[off + 5] = scale
  matrixArray[off + 6] = 0
  matrixArray[off + 7] = 0
  matrixArray[off + 8] = 0
  matrixArray[off + 9] = 0
  matrixArray[off + 10] = scale
  matrixArray[off + 11] = 0
  matrixArray[off + 12] = x
  matrixArray[off + 13] = y
  matrixArray[off + 14] = z
  matrixArray[off + 15] = 1
}

function writeCellAtlasOffset(
  uvArray: Float32Array,
  index: number,
  charIndex: number,
) {
  const atlasColumn = charIndex % ATLAS_COLS
  const atlasRow = Math.floor(charIndex / ATLAS_COLS)
  uvArray[index * 2] = atlasColumn / ATLAS_COLS
  uvArray[index * 2 + 1] = 1 - (atlasRow + 1) / ATLAS_ROWS
}

function writeCellColorAndOpacity(
  colorArray: Float32Array,
  opacityArray: Float32Array,
  index: number,
  age: number,
  trail: number,
  palette: MatrixPalette,
) {
  const fade = 1 - age / trail
  const trailColor = palette.trailColor
  const dimTrailColor = palette.dimTrailColor

  if (age === 0) {
    colorArray[index * 3] = palette.headColor[0]
    colorArray[index * 3 + 1] = palette.headColor[1]
    colorArray[index * 3 + 2] = palette.headColor[2]
  } else {
    colorArray[index * 3] = dimTrailColor[0] + (trailColor[0] - dimTrailColor[0]) * fade
    colorArray[index * 3 + 1] = dimTrailColor[1] + (trailColor[1] - dimTrailColor[1]) * fade
    colorArray[index * 3 + 2] = dimTrailColor[2] + (trailColor[2] - dimTrailColor[2]) * fade
  }

  opacityArray[index] = 0.16 + fade * 0.84
}

// ── Component ─────────────────────────────────────────────────────
interface MatrixRainProps {
  palette: MatrixPalette
  rainBoost?: boolean
}

export default function MatrixRain({ palette, rainBoost = false }: MatrixRainProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const timeRef = useRef(0)
  const activeColumnsRef = useRef(DEFAULT_ACTIVE_COLUMNS)
  const prevBoostRef = useRef(false)
  const { qualityTier } = useFrameRate()
  const qualityTierRef = useRef(qualityTier)
  qualityTierRef.current = qualityTier

  const atlas = useMemo(() => buildAtlas(), [])
  const state = useMemo(() => createSimulationState(), [])

  // Pre-allocate typed arrays for instanced attributes
  const bufs = useMemo(() => ({
    mat: new Float32Array(MAX_INSTANCES * 16),
    uv:  new Float32Array(MAX_INSTANCES * 2),
    col: new Float32Array(MAX_INSTANCES * 3),
    opa: new Float32Array(MAX_INSTANCES),
  }), [])

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VS,
    fragmentShader: FS,
    uniforms: {
      uAtlas: { value: atlas },
      uAC: { value: ATLAS_COLS },
      uAR: { value: ATLAS_ROWS },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), [atlas])

  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1)
    g.setAttribute('aUvOff', new THREE.InstancedBufferAttribute(bufs.uv, 2))
    g.setAttribute('aCol',   new THREE.InstancedBufferAttribute(bufs.col, 3))
    g.setAttribute('aOpa',   new THREE.InstancedBufferAttribute(bufs.opa, 1))
    return g
  }, [bufs])

  // Init all matrices to zero-scale (hidden)
  useEffect(() => {
    const m = meshRef.current
    if (!m) return
    const id = new THREE.Matrix4().makeScale(0, 0, 0)
    for (let i = 0; i < MAX_INSTANCES; i++) m.setMatrixAt(i, id)
    m.instanceMatrix.needsUpdate = true
    return () => { atlas.dispose(); material.dispose(); geometry.dispose() }
  }, [atlas, material, geometry])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return

      if (event.key === 'ArrowLeft') {
        activeColumnsRef.current = clampActiveColumnCount(
          activeColumnsRef.current - ACTIVE_COLUMN_STEP,
        )
        return
      }

      if (event.key === 'ArrowRight') {
        activeColumnsRef.current = clampActiveColumnCount(
          activeColumnsRef.current + ACTIVE_COLUMN_STEP,
        )
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useFrame((_, dt) => {
    const m = meshRef.current
    if (!m) return

    const tier = qualityTierRef.current
    const tierColumnCap = tier === 'low' ? LOW_TIER_ACTIVE_COLUMNS 
      : tier === 'medium' ? MEDIUM_TIER_ACTIVE_COLUMNS 
      : HIGH_TIER_ACTIVE_COLUMNS
    if (activeColumnsRef.current > tierColumnCap) activeColumnsRef.current = tierColumnCap

    const cappedDt = Math.min(dt, MAX_SIMULATION_DT)
    timeRef.current += cappedDt
    const t = timeRef.current
    const { uv, col, opa } = bufs
    const {
      x,
      z,
      speed,
      size,
      phase,
      headY,
      trail,
      resetAfter,
      acc,
      cellOn,
      cellAge,
      cellChar,
    } = state
    const matArr = m.instanceMatrix.array as Float32Array
    const baseActiveColumns = activeColumnsRef.current
    const activeColumns = rainBoost ? Math.min(baseActiveColumns * 2, COLUMN_COUNT) : baseActiveColumns
    
    // On first frame of boost, reset the new columns to start from top
    if (rainBoost && !prevBoostRef.current) {
      for (let i = baseActiveColumns; i < activeColumns; i++) {
        const trail = Math.floor(rand(22, 38))
        seedColumn(state, i, -trail - Math.floor(rand(5, 30)), trail)
      }
    }
    prevBoostRef.current = rainBoost
    
    const activeInstances = activeColumns * ROWS
    const uvAttr = geometry.getAttribute('aUvOff') as THREE.InstancedBufferAttribute
    const colAttr = geometry.getAttribute('aCol') as THREE.InstancedBufferAttribute
    const opaAttr = geometry.getAttribute('aOpa') as THREE.InstancedBufferAttribute

    // Only the active prefix is rendered, so the instanced mesh count follows
    // the selected density instead of drawing the full backing buffer.
    m.count = activeInstances

    let idx = 0

    for (let columnIndex = 0; columnIndex < activeColumns; columnIndex += 1) {
      acc[columnIndex] += speed[columnIndex] * cappedDt
      const columnStart = getCellIndex(columnIndex, 0)

      while (acc[columnIndex] >= 1) {
        acc[columnIndex] -= 1
        headY[columnIndex] += 1

        const trailLength = trail[columnIndex]
        const columnEnd = columnStart + ROWS

        for (let cellIndex = columnStart; cellIndex < columnEnd; cellIndex += 1) {
          if (!cellOn[cellIndex]) continue

          const nextAge = cellAge[cellIndex] + 1
          if (nextAge > trailLength) {
            cellOn[cellIndex] = 0
            cellAge[cellIndex] = 0
          } else {
            cellAge[cellIndex] = nextAge
          }
        }

        if (headY[columnIndex] >= 0 && headY[columnIndex] < ROWS) {
          const headCellIndex = columnStart + headY[columnIndex]
          cellOn[headCellIndex] = 1
          cellAge[headCellIndex] = 0
          cellChar[headCellIndex] = pickIdx()
        }

        // Only scramble glyphs when the head actually advances so we avoid
        // burning Math.random() on frames where the column is stationary.
        for (let k = 0; k < 2; k += 1) {
          const rowIndex = Math.floor(rand(0, ROWS))
          const cellIndex = columnStart + rowIndex
          if (cellOn[cellIndex] && Math.random() < 0.5) cellChar[cellIndex] = pickIdx()
        }

        if (headY[columnIndex] - trailLength > ROWS + resetAfter[columnIndex]) {
          resetColumn(state, columnIndex)
          break
        }
      }

      // Write the visible slice for this column into the instanced buffers.
      const cx = x[columnIndex] + sinLUT(t * 0.25 + phase[columnIndex]) * 0.03
      const s = size[columnIndex]

      for (let rowIndex = 0; rowIndex < ROWS; rowIndex += 1) {
        const cellIndex = columnStart + rowIndex

        if (!cellOn[cellIndex]) {
          writeHiddenInstance(matArr, opa, idx)
        } else {
          writeVisibleInstanceMatrix(matArr, idx, s, cx, BASE_Y - rowIndex * ROW_SPACING, z[columnIndex])
          writeCellAtlasOffset(uv, idx, cellChar[cellIndex])
          writeCellColorAndOpacity(col, opa, idx, cellAge[cellIndex], trail[columnIndex], palette)
        }
        idx += 1
      }
    }

    // Mark only the active slice dirty so Three uploads the minimum amount of
    // per-instance data needed for the current density.
    m.instanceMatrix.clearUpdateRanges()
    m.instanceMatrix.addUpdateRange(0, activeInstances * 16)
    m.instanceMatrix.needsUpdate = true

    uvAttr.clearUpdateRanges()
    uvAttr.addUpdateRange(0, activeInstances * 2)
    uvAttr.needsUpdate = true

    colAttr.clearUpdateRanges()
    colAttr.addUpdateRange(0, activeInstances * 3)
    colAttr.needsUpdate = true

    opaAttr.clearUpdateRanges()
    opaAttr.addUpdateRange(0, activeInstances)
    opaAttr.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_INSTANCES]}
      frustumCulled={false}
    />
  )
}
