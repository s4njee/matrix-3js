import { useFrame, useThree } from '@react-three/fiber';
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

export type FrameRateQualityTier = 'high' | 'medium' | 'low';

export interface FrameRateThresholds {
  high: number;
  medium: number;
}

export interface FrameRateMonitorConfig {
  forcedQualityTier?: FrameRateQualityTier | null;
  publishIntervalMs: number;
  sampleSize: number;
  smoothingFactor: number;
  thresholds: FrameRateThresholds;
}

export interface FrameRateSnapshot {
  dpr: number;
  fps: number;
  frameCount: number;
  qualityTier: FrameRateQualityTier;
  sampleCount: number;
  thresholds: FrameRateThresholds;
}

const DEFAULT_FRAME_RATE_THRESHOLDS: FrameRateThresholds = Object.freeze({
  high: 50,
  medium: 35,
});

const DEFAULT_FRAME_RATE_LOW_QUALITY_THRESHOLD = 30;

export const DEFAULT_FRAME_RATE_MONITOR_CONFIG: FrameRateMonitorConfig = Object.freeze({
  forcedQualityTier: null,
  publishIntervalMs: 400,
  sampleSize: 90,
  smoothingFactor: 0.2,
  thresholds: DEFAULT_FRAME_RATE_THRESHOLDS,
});

const DEFAULT_FRAME_RATE_SNAPSHOT: FrameRateSnapshot = Object.freeze({
  dpr: 1,
  fps: 0,
  frameCount: 0,
  qualityTier: 'high',
  sampleCount: 0,
  thresholds: DEFAULT_FRAME_RATE_THRESHOLDS,
});

const FRAME_RATE_HUD_STYLE = {
  position: 'absolute',
  right: '16px',
  bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
  zIndex: 30,
  pointerEvents: 'none',
  display: 'flex',
  gap: '8px',
  alignItems: 'center',
  padding: '8px 10px',
  borderRadius: '999px',
  border: '1px solid rgba(255, 255, 255, 0.18)',
  background: 'rgba(6, 10, 16, 0.72)',
  color: 'rgba(255, 255, 255, 0.88)',
  font: "600 0.72rem/1 'Avenir Next', 'Segoe UI', sans-serif",
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  backdropFilter: 'blur(10px)',
} as const;

const FRAME_RATE_BADGE_STYLE = {
  minWidth: '54px',
  padding: '4px 6px',
  borderRadius: '999px',
  textAlign: 'center',
  font: "700 0.68rem/1 'Anton', sans-serif",
  letterSpacing: '0.12em',
} as const;

const FrameRateContext = createContext<FrameRateSnapshot>(DEFAULT_FRAME_RATE_SNAPSHOT);

const FrameRateConfigContext = createContext<FrameRateMonitorConfig>(DEFAULT_FRAME_RATE_MONITOR_CONFIG);

const FrameRateDispatchContext = createContext<Dispatch<SetStateAction<FrameRateSnapshot>> | null>(null);

function getFrameRateQualityTier(
  fps: number,
  thresholds: FrameRateThresholds,
  forcedQualityTier: FrameRateQualityTier | null = null,
): FrameRateQualityTier {
  if (forcedQualityTier) return forcedQualityTier;
  if (fps < DEFAULT_FRAME_RATE_LOW_QUALITY_THRESHOLD) return 'low';
  if (fps < thresholds.high) return 'medium';
  return 'high';
}

function mergeFrameRateMonitorConfig(
  config?: Partial<FrameRateMonitorConfig>,
): FrameRateMonitorConfig {
  return {
    ...DEFAULT_FRAME_RATE_MONITOR_CONFIG,
    ...config,
    thresholds: {
      ...DEFAULT_FRAME_RATE_MONITOR_CONFIG.thresholds,
      ...config?.thresholds,
    },
  };
}

export function FrameRateMonitorProvider({
  children,
  config,
}: {
  children: ReactNode;
  config?: Partial<FrameRateMonitorConfig>;
}) {
  const mergedConfig = useMemo(() => mergeFrameRateMonitorConfig(config), [config]);
  const [snapshot, setSnapshot] = useState<FrameRateSnapshot>({
    ...DEFAULT_FRAME_RATE_SNAPSHOT,
    qualityTier: mergedConfig.forcedQualityTier ?? DEFAULT_FRAME_RATE_SNAPSHOT.qualityTier,
    thresholds: mergedConfig.thresholds,
  });

  return (
    <FrameRateConfigContext.Provider value={mergedConfig}>
      <FrameRateDispatchContext.Provider value={setSnapshot}>
        <FrameRateContext.Provider value={snapshot}>
          {children}
        </FrameRateContext.Provider>
      </FrameRateDispatchContext.Provider>
    </FrameRateConfigContext.Provider>
  );
}

export function FrameRateMonitorBridge() {
  const config = useContext(FrameRateConfigContext);
  const setSnapshot = useContext(FrameRateDispatchContext);
  const { gl } = useThree();
  const frameTimesRef = useRef<number[]>([]);
  const totalFrameTimeRef = useRef(0);
  const frameCountRef = useRef(0);
  const smoothedFpsRef = useRef(0);
  const lastPublishTimeRef = useRef(0);

  useFrame((_, delta) => {
    if (!setSnapshot || !Number.isFinite(delta) || delta <= 0) {
      return;
    }

    const frameTime = delta * 1000;
    frameCountRef.current += 1;
    frameTimesRef.current.push(frameTime);
    totalFrameTimeRef.current += frameTime;

    if (frameTimesRef.current.length > config.sampleSize) {
      const oldestFrameTime = frameTimesRef.current.shift();

      if (oldestFrameTime !== undefined) {
        totalFrameTimeRef.current -= oldestFrameTime;
      }
    }

    if (frameTimesRef.current.length === 0) {
      return;
    }

    const averageFrameTime = totalFrameTimeRef.current / frameTimesRef.current.length;
    const rawFps = averageFrameTime > 0 ? 1000 / averageFrameTime : 0;

    smoothedFpsRef.current = smoothedFpsRef.current === 0
      ? rawFps
      : smoothedFpsRef.current
        + (rawFps - smoothedFpsRef.current) * config.smoothingFactor;

    const now = performance.now();

    if (
      lastPublishTimeRef.current !== 0
      && now - lastPublishTimeRef.current < config.publishIntervalMs
    ) {
      return;
    }

    lastPublishTimeRef.current = now;

    const nextSnapshot: FrameRateSnapshot = {
      dpr: gl.getPixelRatio(),
      fps: smoothedFpsRef.current,
      frameCount: frameCountRef.current,
      qualityTier: getFrameRateQualityTier(
        smoothedFpsRef.current,
        config.thresholds,
        config.forcedQualityTier ?? null,
      ),
      sampleCount: frameTimesRef.current.length,
      thresholds: config.thresholds,
    };

    setSnapshot((currentSnapshot) => {
      if (
        currentSnapshot.qualityTier === nextSnapshot.qualityTier
        && Math.abs(currentSnapshot.fps - nextSnapshot.fps) < 0.25
        && currentSnapshot.sampleCount === nextSnapshot.sampleCount
        && Math.abs(currentSnapshot.dpr - nextSnapshot.dpr) < 0.01
      ) {
        return currentSnapshot;
      }

      return {
        ...nextSnapshot,
      };
    });
  });

  return null;
}

export function FrameRateHud({
  label = 'FPS',
}: {
  label?: string;
}) {
  const { dpr, fps, qualityTier, sampleCount } = useFrameRate();
  const badgeStyle = useMemo(() => ({
    ...FRAME_RATE_BADGE_STYLE,
    background: qualityTier === 'high'
      ? 'rgba(58, 191, 113, 0.2)'
      : 'rgba(255, 107, 107, 0.2)',
    color: qualityTier === 'high'
      ? '#7dffad'
      : '#ff9d9d',
  }), [qualityTier]);

  return (
    <div style={FRAME_RATE_HUD_STYLE} aria-live="polite">
      <span style={badgeStyle}>{qualityTier}</span>
      <span>
        {label}
        {' '}
        {sampleCount > 0 ? Math.round(fps) : '--'}
      </span>
      <span>
        DPR
        {' '}
        {dpr.toFixed(2)}
      </span>
    </div>
  );
}

export function useFrameRate() {
  return useContext(FrameRateContext);
}

export function useFrameRateConfig() {
  return useContext(FrameRateConfigContext);
}

export function useFrameRateDispatch() {
  return useContext(FrameRateDispatchContext);
}

export { DEFAULT_FRAME_RATE_THRESHOLDS, getFrameRateQualityTier };
