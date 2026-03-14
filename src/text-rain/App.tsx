import { Canvas } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import { OrbitControls } from '@react-three/drei'
import MatrixRain from './MatrixRain'
import MatrixEffects from './MatrixEffects'
import { MATRIX_EFFECT_DEFAULTS } from './matrix-effects-config'
import {
  createSharedEffectHotkeyListener,
  type SharedFxMode,
  SHARED_FX_CINEMATIC,
  SHARED_FX_DATABEND,
  SHARED_FX_NONE,
  toggleChromaticAberrationState,
  toggleHueCycleState,
  toggleSharedFxMode,
  toggleXrayModeState,
} from '../../../../src/shared/special-effects/shared-special-effects.ts'

interface MatrixSpecialEffectsState {
  chromaticAberrationEnabled: boolean
  currentFx: SharedFxMode
  hue: number
  hueCycleBaseHue: number
  hueCycleEnabled: boolean
  hueCycleSavedEnabled: boolean
  hueCycleSavedHue: number
  hueCycleSavedSaturation: number
  hueCycleStartTime: number
  hueSatEnabled: boolean
  pixelMosaicEnabled: boolean
  restoreChromaticAfterXray: boolean
  saturation: number
  thermalVisionEnabled: boolean
  xrayMode: boolean
}

export default function App() {
  const [effectSettings, setEffectSettings] = useState(MATRIX_EFFECT_DEFAULTS)
  const [specialEffects, setSpecialEffects] = useState<MatrixSpecialEffectsState>({
    chromaticAberrationEnabled: false,
    currentFx: SHARED_FX_NONE,
    hue: 0,
    hueCycleBaseHue: 0,
    hueCycleEnabled: false,
    hueCycleSavedEnabled: false,
    hueCycleSavedHue: 0,
    hueCycleSavedSaturation: 0,
    hueCycleStartTime: 0,
    hueSatEnabled: false,
    pixelMosaicEnabled: false,
    restoreChromaticAfterXray: false,
    saturation: 0,
    thermalVisionEnabled: false,
    xrayMode: false,
  })

  useEffect(() => {
    const onKeyDown = createSharedEffectHotkeyListener({
      cinematic: () => {
        setSpecialEffects((current) => ({
          ...current,
          currentFx: toggleSharedFxMode(current.currentFx, SHARED_FX_CINEMATIC),
        }))
      },
      chromaticAberration: () => {
        setSpecialEffects((current) => ({
          ...current,
          ...toggleChromaticAberrationState(current),
        }))
      },
      databend: () => {
        setSpecialEffects((current) => ({
          ...current,
          currentFx: toggleSharedFxMode(current.currentFx, SHARED_FX_DATABEND),
        }))
      },
      hueCycle: () => {
        setSpecialEffects((current) => ({
          ...current,
          ...toggleHueCycleState(current, performance.now() / 1000),
        }))
      },
      pixelMosaic: () => {
        setSpecialEffects((current) => ({
          ...current,
          pixelMosaicEnabled: !current.pixelMosaicEnabled,
        }))
      },
      thermalVision: () => {
        setSpecialEffects((current) => ({
          ...current,
          thermalVisionEnabled: !current.thermalVisionEnabled,
        }))
      },
      xrayMode: () => {
        setSpecialEffects((current) => ({
          ...current,
          ...toggleXrayModeState(current),
        }))
      },
    })

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <Canvas
      dpr={2}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0, 12], fov: 55 }}
      style={{ background: '#000' }}
    >
      <fog attach="fog" args={['#000000', 8, 30]} />

      <MatrixRain />

      <OrbitControls
        enablePan={false}
        minDistance={6}
        maxDistance={22}
        minPolarAngle={Math.PI / 3}
        maxPolarAngle={(Math.PI * 2) / 3}
      />

      <MatrixEffects
        effectSettings={effectSettings}
        setEffectSettings={setEffectSettings}
        specialEffects={specialEffects}
      />
    </Canvas>
  )
}
