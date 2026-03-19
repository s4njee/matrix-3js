import { Canvas } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import { OrbitControls } from '@react-three/drei'
import MatrixRain from './MatrixRain'
import MatrixEffects from './MatrixEffects'
import { MATRIX_EFFECT_DEFAULTS } from './matrix-effects-config'
import {
  createInitialSharedSpecialEffectState,
  createSharedEffectHotkeyListener,
  createSharedSpecialEffectHandlers,
  type SharedSpecialEffectState,
} from '../../../../src/shared/special-effects/index.ts'

export default function App() {
  const [effectSettings, setEffectSettings] = useState(MATRIX_EFFECT_DEFAULTS)
  const [specialEffects, setSpecialEffects] = useState<SharedSpecialEffectState>(() => (
    createInitialSharedSpecialEffectState()
  ))

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

  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0, 12], fov: 55 }}
      style={{ background: '#000' }}
    >
      {/* Scene content, controls, and post-processing stay as separate blocks so the render path is easy to scan. */}
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
