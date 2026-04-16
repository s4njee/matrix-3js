import { useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import '../index.css'
import MatrixRain from './MatrixRain'
import MatrixRainShader from './MatrixRainShader'
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
import { useFrameRate, type FrameRateQualityTier } from '../../../../src/shared/performance/index.ts'
import SafeCanvas from '../../../../src/shared/webgl/SafeCanvas.tsx'

const MATRIX_SHELL_STYLE = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  zIndex: 10,
} as const

const MATRIX_ENGINE_STORAGE_KEY = 'eva:matrix-engine'

type MatrixRainEngine = 'instanced' | 'shader'

interface MatrixPerfStats {
  activeColumns: number
  activeInstances: number
  uploadedBytesPerFrame: number
  qualityTier: FrameRateQualityTier
}

interface MatrixPerfWindow extends Window {
  __evaMatrixPerfSamples?: Array<{
    scene: 'matrix'
    perf: true
    fps: number
    tier: FrameRateQualityTier
    dpr: number
    activeColumns: number
    activeInstances: number
    uploadedBytesPerFrame: number
    jsHeapBytes: number | null
  }>
}

function isMacLikePlatform() {
  if (typeof navigator === 'undefined') return true

  return navigator.userAgent.includes('Macintosh') || navigator.userAgent.includes('Mac OS X')
}

function getMatrixDprCap(
  qualityTier: FrameRateQualityTier,
  macLikePlatform: boolean,
) {
  if (macLikePlatform) {
    return 2
  }

  if (qualityTier === 'low') {
    return 1
  }

  if (qualityTier === 'medium') {
    return 1.25
  }

  return 1.5
}

function getMatrixPerfEnabled() {
  if (typeof window === 'undefined') return false

  return new URLSearchParams(window.location.search).get('perf') === '1'
}

function isMatrixRainEngine(value: string | null): value is MatrixRainEngine {
  return value === 'instanced' || value === 'shader'
}

function getInitialMatrixRainEngine(): MatrixRainEngine {
  if (typeof window === 'undefined') return 'shader'

  const queryEngine = new URLSearchParams(window.location.search).get('engine')
  if (isMatrixRainEngine(queryEngine)) return queryEngine

  const storedEngine = window.localStorage.getItem(MATRIX_ENGINE_STORAGE_KEY)
  if (isMatrixRainEngine(storedEngine)) return storedEngine

  return 'shader'
}

function getHeapBytes() {
  if (typeof performance === 'undefined') return null

  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize?: number }
  }).memory

  return typeof memory?.usedJSHeapSize === 'number' ? memory.usedJSHeapSize : null
}

function MatrixPerfLogger({
  enabled,
  statsRef,
}: {
  enabled: boolean
  statsRef: MutableRefObject<MatrixPerfStats | null>
}) {
  const { gl } = useThree()
  const { fps, qualityTier } = useFrameRate()
  const snapshotRef = useRef({
    fps: 0,
    qualityTier: 'high' as FrameRateQualityTier,
    dpr: 1,
  })

  snapshotRef.current = {
    fps,
    qualityTier,
    dpr: gl.getPixelRatio(),
  }

  useEffect(() => {
    if (!enabled) return undefined

    const intervalId = window.setInterval(() => {
      const perfSnapshot = snapshotRef.current
      const sceneStats = statsRef.current

      if (!sceneStats) return

      const summary = {
        scene: 'matrix',
        perf: true,
        fps: Number(perfSnapshot.fps.toFixed(2)),
        tier: perfSnapshot.qualityTier,
        dpr: Number(perfSnapshot.dpr.toFixed(2)),
        activeColumns: sceneStats.activeColumns,
        activeInstances: sceneStats.activeInstances,
        uploadedBytesPerFrame: sceneStats.uploadedBytesPerFrame,
        jsHeapBytes: getHeapBytes(),
      } as const

      const matrixWindow = window as MatrixPerfWindow
      matrixWindow.__evaMatrixPerfSamples ??= []
      matrixWindow.__evaMatrixPerfSamples.push(summary)

      if (matrixWindow.__evaMatrixPerfSamples.length > 12) {
        matrixWindow.__evaMatrixPerfSamples.shift()
      }

      console.log(JSON.stringify(summary))
    }, 2000)

    return () => window.clearInterval(intervalId)
  }, [enabled, statsRef])

  return null
}

function MatrixDprCapBridge({
  macLikePlatform,
  setDprCap,
}: {
  macLikePlatform: boolean
  setDprCap: Dispatch<SetStateAction<number>>
}) {
  const { qualityTier } = useFrameRate()

  useEffect(() => {
    const nextDprCap = getMatrixDprCap(qualityTier, macLikePlatform)

    setDprCap((currentDprCap) => (
      Math.abs(currentDprCap - nextDprCap) < 0.01 ? currentDprCap : nextDprCap
    ))
  }, [macLikePlatform, qualityTier, setDprCap])

  return null
}

export default function App() {
  const [effectSettings, setEffectSettings] = useState(MATRIX_EFFECT_DEFAULTS)
  const [paletteName, setPaletteName] = useState<MatrixPaletteName>('phosphor')
  const [rainBoost, setRainBoost] = useState(false)
  const [rainEngine] = useState<MatrixRainEngine>(() => getInitialMatrixRainEngine())
  const [specialEffects, setSpecialEffects] = useState<SharedSpecialEffectState>(() => (
    createInitialSharedSpecialEffectState()
  ))
  const palette = MATRIX_PALETTE_PRESETS[paletteName]
  const macLikePlatform = isMacLikePlatform()
  const [dprCap, setDprCap] = useState(() => (macLikePlatform ? 2 : 1.5))
  const perfEnabled = getMatrixPerfEnabled()
  const perfStatsRef = useRef<MatrixPerfStats | null>(null)
  const frameRateConfig = useMemo(() => (
    perfEnabled ? { forcedQualityTier: 'high' as const } : undefined
  ), [perfEnabled])
  const dprRange = useMemo(() => [0.75, dprCap] as [number, number], [dprCap])

  useEffect(() => {
    window.localStorage.setItem(MATRIX_ENGINE_STORAGE_KEY, rainEngine)
  }, [rainEngine])

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
        dpr={dprRange}
        allowPerformanceCaveat={perfEnabled}
        rendererOptions={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ position: [0, 0, 12], fov: 55 }}
        sceneLabel="Matrix"
        frameRateConfig={frameRateConfig}
      >
        {/* Scene content, controls, and post-processing stay as separate blocks so the render path is easy to scan. */}
        <color attach="background" args={[palette.background]} />
        <fog attach="fog" args={[palette.fog, 8, 30]} />

        {rainEngine === 'shader' ? (
          <MatrixRainShader
            palette={palette}
            rainBoost={rainBoost}
            onPerfStats={(stats) => {
              perfStatsRef.current = stats
            }}
          />
        ) : (
          <MatrixRain
            palette={palette}
            rainBoost={rainBoost}
            onPerfStats={(stats) => {
              perfStatsRef.current = stats
            }}
          />
        )}

        <MatrixDprCapBridge
          macLikePlatform={macLikePlatform}
          setDprCap={setDprCap}
        />

        {perfEnabled ? (
          <MatrixPerfLogger enabled={perfEnabled} statsRef={perfStatsRef} />
        ) : null}

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
