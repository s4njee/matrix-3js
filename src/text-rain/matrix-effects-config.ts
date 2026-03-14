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
