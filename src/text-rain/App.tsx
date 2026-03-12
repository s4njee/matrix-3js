import { useEffect, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer, Scanline } from '@react-three/postprocessing'
import { BlendFunction, BloomEffect, ScanlineEffect } from 'postprocessing'
import GUI from 'lil-gui'
import MatrixRain from './MatrixRain'
import { MonolithPixelGlitchEffect } from './MonolithPixelGlitchEffect'

const effectParams = {
  scanDensity: 4.1,
  scanOpacity: 1.0,
  scanEnabled: true,
  bloomIntensity: 2.5,
  bloomThreshold: 0,
  bloomSmoothing: 0.9,
}

function Effects() {
  const scanlineRef = useRef<ScanlineEffect | null>(null)
  const bloomRef = useRef<BloomEffect | null>(null)
  const glitchEffect = useMemo(() => new MonolithPixelGlitchEffect(), [])

  useEffect(() => {
    const gui = new GUI({ title: 'Effects', width: 280 })
    gui.domElement.style.zIndex = '20'
    gui.hide()

    const scanFolder = gui.addFolder('Scanlines')
    scanFolder.add(effectParams, 'scanEnabled').name('Enabled').onChange((v: boolean) => {
      if (scanlineRef.current) scanlineRef.current.blendMode.setBlendFunction(
        v ? BlendFunction.OVERLAY : BlendFunction.SKIP
      )
    })
    scanFolder.add(effectParams, 'scanDensity', 0.1, 5, 0.05).name('Density').onChange((v: number) => {
      if (scanlineRef.current) scanlineRef.current.density = v
    })
    scanFolder.add(effectParams, 'scanOpacity', 0, 1, 0.01).name('Opacity').onChange((v: number) => {
      if (scanlineRef.current) scanlineRef.current.blendMode.opacity.value = v
    })
    scanFolder.open()

    const bloomFolder = gui.addFolder('Bloom')
    bloomFolder.add(effectParams, 'bloomIntensity', 0, 3, 0.01).name('Intensity').onChange((v: number) => {
      if (bloomRef.current) bloomRef.current.intensity = v
    })
    bloomFolder.add(effectParams, 'bloomThreshold', 0, 1, 0.01).name('Threshold').onChange((v: number) => {
      if (bloomRef.current) bloomRef.current.luminanceMaterial.threshold = v
    })
    bloomFolder.add(effectParams, 'bloomSmoothing', 0, 1, 0.01).name('Smoothing').onChange((v: number) => {
      if (bloomRef.current) bloomRef.current.luminanceMaterial.smoothing = v
    })
    bloomFolder.open()

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()

      if (key === 'z' && !event.repeat) {
        glitchEffect.trigger()
        return
      }

      if (key === 'g' && !event.repeat) {
        if (gui._hidden) {
          gui.show()
          return
        }
        gui.hide()
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      gui.destroy()
    }
  }, [glitchEffect])

  return (
    <EffectComposer>
      <Scanline
        ref={scanlineRef}
        blendFunction={effectParams.scanEnabled ? BlendFunction.OVERLAY : BlendFunction.SKIP}
        density={effectParams.scanDensity}
        opacity={effectParams.scanOpacity}
      />
      <Bloom
        ref={bloomRef}
        intensity={effectParams.bloomIntensity}
        luminanceThreshold={effectParams.bloomThreshold}
        luminanceSmoothing={effectParams.bloomSmoothing}
      />
      <primitive object={glitchEffect} />
    </EffectComposer>
  )
}

export default function App() {
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

      <Effects />
    </Canvas>
  )
}
