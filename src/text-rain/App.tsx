import { useEffect, useState } from 'react'
import { OrbitControls } from '@react-three/drei'
import MatrixRain from './MatrixRain'
import MatrixEffects from './MatrixEffects'
import {
  MATRIX_EFFECT_DEFAULTS,
  MATRIX_PALETTE_PRESETS,
  getNextMatrixPaletteName,
  type MatrixPaletteName,
} from './matrix-effects-config'
import {
  createInitialSharedSpecialEffectState,
  createSharedEffectHotkeyListener,
  createSharedSpecialEffectHandlers,
  isEditableTarget,
  type SharedSpecialEffectState,
} from '../../../../src/shared/special-effects/index.ts'
import SafeCanvas from '../../../../src/shared/webgl/SafeCanvas.tsx'

export default function App() {
  const [effectSettings, setEffectSettings] = useState(MATRIX_EFFECT_DEFAULTS)
  const [paletteName, setPaletteName] = useState<MatrixPaletteName>('phosphor')
  const [specialEffects, setSpecialEffects] = useState<SharedSpecialEffectState>(() => (
    createInitialSharedSpecialEffectState()
  ))
  const palette = MATRIX_PALETTE_PRESETS[paletteName]

  useEffect(() => {
    // Matrix uses the same post-processing hotkeys as the other scenes, so the
    // shared helper can own the state transitions and keep this shell minimal.
    const onKeyDown = createSharedEffectHotkeyListener(
      createSharedSpecialEffectHandlers(setSpecialEffects),
    )

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isEditableTarget(event.target)) return

      if (event.key === 't' || event.key === 'T') {
        setPaletteName(current => getNextMatrixPaletteName(current))
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <div className="matrix-shell">
      <SafeCanvas
        dpr={[1, 1.5]}
        rendererOptions={{ antialias: false, powerPreference: 'high-performance' }}
        camera={{ position: [0, 0, 12], fov: 55 }}
        sceneLabel="Matrix"
      >
        {/* Scene content, controls, and post-processing stay as separate blocks so the render path is easy to scan. */}
        <color attach="background" args={[palette.background]} />
        <fog attach="fog" args={[palette.fog, 8, 30]} />

        <MatrixRain palette={palette} />

        <OrbitControls
          enablePan={false}
          minDistance={6}
          maxDistance={22}
          minPolarAngle={Math.PI / 3}
          maxPolarAngle={(Math.PI * 2) / 3}
        />

        <MatrixEffects
          effectSettings={effectSettings}
          paletteName={paletteName}
          setEffectSettings={setEffectSettings}
          setPaletteName={setPaletteName}
          specialEffects={specialEffects}
        />
      </SafeCanvas>

      <div className="matrix-status-chip">
        <span>{palette.label}</span>
        <span>Press T to cycle</span>
      </div>
    </div>
  )
}
