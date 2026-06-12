import { Canvas, type CanvasProps, useThree } from '@react-three/fiber';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { WebGLRenderer, type WebGLRendererParameters } from 'three';

function isWebGPUSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}
import {
  FrameRateHud,
  FrameRateMonitorBridge,
  FrameRateMonitorProvider,
  type FrameRateMonitorConfig,
  useFrameRateDispatch,
  useFrameRate,
} from '../performance/index.ts';

const R3F_DEFAULT_RENDERER_OPTIONS: WebGLRendererParameters = {
  alpha: true,
  antialias: true,
  powerPreference: 'high-performance',
};

const SHELL_STYLE = {
  position: 'relative',
  width: '100%',
  height: '100%',
} as const;

const STATUS_STYLE = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  padding: '24px',
  color: 'rgba(255, 255, 255, 0.86)',
  background: '#020406',
  textAlign: 'center',
} as const;

const CARD_STYLE = {
  width: 'min(100%, 420px)',
  padding: '18px 20px',
  border: '1px solid rgba(255, 255, 255, 0.16)',
  borderRadius: '18px',
  background: 'rgba(6, 10, 16, 0.78)',
  boxShadow: '0 22px 60px rgba(0, 0, 0, 0.3)',
} as const;

const EYEBROW_STYLE = {
  margin: '0 0 10px',
  font: "700 0.72rem/1 'Anton', sans-serif",
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
} as const;

const TITLE_STYLE = {
  margin: '0 0 10px',
  font: "700 clamp(1.15rem, 2vw, 1.5rem) / 1.1 'Anton', sans-serif",
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
} as const;

const BODY_STYLE = {
  margin: 0,
  font: "500 0.92rem/1.55 'Avenir Next', 'Segoe UI', sans-serif",
  color: 'rgba(255, 255, 255, 0.74)',
} as const;

const DEFAULT_DEVICE_PIXEL_RATIO = 1;
const DEFAULT_MAX_DEVICE_PIXEL_RATIO = 2;
const LOW_END_DEVICE_PIXEL_RATIO = 0.75;
const LOW_END_MAX_DEVICE_PIXEL_RATIO = 2;
const ADAPTIVE_DPR_SUSTAIN_MS = 3000;
const LOW_END_ADAPTIVE_DPR_SUSTAIN_MS = 1200;
const DPR_PRECISION = 100;
const DPR_EPSILON = 0.01;

type SafeCanvasProps = Omit<CanvasProps, 'fallback' | 'gl'> & {
  fallback?: ReactNode;
  allowPerformanceCaveat?: boolean;
  frameRateConfig?: Partial<FrameRateMonitorConfig>;
  rendererOptions?: WebGLRendererParameters;
  sceneLabel?: string;
  showFrameRateOverlay?: boolean;
  /** Opt in to the WebGPU renderer (requires ?webgpu=1 or explicit prop). Falls back to WebGL silently when the browser lacks WebGPU. */
  webgpuEnabled?: boolean;
};

type ProbeState =
  | { status: 'pending' }
  | { status: 'ready'; options: WebGLRendererParameters; performanceCaveat: boolean }
  | { status: 'unsupported'; error: Error };

const probeCache = new Map<string, ProbeState>();

function normalizeRendererOptions(
  options: WebGLRendererParameters,
): WebGLRendererParameters {
  return Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined),
  ) as WebGLRendererParameters;
}

function getRendererCandidates(
  requestedOptions: WebGLRendererParameters,
): WebGLRendererParameters[] {
  const candidates = [
    requestedOptions,
    { ...requestedOptions, powerPreference: 'default' },
    { ...requestedOptions, antialias: false },
    {
      ...requestedOptions,
      antialias: false,
      powerPreference: 'default',
    },
    requestedOptions.alpha === true
      ? {
          ...requestedOptions,
          alpha: false,
          antialias: false,
          powerPreference: 'default',
        }
      : null,
  ];

  const seen = new Set<string>();

  return candidates
    .filter((candidate): candidate is WebGLRendererParameters => candidate !== null)
    .map((candidate) => normalizeRendererOptions(candidate))
    .filter((candidate) => {
      const key = JSON.stringify(candidate);

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

function getRendererProbeKey(options: WebGLRendererParameters) {
  return JSON.stringify(options);
}

function stripPerformanceCaveatFlag(
  options: WebGLRendererParameters,
): WebGLRendererParameters {
  const { failIfMajorPerformanceCaveat: _failIfMajorPerformanceCaveat, ...rendererOptions } = options;
  return rendererOptions;
}

function getDevicePixelRatio() {
  if (
    typeof window === 'undefined'
    || !Number.isFinite(window.devicePixelRatio)
    || window.devicePixelRatio <= 0
  ) {
    return DEFAULT_DEVICE_PIXEL_RATIO;
  }

  return window.devicePixelRatio;
}

function roundDpr(value: number) {
  return Math.round(value * DPR_PRECISION) / DPR_PRECISION;
}

function clampDpr(value: number, min: number, max: number) {
  return roundDpr(Math.min(Math.max(value, min), max));
}

function normalizeDprProp(dpr: CanvasProps['dpr'], lowEndRenderer: boolean) {
  const deviceDpr = getDevicePixelRatio();

  if (Array.isArray(dpr)) {
    const [rawMin, rawMax] = dpr;
    const minDpr = Math.min(Math.min(rawMin, rawMax), LOW_END_DEVICE_PIXEL_RATIO);
    const maxDpr = lowEndRenderer
      ? Math.min(Math.max(rawMin, rawMax), LOW_END_MAX_DEVICE_PIXEL_RATIO)
      : Math.min(Math.max(rawMin, rawMax), DEFAULT_MAX_DEVICE_PIXEL_RATIO);

    return {
      minDpr,
      maxDpr,
      initialDpr: clampDpr(deviceDpr, minDpr, maxDpr),
    };
  }

  if (typeof dpr === 'number' && Number.isFinite(dpr) && dpr > 0) {
    const exactDpr = roundDpr(dpr);

    return {
      minDpr: Math.min(LOW_END_DEVICE_PIXEL_RATIO, exactDpr),
      maxDpr: lowEndRenderer ? Math.min(exactDpr, LOW_END_MAX_DEVICE_PIXEL_RATIO) : exactDpr,
      initialDpr: clampDpr(
        lowEndRenderer ? LOW_END_MAX_DEVICE_PIXEL_RATIO : exactDpr,
        Math.min(LOW_END_DEVICE_PIXEL_RATIO, exactDpr),
        lowEndRenderer ? Math.min(exactDpr, LOW_END_MAX_DEVICE_PIXEL_RATIO) : exactDpr,
      ),
    };
  }

  const maxDpr = Math.min(
    deviceDpr,
    lowEndRenderer ? LOW_END_MAX_DEVICE_PIXEL_RATIO : DEFAULT_MAX_DEVICE_PIXEL_RATIO,
  );

  return {
    minDpr: LOW_END_DEVICE_PIXEL_RATIO,
    maxDpr,
    initialDpr: clampDpr(deviceDpr, LOW_END_DEVICE_PIXEL_RATIO, maxDpr),
  };
}

function buildAdaptiveDprSteps(dpr: CanvasProps['dpr'], lowEndRenderer: boolean) {
  const { minDpr, maxDpr, initialDpr } = normalizeDprProp(dpr, lowEndRenderer);
  const mediumDpr = clampDpr(lowEndRenderer ? 0.9 : 1.25, minDpr, maxDpr);
  const lowDpr = clampDpr(LOW_END_DEVICE_PIXEL_RATIO, minDpr, maxDpr);
  const steps = [initialDpr, mediumDpr, lowDpr].filter((value, index, values) => (
    values.findIndex((candidate) => Math.abs(candidate - value) < DPR_EPSILON) === index
  ));

  return steps;
}

function getDprPropKey(dpr: CanvasProps['dpr']) {
  if (Array.isArray(dpr)) {
    return `${dpr[0]}:${dpr[1]}`;
  }

  if (typeof dpr === 'number') {
    return `${dpr}`;
  }

  return 'default';
}

function probeRendererOptions(options: WebGLRendererParameters): ProbeState {
  const probeKey = getRendererProbeKey(options);
  const cachedProbe = probeCache.get(probeKey);

  if (cachedProbe) {
    return cachedProbe;
  }

  if (typeof document === 'undefined') {
    return { status: 'pending' };
  }

  let lastError = new Error('WebGL 2 is unavailable in this browser.');

  if (options.failIfMajorPerformanceCaveat !== false) {
    for (const candidate of getRendererCandidates({
      ...options,
      failIfMajorPerformanceCaveat: true,
    })) {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('webgl2', {
        alpha: candidate.alpha,
        antialias: candidate.antialias,
        depth: candidate.depth,
        failIfMajorPerformanceCaveat: candidate.failIfMajorPerformanceCaveat,
        powerPreference: candidate.powerPreference,
        premultipliedAlpha: candidate.premultipliedAlpha,
        preserveDrawingBuffer: candidate.preserveDrawingBuffer,
        stencil: candidate.stencil,
      });

      if (context) {
        const supportedProbe = {
          status: 'ready',
          options: stripPerformanceCaveatFlag(candidate),
          performanceCaveat: false,
        } as const;
        probeCache.set(probeKey, supportedProbe);
        return supportedProbe;
      }

      lastError = new Error(
        `WebGL 2 context creation failed for ${JSON.stringify(candidate)}.`,
      );
    }
  }

  for (const candidate of getRendererCandidates(options)) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2', {
      alpha: candidate.alpha,
      antialias: candidate.antialias,
      depth: candidate.depth,
      failIfMajorPerformanceCaveat: candidate.failIfMajorPerformanceCaveat,
      powerPreference: candidate.powerPreference,
      premultipliedAlpha: candidate.premultipliedAlpha,
      preserveDrawingBuffer: candidate.preserveDrawingBuffer,
      stencil: candidate.stencil,
    });

    if (context) {
      const supportedProbe = {
        status: 'ready',
        options: candidate,
        performanceCaveat: options.failIfMajorPerformanceCaveat !== false,
      } as const;
      probeCache.set(probeKey, supportedProbe);
      return supportedProbe;
    }

    lastError = new Error(
      `WebGL 2 context creation failed for ${JSON.stringify(candidate)}.`,
    );
  }

  const unsupportedProbe = { status: 'unsupported', error: lastError } as const;
  probeCache.set(probeKey, unsupportedProbe);
  return unsupportedProbe;
}

function shouldShowPerformanceOverlay() {
  if (typeof window === 'undefined') return true;

  const params = new URLSearchParams(window.location.search);
  let localStorageDisabled = false;

  try {
    localStorageDisabled = window.localStorage.getItem('eva:perf-overlay') === '0';
  } catch {
    localStorageDisabled = false;
  }

  return !(params.has('no-perf') || params.has('no-fps') || localStorageDisabled);
}

function usePageVisibility() {
  const [visible, setVisible] = useState(() => (
    typeof document === 'undefined' ? true : !document.hidden
  ));

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const onVisibilityChange = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  return visible;
}

function FrameRateDprBridge({ dpr }: { dpr: number }) {
  const setSnapshot = useFrameRateDispatch();

  useEffect(() => {
    if (!setSnapshot) return;

    setSnapshot((currentSnapshot) => {
      if (Math.abs(currentSnapshot.dpr - dpr) < DPR_EPSILON) {
        return currentSnapshot;
      }

      return {
        ...currentSnapshot,
        dpr,
      };
    });
  }, [dpr, setSnapshot]);

  return null;
}

// Runs inside the R3F Canvas. Reads the shared FPS monitor and requests DPR
// reductions only after the scene stays in a lower band long enough to avoid
// oscillation from short-lived frame spikes.
function AdaptiveDprBridge({
  currentDpr,
  dprSteps,
  onDprChange,
  sustainMs,
}: {
  currentDpr: number;
  dprSteps: number[];
  onDprChange: (nextDpr: number) => void;
  sustainMs: number;
}) {
  const { gl } = useThree();
  const { fps, sampleCount, thresholds } = useFrameRate();
  const transitionDirectionRef = useRef<'up' | 'down' | null>(null);
  const transitionStartTimeRef = useRef(0);
  const currentStepIndex = useMemo(() => {
    const matchedStepIndex = dprSteps.findIndex((step) => Math.abs(step - currentDpr) < DPR_EPSILON);

    return matchedStepIndex === -1 ? 0 : matchedStepIndex;
  }, [currentDpr, dprSteps]);

  useEffect(() => {
    gl.setPixelRatio(currentDpr);
  }, [currentDpr, gl]);

  useEffect(() => {
    if (sampleCount === 0 || dprSteps.length <= 1) {
      transitionDirectionRef.current = null;
      transitionStartTimeRef.current = 0;
      return;
    }

    const canStepDown = currentStepIndex < dprSteps.length - 1;
    const canStepUp = currentStepIndex > 0;
    const downThreshold = canStepDown
      ? (currentStepIndex === 0 && dprSteps.length > 2 ? thresholds.high : thresholds.medium)
      : null;
    const upThreshold = canStepUp
      ? (currentStepIndex === 1 && dprSteps.length > 2 ? thresholds.high : thresholds.medium)
      : null;
    const nextDirection = canStepDown && downThreshold !== null && fps < downThreshold
      ? 'down'
      : canStepUp && upThreshold !== null && fps >= upThreshold
        ? 'up'
        : null;

    if (nextDirection === null) {
      transitionDirectionRef.current = null;
      transitionStartTimeRef.current = 0;
      return;
    }

    const now = performance.now();

    if (transitionDirectionRef.current !== nextDirection) {
      transitionDirectionRef.current = nextDirection;
      transitionStartTimeRef.current = now;
      return;
    }

    if (now - transitionStartTimeRef.current < sustainMs) {
      return;
    }

    transitionDirectionRef.current = null;
    transitionStartTimeRef.current = 0;
    onDprChange(dprSteps[currentStepIndex + (nextDirection === 'down' ? 1 : -1)]);
  }, [currentStepIndex, dprSteps, fps, onDprChange, sampleCount, sustainMs, thresholds]);

  return null;
}

function SafeCanvasStatus({
  eyebrow,
  title,
  message,
}: {
  eyebrow: string;
  title: string;
  message: string;
}) {
  return (
    <div style={STATUS_STYLE}>
      <div style={CARD_STYLE}>
        <p style={EYEBROW_STYLE}>{eyebrow}</p>
        <h2 style={TITLE_STYLE}>{title}</h2>
        <p style={BODY_STYLE}>{message}</p>
      </div>
    </div>
  );
}

export default function SafeCanvas({
  children,
  dpr: requestedDpr,
  fallback,
  allowPerformanceCaveat = false,
  frameRateConfig,
  rendererOptions,
  sceneLabel = 'Scene',
  showFrameRateOverlay,
  webgpuEnabled = false,
  ...props
}: SafeCanvasProps) {
  const requestedOptions = useMemo(
    () => normalizeRendererOptions({
      ...R3F_DEFAULT_RENDERER_OPTIONS,
      ...rendererOptions,
    }),
    [rendererOptions],
  );
  const probeOptions = useMemo(
    () => (
      allowPerformanceCaveat
        ? { ...requestedOptions, failIfMajorPerformanceCaveat: false }
        : requestedOptions
    ),
    [allowPerformanceCaveat, requestedOptions],
  );
  const probeKey = useMemo(
    () => getRendererProbeKey(probeOptions),
    [probeOptions],
  );
  const [probe, setProbe] = useState<ProbeState>(() => {
    if (webgpuEnabled && isWebGPUSupported()) return { status: 'pending' };
    if (typeof document === 'undefined') return { status: 'pending' };
    return probeCache.get(probeKey) ?? { status: 'pending' };
  });

  useEffect(() => {
    if (webgpuEnabled && isWebGPUSupported()) return;
    setProbe(probeRendererOptions(probeOptions));
  }, [probeKey, probeOptions, webgpuEnabled]);

  const lowEndRenderer = probe.status === 'ready' && probe.performanceCaveat;
  const requestedDprKey = getDprPropKey(requestedDpr);
  const adaptiveDprSteps = useMemo(
    () => buildAdaptiveDprSteps(requestedDpr, lowEndRenderer),
    [lowEndRenderer, requestedDprKey],
  );
  const adaptiveDprKey = adaptiveDprSteps.join(':');
  const initialAdaptiveDpr = adaptiveDprSteps[0];
  const [adaptiveDpr, setAdaptiveDpr] = useState(() => adaptiveDprSteps[0]);
  const pageVisible = usePageVisibility();
  const effectiveFrameRateConfig = useMemo(() => ({
    ...frameRateConfig,
  }), [frameRateConfig]);
  const shouldShowOverlay = showFrameRateOverlay ?? shouldShowPerformanceOverlay();
  const adaptiveDprSustainMs = lowEndRenderer
    ? LOW_END_ADAPTIVE_DPR_SUSTAIN_MS
    : ADAPTIVE_DPR_SUSTAIN_MS;
  const activeFrameloop = pageVisible ? props.frameloop : 'demand';

  useEffect(() => {
    setAdaptiveDpr(initialAdaptiveDpr);
  }, [adaptiveDprKey, initialAdaptiveDpr]);

  if (webgpuEnabled && isWebGPUSupported()) {
    return (
      <div style={SHELL_STYLE}>
        <FrameRateMonitorProvider config={effectiveFrameRateConfig}>
          <Canvas
            {...props}
            fallback={fallback}
            frameloop={activeFrameloop}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            gl={(async (defaultProps: any) => {
              const { WebGPURenderer } = await import('three/webgpu');
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const renderer = new (WebGPURenderer as any)({
                ...defaultProps,
                antialias: true,
                powerPreference: 'high-performance',
                compatibilityMode: true,
              });
              await renderer.init();
              return renderer;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            }) as any}
          >
            <FrameRateMonitorBridge />
            {children}
          </Canvas>
          {shouldShowOverlay ? <FrameRateHud label={sceneLabel} /> : null}
        </FrameRateMonitorProvider>
      </div>
    );
  }

  if (probe.status === 'unsupported') {
    return (
      <div style={SHELL_STYLE}>
        <SafeCanvasStatus
          eyebrow="WebGL Offline"
          title={sceneLabel}
          message="This scene could not start a WebGL 2 renderer here. Try another scene from the + menu, or re-enable hardware acceleration and WebGL in your browser."
        />
      </div>
    );
  }

  if (probe.status !== 'ready') {
    return (
      <div style={SHELL_STYLE}>
        <SafeCanvasStatus
          eyebrow="Checking Graphics"
          title={sceneLabel}
          message="Preparing the renderer with the safest available graphics settings for this device."
        />
      </div>
    );
  }

  return (
    <div style={SHELL_STYLE}>
      <FrameRateMonitorProvider config={effectiveFrameRateConfig}>
        <Canvas
          {...props}
          dpr={adaptiveDpr}
          fallback={fallback}
          frameloop={activeFrameloop}
          gl={(defaultProps) => new WebGLRenderer({
            ...defaultProps,
            ...probe.options,
          })}
        >
          <FrameRateMonitorBridge />
          <FrameRateDprBridge dpr={adaptiveDpr} />
          <AdaptiveDprBridge
            currentDpr={adaptiveDpr}
            dprSteps={adaptiveDprSteps}
            onDprChange={setAdaptiveDpr}
            sustainMs={adaptiveDprSustainMs}
          />
          {children}
        </Canvas>
        {shouldShowOverlay ? <FrameRateHud label={sceneLabel} /> : null}
      </FrameRateMonitorProvider>
    </div>
  );
}
