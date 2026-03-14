import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

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

// ── Column simulation types ───────────────────────────────────────
interface Cell {
  ci: number   // char index
  age: number
  on: boolean
}
interface Col {
  x: number; z: number; speed: number; size: number
  phase: number; headY: number; trail: number
  resetAfter: number
  acc: number; cells: Cell[]
}

function freshCells(): Cell[] {
  return Array.from({ length: ROWS }, () => ({ ci: pickIdx(), age: 999, on: false }))
}

function randomHeadY(trail: number, includeVisibleRange = false) {
  const min = includeVisibleRange ? -ROWS * 1.5 - trail : -Math.floor(rand(trail, trail + 40))
  const max = includeVisibleRange ? ROWS + trail : -4
  return Math.floor(rand(min, max))
}

function randomResetAfter() {
  return Math.floor(rand(120, 220))
}

function makeCol(): Col {
  // Spread headY across the full range so columns are at different lifecycle stages
  const trail = Math.floor(rand(22, 38))
  const headY = randomHeadY(trail, true)
  const c: Col = {
    x: rand(-14, 14), z: rand(-12, 12),
    speed: rand(10, 22), size: rand(0.1, 0.16),
    phase: rand(0, Math.PI * 2),
    headY, trail,
    resetAfter: randomResetAfter(),
    acc: 0, cells: freshCells(),
  }
  for (let j = 0; j < c.trail; j++) {
    const r = c.headY - j
    if (r >= 0 && r < ROWS) c.cells[r] = { ci: pickIdx(), age: j, on: true }
  }
  return c
}

function resetCol(c: Col) {
  c.x = rand(-14, 14); c.z = rand(-12, 12)
  c.speed = rand(10, 22); c.size = rand(0.1, 0.16)
  c.phase = rand(0, Math.PI * 2)
  c.trail = Math.floor(rand(22, 38))
  c.headY = randomHeadY(c.trail)
  c.resetAfter = randomResetAfter()
  c.acc = 0; c.cells = freshCells()
}

const DEFAULT_ACTIVE_COLUMNS = 2000
const MIN_ACTIVE_COLUMNS = 250
const ACTIVE_COLUMN_STEP = 250

// ── Component ─────────────────────────────────────────────────────
export default function MatrixRain() {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const timeRef = useRef(0)
  const activeColumnsRef = useRef(DEFAULT_ACTIVE_COLUMNS)

  const atlas = useMemo(() => buildAtlas(), [])
  const columns = useMemo(() => Array.from({ length: COLUMN_COUNT }, makeCol), [])

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

      if (event.key === '[') {
        activeColumnsRef.current = Math.max(
          MIN_ACTIVE_COLUMNS,
          activeColumnsRef.current - ACTIVE_COLUMN_STEP,
        )
        return
      }

      if (event.key === ']') {
        activeColumnsRef.current = Math.min(
          COLUMN_COUNT,
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

    timeRef.current += dt
    const t = timeRef.current
    const { uv, col, opa } = bufs
    const matArr = m.instanceMatrix.array as Float32Array
    const activeColumns = activeColumnsRef.current

    let idx = 0

    for (let i = 0; i < COLUMN_COUNT; i++) {
      const c = columns[i]
      const columnIsActive = i < activeColumns

      if (!columnIsActive) {
        for (let r = 0; r < ROWS; r++) {
          const off = idx * 16
          matArr[off] = 0
          matArr[off + 1] = 0
          matArr[off + 2] = 0
          matArr[off + 3] = 0
          matArr[off + 4] = 0
          matArr[off + 5] = 0
          matArr[off + 6] = 0
          matArr[off + 7] = 0
          matArr[off + 8] = 0
          matArr[off + 9] = 0
          matArr[off + 10] = 0
          matArr[off + 11] = 0
          matArr[off + 12] = 0
          matArr[off + 13] = 0
          matArr[off + 14] = 0
          matArr[off + 15] = 1
          opa[idx] = 0
          idx++
        }
        continue
      }

      // ── Simulate ──
      c.acc += c.speed * dt
      while (c.acc >= 1) {
        c.acc -= 1
        c.headY += 1
        for (let r = 0; r < ROWS; r++) {
          const cell = c.cells[r]
          if (!cell.on) continue
          cell.age += 1
          if (cell.age > c.trail) cell.on = false
        }
        if (c.headY >= 0 && c.headY < ROWS)
          c.cells[c.headY] = { ci: pickIdx(), age: 0, on: true }
        for (let k = 0; k < 2; k++) {
          const ri = Math.floor(rand(0, ROWS))
          const cell = c.cells[ri]
          if (cell?.on && Math.random() < 0.5) cell.ci = pickIdx()
        }
        if (c.headY - c.trail > ROWS + c.resetAfter) resetCol(c)
      }

      // ── Write per-cell instance data ──
      const cx = c.x + Math.sin(t * 0.25 + c.phase) * 0.03
      const s = c.size

      for (let r = 0; r < ROWS; r++) {
        const off = idx * 16
        const cell = c.cells[r]

        if (!cell.on) {
          // Degenerate matrix (scale 0) — GPU skips it
          matArr[off]      = 0; matArr[off + 1]  = 0; matArr[off + 2]  = 0; matArr[off + 3]  = 0
          matArr[off + 4]  = 0; matArr[off + 5]  = 0; matArr[off + 6]  = 0; matArr[off + 7]  = 0
          matArr[off + 8]  = 0; matArr[off + 9]  = 0; matArr[off + 10] = 0; matArr[off + 11] = 0
          matArr[off + 12] = 0; matArr[off + 13] = 0; matArr[off + 14] = 0; matArr[off + 15] = 1
          opa[idx] = 0
        } else {
          // Scale + translate matrix (no rotation)
          matArr[off]      = s; matArr[off + 1]  = 0; matArr[off + 2]  = 0; matArr[off + 3]  = 0
          matArr[off + 4]  = 0; matArr[off + 5]  = s; matArr[off + 6]  = 0; matArr[off + 7]  = 0
          matArr[off + 8]  = 0; matArr[off + 9]  = 0; matArr[off + 10] = s; matArr[off + 11] = 0
          matArr[off + 12] = cx; matArr[off + 13] = BASE_Y - r * ROW_SPACING; matArr[off + 14] = c.z; matArr[off + 15] = 1

          // Atlas UV offset
          const ac = cell.ci % ATLAS_COLS
          const ar = Math.floor(cell.ci / ATLAS_COLS)
          uv[idx * 2]     = ac / ATLAS_COLS
          uv[idx * 2 + 1] = 1 - (ar + 1) / ATLAS_ROWS

          // Color + opacity
          const fade = 1 - cell.age / c.trail
          if (cell.age === 0) {
            col[idx * 3]     = 0.95
            col[idx * 3 + 1] = 1.0
            col[idx * 3 + 2] = 0.95
          } else {
            col[idx * 3]     = fade * 0.094
            col[idx * 3 + 1] = (95 + fade * 160) / 255
            col[idx * 3 + 2] = fade * 0.078
          }
          opa[idx] = 0.16 + fade * 0.84
        }
        idx++
      }
    }

    m.instanceMatrix.needsUpdate = true
    ;(geometry.getAttribute('aUvOff') as THREE.InstancedBufferAttribute).needsUpdate = true
    ;(geometry.getAttribute('aCol')   as THREE.InstancedBufferAttribute).needsUpdate = true
    ;(geometry.getAttribute('aOpa')   as THREE.InstancedBufferAttribute).needsUpdate = true
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_INSTANCES]}
      frustumCulled={false}
    />
  )
}
