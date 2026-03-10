import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
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

      <MatrixRain
        z={-7}
        scale={1.55}
        opacity={0.08}
        speedMultiplier={0.84}
        textureSize={256}
        density={0.26}
        fadeAlpha={0.14}
        updateEveryNFrames={4}
      />
      <MatrixRain
        z={-4}
        scale={1.32}
        opacity={0.14}
        speedMultiplier={1.08}
        textureSize={320}
        density={0.36}
        fadeAlpha={0.12}
        updateEveryNFrames={3}
      />
      <MatrixRain
        z={-1}
        scale={1.08}
        opacity={0.24}
        speedMultiplier={1.36}
        textureSize={512}
        density={0.52}
        fadeAlpha={0.1}
        updateEveryNFrames={2}
      />
      <MatrixRain
        z={2}
        scale={0.9}
        opacity={0.46}
        speedMultiplier={1.76}
        textureSize={768}
        density={0.74}
        fadeAlpha={0.085}
        updateEveryNFrames={1}
      />
      <MatrixRain
        z={5}
        scale={0.82}
        opacity={0.92}
        speedMultiplier={2.12}
        textureSize={1024}
        density={0.96}
        fadeAlpha={0.07}
        updateEveryNFrames={1}
      />

      <OrbitControls
        enablePan={false}
        minDistance={6}
        maxDistance={22}
        minPolarAngle={Math.PI / 3}
        maxPolarAngle={(Math.PI * 2) / 3}
      />
    </Canvas>
  )
}
