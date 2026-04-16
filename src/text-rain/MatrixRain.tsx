import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { MatrixPalette } from './matrix-effects-config'
import { useFrameRate, type FrameRateQualityTier } from '../../../../src/shared/performance/index.ts'

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
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = 4
  return tex
}

// ── Shaders ───────────────────────────────────────────────────────
const VS = /* glsl */ `
  attribute vec2  aUvOff;
  attribute vec3  aCol;
  attribute float aOpa;
  attribute float aRow;
  attribute vec4  aColumn;

  varying vec2  vUv;
  varying vec3  vCol;
  varying float vOpa;

  uniform float uAC; // atlas cols
  uniform float uAR; // atlas rows
  uniform float uBaseY;
  uniform float uRowSpacing;
  uniform float uTime;

  void main() {
    vCol = aCol;
    vOpa = aOpa;
    vUv  = uv / vec2(uAC, uAR) + aUvOff;

    float wobble = sin(uTime * 0.25 + aColumn.w) * 0.03;
    vec3 worldPos = vec3(
      aColumn.x + wobble,
      uBaseY - aRow * uRowSpacing,
      aColumn.y
    );

    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos + position * aColumn.z, 1.0);
  }
`

const FS = /* glsl */ `
  uniform sampler2D uAtlas;
  varying vec2  vUv;
  varying vec3  vCol;
  varying float vOpa;

  void main() {
    if (vOpa < 0.001) discard;
    float a = texture2D(uAtlas, vUv).r;
    if (a < 0.08) discard;
    gl_FragColor = vec4(vCol, 1.0);
  }
`

// ── Column simulation state ───────────────────────────────────────
interface SimulationState {
  x: Float32Array
  z: Float32Array
  speed: Float32Array
  size: Float32Array
  phase: Float32Array
  columnData: Float32Array
  headY: Int16Array
  trail: Uint8Array
  resetAfter: Uint16Array
  acc: Float32Array
  cellOn: Uint8Array
  cellAge: Uint8Array
  cellChar: Uint8Array
  dirtyColumns: Uint8Array
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

function writeColumnData(
  columnData: Float32Array,
  columnIndex: number,
  x: number,
  z: number,
  size: number,
  phase: number,
) {
  const off = columnIndex * 4
  columnData[off] = x
  columnData[off + 1] = z
  columnData[off + 2] = size
  columnData[off + 3] = phase
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
  writeColumnData(state.columnData, columnIndex, state.x[columnIndex], state.z[columnIndex], state.size[columnIndex], state.phase[columnIndex])
  state.headY[columnIndex] = headY
  state.trail[columnIndex] = trail
  state.resetAfter[columnIndex] = randomResetAfter()
  state.acc[columnIndex] = 0
  state.dirtyColumns[columnIndex] = 1

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
    columnData: new Float32Array(COLUMN_COUNT * 4),
    headY: new Int16Array(COLUMN_COUNT),
    trail: new Uint8Array(COLUMN_COUNT),
    resetAfter: new Uint16Array(COLUMN_COUNT),
    acc: new Float32Array(COLUMN_COUNT),
    cellOn: new Uint8Array(MAX_INSTANCES),
    cellAge: new Uint8Array(MAX_INSTANCES),
    cellChar: new Uint8Array(MAX_INSTANCES),
    dirtyColumns: new Uint8Array(COLUMN_COUNT),
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

function writeCellColor(
  colorArray: Float32Array,
  index: number,
  age: number,
  trail: number,
  palette: MatrixPalette,
  fogColor: [number, number, number],
) {
  const fade = 1 - age / trail
  const trailColor = palette.trailColor
  const dimTrailColor = palette.dimTrailColor
  const off = index * 3

  if (age === 0) {
    colorArray[off] = palette.headColor[0]
    colorArray[off + 1] = palette.headColor[1]
    colorArray[off + 2] = palette.headColor[2]
    return
  }

  const trailMix = 0.16 + fade * 0.84
  const trailR = dimTrailColor[0] + (trailColor[0] - dimTrailColor[0]) * fade
  const trailG = dimTrailColor[1] + (trailColor[1] - dimTrailColor[1]) * fade
  const trailB = dimTrailColor[2] + (trailColor[2] - dimTrailColor[2]) * fade

  colorArray[off] = fogColor[0] + (trailR - fogColor[0]) * trailMix
  colorArray[off + 1] = fogColor[1] + (trailG - fogColor[1]) * trailMix
  colorArray[off + 2] = fogColor[2] + (trailB - fogColor[2]) * trailMix
}

// ── Component ─────────────────────────────────────────────────────
interface MatrixRainProps {
  palette: MatrixPalette
  rainBoost?: boolean
  onPerfStats?: (stats: {
    activeColumns: number
    activeInstances: number
    uploadedBytesPerFrame: number
    qualityTier: FrameRateQualityTier
  }) => void
}

export default function MatrixRain({ palette, rainBoost = false, onPerfStats }: MatrixRainProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const timeRef = useRef(0)
  const activeColumnsRef = useRef(DEFAULT_ACTIVE_COLUMNS)
  const previousRenderedColumnsRef = useRef(0)
  const prevBoostRef = useRef(false)
  const { qualityTier } = useFrameRate()
  const qualityTierRef = useRef(qualityTier)
  qualityTierRef.current = qualityTier
  const fogColor = useMemo(() => {
    const color = new THREE.Color(palette.fog)
    return [color.r, color.g, color.b] as [number, number, number]
  }, [palette.fog])

  const atlas = useMemo(() => buildAtlas(), [])
  const state = useMemo(() => createSimulationState(), [])

  // Pre-allocate typed arrays for instanced attributes
  const bufs = useMemo(() => ({
    uv:  new Float32Array(MAX_INSTANCES * 2),
    col: new Float32Array(MAX_INSTANCES * 3),
    opa: new Float32Array(MAX_INSTANCES),
  }), [])

  const rowData = useMemo(() => {
    const data = new Uint8Array(MAX_INSTANCES)

    for (let columnIndex = 0; columnIndex < COLUMN_COUNT; columnIndex += 1) {
      const columnStart = getCellIndex(columnIndex, 0)
      for (let rowIndex = 0; rowIndex < ROWS; rowIndex += 1) {
        data[columnStart + rowIndex] = rowIndex
      }
    }

    return data
  }, [])

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VS,
    fragmentShader: FS,
    uniforms: {
      uAtlas: { value: atlas },
      uAC: { value: ATLAS_COLS },
      uAR: { value: ATLAS_ROWS },
      uBaseY: { value: BASE_Y },
      uRowSpacing: { value: ROW_SPACING },
      uTime: { value: 0 },
    },
    transparent: false,
    depthWrite: true,
    side: THREE.DoubleSide,
    blending: THREE.NoBlending,
  }), [atlas])

  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1)
    g.setAttribute('aRow', new THREE.InstancedBufferAttribute(rowData, 1))
    const columnAttr = new THREE.InstancedBufferAttribute(state.columnData, 4)
    columnAttr.meshPerAttribute = ROWS
    g.setAttribute('aColumn', columnAttr)
    g.setAttribute('aUvOff', new THREE.InstancedBufferAttribute(bufs.uv, 2))
    g.setAttribute('aCol',   new THREE.InstancedBufferAttribute(bufs.col, 3))
    g.setAttribute('aOpa',   new THREE.InstancedBufferAttribute(bufs.opa, 1))
    return g
  }, [bufs, rowData, state.columnData])

  // Init all matrices to zero-scale (hidden)
  useLayoutEffect(() => {
    const m = meshRef.current
    if (!m) return
    const id = new THREE.Matrix4().makeScale(0, 0, 0)
    for (let i = 0; i < MAX_INSTANCES; i++) m.setMatrixAt(i, id)
    m.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    m.count = 0
    m.instanceMatrix.needsUpdate = true
    return () => { atlas.dispose(); material.dispose(); geometry.dispose() }
  }, [atlas, material, geometry])

  useEffect(() => {
    state.dirtyColumns.fill(1, 0, activeColumnsRef.current)
  }, [fogColor, state])

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
    material.uniforms.uTime.value = t
    const { uv, col } = bufs
    const opa = bufs.opa
    const {
      x,
      z,
      speed,
      size,
      phase,
      columnData,
      headY,
      trail,
      resetAfter,
      acc,
      cellOn,
      cellAge,
      cellChar,
      dirtyColumns,
    } = state
    const baseActiveColumns = activeColumnsRef.current
    const activeColumns = rainBoost ? Math.min(baseActiveColumns * 2, COLUMN_COUNT) : baseActiveColumns
    const activeInstances = activeColumns * ROWS

    // On first frame of boost, reset the new columns to start from top
    if (rainBoost && !prevBoostRef.current) {
      for (let i = baseActiveColumns; i < activeColumns; i++) {
        const trail = Math.floor(rand(22, 38))
        seedColumn(state, i, -trail - Math.floor(rand(5, 30)), trail)
      }
    }
    prevBoostRef.current = rainBoost

    if (activeColumns > previousRenderedColumnsRef.current) {
      dirtyColumns.fill(1, previousRenderedColumnsRef.current, activeColumns)
    }
    previousRenderedColumnsRef.current = activeColumns

    const uvAttr = geometry.getAttribute('aUvOff') as THREE.InstancedBufferAttribute
    const colAttr = geometry.getAttribute('aCol') as THREE.InstancedBufferAttribute
    const opaAttr = geometry.getAttribute('aOpa') as THREE.InstancedBufferAttribute
    const columnAttr = geometry.getAttribute('aColumn') as THREE.InstancedBufferAttribute

    uvAttr.clearUpdateRanges()
    colAttr.clearUpdateRanges()
    opaAttr.clearUpdateRanges()
    columnAttr.clearUpdateRanges()

    // Only the active prefix is rendered, so the instanced mesh count follows
    // the selected density instead of drawing the full backing buffer.
    m.count = activeInstances

    let runStart: number | null = null
    let uploadedBytes = 0

    for (let columnIndex = 0; columnIndex < activeColumns; columnIndex += 1) {
      acc[columnIndex] += speed[columnIndex] * cappedDt
      const columnStart = getCellIndex(columnIndex, 0)
      let columnDirty = dirtyColumns[columnIndex] === 1

      while (acc[columnIndex] >= 1) {
        acc[columnIndex] -= 1
        headY[columnIndex] += 1
        columnDirty = true

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
          if (cellOn[cellIndex] && Math.random() < 0.5) {
            cellChar[cellIndex] = pickIdx()
            columnDirty = true
          }
        }

        if (headY[columnIndex] - trailLength > ROWS + resetAfter[columnIndex]) {
          resetColumn(state, columnIndex)
          columnDirty = true
          break
        }
      }

      if (!columnDirty) {
        if (runStart !== null) {
          const runEnd = columnIndex
          const runColumns = runEnd - runStart
          const cellOffset = runStart * ROWS
          const cellCount = runColumns * ROWS

          uvAttr.addUpdateRange(cellOffset * 2, cellCount * 2)
          colAttr.addUpdateRange(cellOffset * 3, cellCount * 3)
          opaAttr.addUpdateRange(cellOffset, cellCount)
          columnAttr.addUpdateRange(runStart * 4, runColumns * 4)
          uploadedBytes += runColumns * (ROWS * 24 + 16)
          runStart = null
        }

        continue
      }

      dirtyColumns[columnIndex] = 0

      if (runStart === null) {
        runStart = columnIndex
      }

      writeColumnData(columnData, columnIndex, x[columnIndex], z[columnIndex], size[columnIndex], phase[columnIndex])

      for (let rowIndex = 0; rowIndex < ROWS; rowIndex += 1) {
        const cellIndex = columnStart + rowIndex

        if (!cellOn[cellIndex]) {
          opa[cellIndex] = 0
        } else {
          writeCellAtlasOffset(uv, cellIndex, cellChar[cellIndex])
          writeCellColor(col, cellIndex, cellAge[cellIndex], trail[columnIndex], palette, fogColor)
          opa[cellIndex] = 1
        }
      }
    }

    if (runStart !== null) {
      const runEnd = activeColumns
      const runColumns = runEnd - runStart
      const cellOffset = runStart * ROWS
      const cellCount = runColumns * ROWS

      uvAttr.addUpdateRange(cellOffset * 2, cellCount * 2)
      colAttr.addUpdateRange(cellOffset * 3, cellCount * 3)
      opaAttr.addUpdateRange(cellOffset, cellCount)
      columnAttr.addUpdateRange(runStart * 4, runColumns * 4)
      uploadedBytes += runColumns * (ROWS * 24 + 16)
    }

    if (uploadedBytes > 0) {
      uvAttr.needsUpdate = true
      colAttr.needsUpdate = true
      opaAttr.needsUpdate = true
      columnAttr.needsUpdate = true
    }

    onPerfStats?.({
      activeColumns,
      activeInstances,
      uploadedBytesPerFrame: uploadedBytes,
      qualityTier: tier,
    })
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_INSTANCES]}
      frustumCulled={false}
    />
  )
}
