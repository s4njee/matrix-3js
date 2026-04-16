import { useEffect, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import '../index.css'
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

const MATRIX_SHELL_STYLE = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  zIndex: 10,
} as const

export default function App() {
  const [effectSettings, setEffectSettings] = useState(MATRIX_EFFECT_DEFAULTS)
  const [paletteName, setPaletteName] = useState<MatrixPaletteName>('phosphor')
  const [rainBoost, setRainBoost] = useState(false)
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
      } else if (event.key === ' ') {
        event.preventDefault()
        setRainBoost(true)
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') {
        event.preventDefault()
        setRainBoost(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  return (
    <div className="matrix-shell" style={MATRIX_SHELL_STYLE}>
      <SafeCanvas
        dpr={[0.75, 2]}
        rendererOptions={{ antialias: false, powerPreference: 'high-performance' }}
        camera={{ position: [0, 0, 12], fov: 55 }}
        sceneLabel="Matrix"
      >
        {/* Scene content, controls, and post-processing stay as separate blocks so the render path is easy to scan. */}
        <color attach="background" args={[palette.background]} />
        <fog attach="fog" args={[palette.fog, 8, 30]} />

        <MatrixRain palette={palette} rainBoost={rainBoost} />

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
