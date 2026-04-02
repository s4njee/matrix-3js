export type MatrixPaletteName = 'phosphor' | 'amber' | 'ice' | 'ghost'

export interface MatrixPalette {
  background: string
  description: string
  dimTrailColor: [number, number, number]
  fog: string
  headColor: [number, number, number]
  label: string
  trailColor: [number, number, number]
}

export interface MatrixEffectSettings {
  barrelBlurAmount: number
  bloomEnabled: boolean
  bloomIntensity: number
  bloomRadius: number
  bloomSmoothing: number
  bloomThreshold: number
  chromaticModulationOffset: number
  chromaticOffset: number
  chromaticOscillationSpeed: number
  chromaticRadialModulation: boolean
  scanDensity: number
  scanEnabled: boolean
  scanOpacity: number
}

export const MATRIX_EFFECT_DEFAULTS: MatrixEffectSettings = {
  barrelBlurAmount: 0.12,
  bloomEnabled: true,
  bloomIntensity: 2.5,
  bloomRadius: 0.68,
  bloomSmoothing: 0.9,
  bloomThreshold: 0,
  chromaticModulationOffset: 0.15,
  chromaticOffset: 0.004,
  chromaticOscillationSpeed: 3.2,
  chromaticRadialModulation: true,
  scanDensity: 4.1,
  scanEnabled: true,
  scanOpacity: 1,
}

export const MATRIX_PALETTE_PRESETS: Record<MatrixPaletteName, MatrixPalette> = {
  phosphor: {
    background: '#020503',
    description: 'Classic phosphor green with a bright white-green head',
    dimTrailColor: [0.02, 0.38, 0.05],
    fog: '#021109',
    headColor: [0.95, 1, 0.95],
    label: 'Phosphor Green',
    trailColor: [0.1, 1, 0.08],
  },
  amber: {
    background: '#0b0401',
    description: 'Warm terminal amber with copper trails',
    dimTrailColor: [0.28, 0.09, 0.01],
    fog: '#180801',
    headColor: [1, 0.93, 0.72],
    label: 'Amber Terminal',
    trailColor: [1, 0.66, 0.18],
  },
  ice: {
    background: '#01070b',
    description: 'Cold blue scanlines with a cyan edge glow',
    dimTrailColor: [0.02, 0.2, 0.28],
    fog: '#031018',
    headColor: [0.84, 0.98, 1],
    label: 'Ice Blue',
    trailColor: [0.2, 0.92, 1],
  },
  ghost: {
    background: '#040404',
    description: 'Monochrome silver with a softer noir feel',
    dimTrailColor: [0.16, 0.16, 0.16],
    fog: '#101010',
    headColor: [1, 1, 1],
    label: 'Ghost Mono',
    trailColor: [0.82, 0.86, 0.84],
  },
}

export const MATRIX_PALETTE_ORDER: MatrixPaletteName[] = [
  'phosphor',
  'amber',
  'ice',
  'ghost',
]

export function getNextMatrixPaletteName(current: MatrixPaletteName) {
  const currentIndex = MATRIX_PALETTE_ORDER.indexOf(current)
  const nextIndex = currentIndex === -1
    ? 0
    : (currentIndex + 1) % MATRIX_PALETTE_ORDER.length

  return MATRIX_PALETTE_ORDER[nextIndex]
}
