import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import MatrixRain from './MatrixRain'

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

      <EffectComposer>
        <Bloom intensity={0.1} luminanceThreshold={0.5} luminanceSmoothing={0.9} />
      </EffectComposer>
    </Canvas>
  )
}
