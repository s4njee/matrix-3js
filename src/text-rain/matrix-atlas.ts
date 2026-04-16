import * as THREE from 'three'

export const CHARS =
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+=<>?/'

export const CHAR_COUNT = CHARS.length
export const ATLAS_COLS = 10
export const ATLAS_ROWS = Math.ceil(CHAR_COUNT / ATLAS_COLS)

const CELL_PX = 64

export function buildAtlas(): THREE.CanvasTexture {
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
