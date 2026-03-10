import { useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer, Scanline } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import GUI from 'lil-gui'
import MatrixRain from './MatrixRain'

function Effects() {
  const scanlineRef = useRef<any>(null)
  const bloomRef = useRef<any>(null)

  useEffect(() => {
    const gui = new GUI({ title: 'Effects' })
    gui.hide()

    const params = {
      // Scanline
      scanDensity: 4.1,
      scanOpacity: 1.0,
      scanEnabled: true,
      // Bloom
      bloomIntensity: 0.1,
      bloomThreshold: 0.5,
      bloomSmoothing: 0.9,
    }

    const scanFolder = gui.addFolder('Scanlines')
    scanFolder.add(params, 'scanEnabled').name('Enabled').onChange((v: boolean) => {
      if (scanlineRef.current) scanlineRef.current.blendMode.setBlendFunction(
        v ? BlendFunction.OVERLAY : BlendFunction.SKIP
      )
    })
    scanFolder.add(params, 'scanDensity', 0.1, 5, 0.05).name('Density').onChange((v: number) => {
      if (scanlineRef.current) scanlineRef.current.density = v
    })
    scanFolder.add(params, 'scanOpacity', 0, 1, 0.01).name('Opacity').onChange((v: number) => {
      if (scanlineRef.current) scanlineRef.current.blendMode.opacity.value = v
    })

    const bloomFolder = gui.addFolder('Bloom')
    bloomFolder.add(params, 'bloomIntensity', 0, 2, 0.01).name('Intensity').onChange((v: number) => {
      if (bloomRef.current) bloomRef.current.intensity = v
    })
    bloomFolder.add(params, 'bloomThreshold', 0, 1, 0.01).name('Threshold').onChange((v: number) => {
      if (bloomRef.current) bloomRef.current.luminanceMaterial.threshold = v
    })
    bloomFolder.add(params, 'bloomSmoothing', 0, 1, 0.01).name('Smoothing').onChange((v: number) => {
      if (bloomRef.current) bloomRef.current.luminanceMaterial.smoothing = v
    })

    return () => gui.destroy()
  }, [])

  return (
    <EffectComposer>
      <Scanline
        ref={scanlineRef}
        blendFunction={BlendFunction.OVERLAY}
        density={4.1}
        opacity={1.0}
      />
      <Bloom
        ref={bloomRef}
        intensity={0.1}
        luminanceThreshold={0.5}
        luminanceSmoothing={0.9}
      />
    </EffectComposer>
  )
}

export default function App() {
  return (
    <Canvas
      dpr={1}
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
