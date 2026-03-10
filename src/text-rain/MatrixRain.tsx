import { useMemo, useRef } from 'react'
import { Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const CHARS =
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+=<>?/'

const rand = (min: number, max: number) => Math.random() * (max - min) + min
const pick = () => CHARS[Math.floor(Math.random() * CHARS.length)]

interface CellData {
  char: string
  age: number
  active: boolean
}

interface ColumnData {
  x: number
  z: number
  speed: number
  size: number
  phase: number
  headY: number
  trailLength: number
  spawnAccumulator: number
  cells: CellData[]
}

const ROWS = 120
const COLUMN_COUNT = 360
const BASE_Y = 10
const ROW_SPACING = 0.14

function createInactiveCells() {
  return Array.from({ length: ROWS }, () => ({
    char: pick(),
    age: 999,
    active: false,
  }))
}

function createColumn(): ColumnData {
  const col: ColumnData = {
    x: rand(-14, 14),
    z: rand(-12, 12),
    speed: rand(10, 22),
    size: rand(0.1, 0.16),
    phase: rand(0, Math.PI * 2),
    headY: Math.floor(rand(18, ROWS - 10)),
    trailLength: Math.floor(rand(22, 38)),
    spawnAccumulator: 0,
    cells: createInactiveCells(),
  }

  for (let j = 0; j < col.trailLength; j++) {
    const row = col.headY - j
    if (row < 0 || row >= ROWS) continue
    col.cells[row] = {
      char: pick(),
      age: j,
      active: true,
    }
  }

  return col
}

function resetColumn(col: ColumnData) {
  col.x = rand(-14, 14)
  col.z = rand(-12, 12)
  col.speed = rand(10, 22)
  col.size = rand(0.1, 0.16)
  col.phase = rand(0, Math.PI * 2)
  col.headY = Math.floor(rand(-20, -4))
  col.trailLength = Math.floor(rand(22, 38))
  col.spawnAccumulator = 0
  col.cells = createInactiveCells()
}

export default function MatrixRain() {
  const columns = useMemo(() => Array.from({ length: COLUMN_COUNT }, createColumn), [])
  const groupRefs = useRef<Array<THREE.Group | null>>([])
  const textRefs = useRef<Array<Array<any>>>([])
  const timeRef = useRef(0)

  useFrame((_, delta) => {
    timeRef.current += delta

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i]
      const group = groupRefs.current[i]
      if (!group) continue

      group.position.x = col.x + Math.sin(timeRef.current * 0.25 + col.phase) * 0.03
      group.position.z = col.z

      col.spawnAccumulator += col.speed * delta

      while (col.spawnAccumulator >= 1) {
        col.spawnAccumulator -= 1
        col.headY += 1

        for (let r = 0; r < ROWS; r++) {
          const cell = col.cells[r]
          if (!cell.active) continue
          cell.age += 1
          if (cell.age > col.trailLength) cell.active = false
        }

        if (col.headY >= 0 && col.headY < ROWS) {
          col.cells[col.headY] = {
            char: pick(),
            age: 0,
            active: true,
          }
        }

        for (let k = 0; k < 2; k++) {
          const idx = Math.floor(rand(0, ROWS))
          const cell = col.cells[idx]
          if (cell?.active && Math.random() < 0.5) cell.char = pick()
        }

        if (col.headY - col.trailLength > ROWS) {
          resetColumn(col)
        }
      }

      const texts = textRefs.current[i]
      if (!texts) continue

      for (let r = 0; r < ROWS; r++) {
        const text = texts[r]
        if (!text) continue

        const cell = col.cells[r]
        if (!cell.active) {
          text.visible = false
          continue
        }

        text.visible = true
        text.text = cell.char
        text.position.y = -r * ROW_SPACING
        text.fontSize = col.size

        const fade = 1 - cell.age / col.trailLength
        text.color =
          cell.age === 0
            ? new THREE.Color('#f3fff3')
            : new THREE.Color(
                `rgb(${Math.floor(fade * 24)}, ${Math.floor(95 + fade * 160)}, ${Math.floor(fade * 20)})`,
              )
      }
    }
  })

  return (
    <group position={[0, BASE_Y, 0]}>
      {columns.map((col, i) => (
        <group
          key={i}
          ref={(el) => {
            groupRefs.current[i] = el
          }}
          position={[col.x, 0, col.z]}
        >
          {Array.from({ length: ROWS }, (_, r) => (
            <Text
              key={`${i}-${r}`}
              ref={(el) => {
                if (!textRefs.current[i]) textRefs.current[i] = []
                textRefs.current[i][r] = el
              }}
              visible={false}
              fontSize={col.size}
              color="#00ff66"
              anchorX="center"
              anchorY="middle"
              position={[0, -r * ROW_SPACING, 0]}
            >
              {pick()}
            </Text>
          ))}
        </group>
      ))}
    </group>
  )
}
