import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const CHARS =
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+=<>?/'

const FONT_SIZE = 12
const rand = (min: number, max: number) => Math.random() * (max - min) + min
const pick = () => CHARS[Math.floor(Math.random() * CHARS.length)]

interface Drop {
  x: number
  head: number
  speed: number
  length: number
  chars: string[]
}

interface MatrixRainProps {
  width?: number
  height?: number
  z?: number
  scale?: number
  opacity?: number
  speedMultiplier?: number
  textureSize?: number
  density?: number
  fadeAlpha?: number
  updateEveryNFrames?: number
}

function createDrop(x: number, rows: number, speedMultiplier: number): Drop {
  const length = Math.floor(rand(18, 44))
  return {
    x,
    head: Math.floor(rand(-rows * 0.25, rows)),
    speed: rand(0.18, 0.55) * speedMultiplier,
    length,
    chars: Array.from({ length }, pick),
  }
}

export default function MatrixRain({
  width = 28,
  height = 22,
  z = 0,
  scale = 1,
  opacity = 1,
  speedMultiplier = 1,
  textureSize = 1024,
  density = 0.92,
  fadeAlpha = 0.075,
  updateEveryNFrames = 1,
}: MatrixRainProps) {
  const texWidth = textureSize
  const texHeight = textureSize
  const cols = Math.floor(texWidth / FONT_SIZE)
  const rows = Math.floor(texHeight / FONT_SIZE)

  const canvasEl = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = texWidth
    c.height = texHeight
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, texWidth, texHeight)
    return c
  }, [texHeight, texWidth])

  const texture = useMemo(() => {
    const tex = new THREE.CanvasTexture(canvasEl)
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.NearestFilter
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    return tex
  }, [canvasEl])

  const drops = useRef<Drop[]>([])
  const frameRef = useRef(0)

  useMemo(() => {
    const seeded: Drop[] = []
    for (let i = 0; i < cols; i++) {
      if (Math.random() < density) seeded.push(createDrop(i, rows, speedMultiplier))
    }
    drops.current = seeded
  }, [cols, density, rows, speedMultiplier])

  useEffect(() => {
    return () => texture.dispose()
  }, [texture])

  useFrame(() => {
    frameRef.current += 1
    if (frameRef.current % updateEveryNFrames !== 0) return

    const ctx = canvasEl.getContext('2d')!

    ctx.fillStyle = `rgba(0, 0, 0, ${fadeAlpha})`
    ctx.fillRect(0, 0, texWidth, texHeight)

    ctx.imageSmoothingEnabled = false
    ctx.font = `${FONT_SIZE}px "Menlo", "Consolas", "Courier New", monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'

    for (const drop of drops.current) {
      drop.head += drop.speed * updateEveryNFrames

      if (Math.random() < 0.06) {
        const idx = Math.floor(Math.random() * drop.length)
        drop.chars[idx] = pick()
      }

      for (let j = 0; j < drop.length; j++) {
        const row = Math.floor(drop.head) - j
        if (row < 0 || row >= rows) continue

        const x = drop.x * FONT_SIZE + FONT_SIZE / 2
        const y = row * FONT_SIZE
        const fade = 1 - j / drop.length

        if (j === 0) {
          ctx.fillStyle = '#f0fff0'
          ctx.shadowColor = '#00ff66'
          ctx.shadowBlur = 8
        } else {
          const g = Math.floor(95 + fade * 160)
          const alpha = 0.16 + fade * 0.78
          ctx.fillStyle = `rgba(0, ${g}, 0, ${alpha})`
          ctx.shadowBlur = 0
        }

        ctx.fillText(drop.chars[j], x, y)
      }

      if (drop.head - drop.length > rows) {
        drop.head = rand(-rows * 0.35, -4)
        drop.speed = rand(0.18, 0.55) * speedMultiplier
        drop.length = Math.floor(rand(18, 44))
        drop.chars = Array.from({ length: drop.length }, pick)
      }
    }

    ctx.shadowBlur = 0
    texture.needsUpdate = true
  })

  return (
    <mesh position={[0, 0, z]} scale={[scale, scale, 1]}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent opacity={opacity} side={THREE.DoubleSide} />
    </mesh>
  )
}
