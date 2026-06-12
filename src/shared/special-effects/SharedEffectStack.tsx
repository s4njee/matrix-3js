import { useEffect, useMemo, useRef } from 'react';
import type { ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  Bloom,
  ChromaticAberration,
  EffectComposer,
} from '@react-three/postprocessing';
import * as THREE from 'three';
import {
  getHueCycleHue,
} from './shared-special-effects.ts';
import {
  SharedBarrelBlurEffect,
  SharedDatabendEffect,
  SharedGlitchBurstEffect,
  SharedHueSaturationEffect,
  SharedPixelMosaicEffect,
  SharedScanlineEffect,
  SharedScreenXrayEffect,
  SharedThermalVisionEffect,
} from './react-postprocessing-effects.ts';
import { useFrameRate } from '../performance/index.ts';

function useLazyEffect<T>(enabled: boolean, factory: () => T) {
  const effectRef = useRef<T | null>(null);

  if (enabled && effectRef.current === null) {
    effectRef.current = factory();
  }

  return effectRef.current;
}

// All three scenes now share this declarative fullscreen effect stack. Scene-
// specific logic like Monolith's mesh-level x-ray stays outside this component.
export interface SharedEffectStackProps {
  barrelBlurAmount?: number;
  barrelBlurEnabled?: boolean;
  barrelBlurOffsetX?: number;
  barrelBlurOffsetY?: number;
  bloomEnabled?: boolean;
  bloomIntensity?: number;
  bloomRadius?: number;
  bloomSmoothing?: number;
  bloomThreshold?: number;
  chromaticAberrationEnabled?: boolean;
  chromaticModulationOffset?: number;
  chromaticOffset?: number;
  chromaticOffsetX?: number;
  chromaticOffsetY?: number;
  chromaticOscillationSpeed?: number;
  chromaticRadialModulation?: boolean;
  cinematicEnabled?: boolean;
  databendEnabled?: boolean;
  glitchDuration?: number;
  glitchEnabled?: boolean;
  glitchStrength?: number;
  glitchTriggerToken?: number;
  hue?: number;
  hueCycleBaseHue?: number;
  hueCycleEnabled?: boolean;
  hueCycleStartTime?: number;
  hueSatEnabled?: boolean;
  pixelMosaicEnabled?: boolean;
  saturation?: number;
  scanlineAlwaysOn?: boolean;
  scanlineDensity?: number;
  scanlineEnabled?: boolean;
  scanlineOpacity?: number;
  scanlineScrollSpeed?: number;
  screenXrayEnabled?: boolean;
  thermalVisionEnabled?: boolean;
}

export default function SharedEffectStack({
  barrelBlurAmount = 0.12,
  barrelBlurEnabled = true,
  barrelBlurOffsetX = 0,
  barrelBlurOffsetY = 0,
  bloomEnabled = true,
  bloomIntensity = 1,
  bloomRadius = 0.5,
  bloomSmoothing = 0.3,
  bloomThreshold = 0.2,
  chromaticAberrationEnabled = false,
  chromaticModulationOffset = 0.15,
  chromaticOffset = 0.004,
  chromaticOffsetX,
  chromaticOffsetY,
  chromaticOscillationSpeed = 3.2,
  chromaticRadialModulation = true,
  cinematicEnabled = false,
  databendEnabled = false,
  glitchDuration = 0.4,
  glitchEnabled = false,
  glitchStrength = 1,
  glitchTriggerToken = 0,
  hue = 0,
  hueCycleBaseHue = 0,
  hueCycleEnabled = false,
  hueCycleStartTime = 0,
  hueSatEnabled = false,
  pixelMosaicEnabled = false,
  saturation = 0,
  scanlineAlwaysOn = false,
  scanlineDensity = 4,
  scanlineEnabled = true,
  scanlineOpacity = 1,
  scanlineScrollSpeed = 0.08,
  screenXrayEnabled = false,
  thermalVisionEnabled = false,
}: SharedEffectStackProps) {
  const { qualityTier } = useFrameRate();
  const composerEnabled = qualityTier === 'high' || chromaticAberrationEnabled || bloomEnabled;
  const composerResolutionScale = qualityTier === 'low' ? 0.5 : 1;
  const bloomResolutionScale = qualityTier === 'low' ? 0.25 : 0.35;
  const bloomIntensityLimit = qualityTier === 'low' ? 0.45 : 0.8;
  const bloomRadiusLimit = qualityTier === 'low' ? 0.12 : 0.25;
  const effectiveBloomIntensity = Math.min(bloomIntensity, bloomIntensityLimit);
  const effectiveBloomRadius = Math.min(bloomRadius, bloomRadiusLimit);
  const effectiveBloomThreshold = Math.max(bloomThreshold, 0.35);
  const effectiveBloomSmoothing = Math.min(bloomSmoothing, 0.18);
  const effectiveBloomEnabled = bloomEnabled;
  const effectiveScanlineEnabled = scanlineEnabled;
  const effectiveChromaticEnabled = chromaticAberrationEnabled;
  const barrelBlurActive = cinematicEnabled && barrelBlurEnabled;
  const databendActive = databendEnabled;
  const glitchActive = glitchEnabled;
  const hueSatActive = hueSatEnabled || hueCycleEnabled;
  const pixelMosaicActive = pixelMosaicEnabled;
  const scanlineActive = (scanlineAlwaysOn || cinematicEnabled || databendEnabled) && effectiveScanlineEnabled;
  const screenXrayActive = screenXrayEnabled;
  const thermalVisionActive = thermalVisionEnabled;

  const barrelBlurOffsetVector = useMemo(() => new THREE.Vector2(barrelBlurOffsetX, barrelBlurOffsetY), []);
  const chromaticOffsetVector = useMemo(() => (
    new THREE.Vector2(
      chromaticOffsetX ?? chromaticOffset,
      chromaticOffsetY ?? chromaticOffset,
    )
  ), []);
  const hueSatEffect = useLazyEffect(hueSatActive, () => new SharedHueSaturationEffect());
  const barrelBlurEffect = useLazyEffect(barrelBlurActive, () => new SharedBarrelBlurEffect());
  const databendEffect = useLazyEffect(databendActive, () => new SharedDatabendEffect());
  const glitchBurstEffect = useLazyEffect(glitchActive, () => new SharedGlitchBurstEffect());
  const pixelMosaicEffect = useLazyEffect(pixelMosaicActive, () => new SharedPixelMosaicEffect());
  const scanlineEffect = useLazyEffect(scanlineActive, () => new SharedScanlineEffect());
  const thermalVisionEffect = useLazyEffect(thermalVisionActive, () => new SharedThermalVisionEffect());
  const screenXrayEffect = useLazyEffect(screenXrayActive, () => new SharedScreenXrayEffect());
  const lastGlitchTriggerTokenRef = useRef(glitchTriggerToken);

  useEffect(() => {
    if (!barrelBlurEffect) return;
    barrelBlurEffect.setAmount(barrelBlurAmount);
  }, [barrelBlurAmount, barrelBlurEffect]);

  useEffect(() => {
    if (!barrelBlurEffect) return;
    barrelBlurOffsetVector.set(barrelBlurOffsetX, barrelBlurOffsetY);
    barrelBlurEffect.setOffset(barrelBlurOffsetVector);
  }, [barrelBlurEffect, barrelBlurOffsetVector, barrelBlurOffsetX, barrelBlurOffsetY]);

  useEffect(() => {
    if (!glitchBurstEffect) return;
    glitchBurstEffect.setDuration(glitchDuration);
  }, [glitchBurstEffect, glitchDuration]);

  useEffect(() => {
    if (!glitchBurstEffect) return;
    glitchBurstEffect.setStrength(glitchStrength);
  }, [glitchBurstEffect, glitchStrength]);

  useEffect(() => {
    if (
      !glitchBurstEffect
      || !glitchEnabled
      || glitchTriggerToken === lastGlitchTriggerTokenRef.current
    ) return;
    lastGlitchTriggerTokenRef.current = glitchTriggerToken;
    glitchBurstEffect.trigger();
  }, [glitchBurstEffect, glitchEnabled, glitchTriggerToken]);

  useEffect(() => {
    if (!hueSatEffect || hueCycleEnabled) return;
    hueSatEffect.setHue(hue);
    hueSatEffect.setSaturation(saturation);
  }, [hue, hueCycleEnabled, hueSatEffect, saturation]);

  useEffect(() => {
    if (!scanlineEffect) return;
    scanlineEffect.setDensity(scanlineDensity);
    scanlineEffect.setOpacity(scanlineOpacity);
    scanlineEffect.setScrollSpeed(scanlineScrollSpeed);
  }, [scanlineDensity, scanlineEffect, scanlineOpacity, scanlineScrollSpeed]);

  useFrame(() => {
    const baseChromaticOffsetX = chromaticOffsetX ?? chromaticOffset;
    const baseChromaticOffsetY = chromaticOffsetY ?? chromaticOffset;

    if (effectiveChromaticEnabled) {
      const now = performance.now() / 1000;
      const oscillation = 0.5 - 0.5 * Math.cos(now * chromaticOscillationSpeed);
      chromaticOffsetVector.set(
        baseChromaticOffsetX * oscillation,
        baseChromaticOffsetY * oscillation,
      );
    } else {
      chromaticOffsetVector.set(0, 0);
    }

    if (hueCycleEnabled) {
      const hueValue = getHueCycleHue(hueCycleBaseHue, hueCycleStartTime, performance.now() / 1000);
      hueSatEffect?.setHue(hueValue);
      hueSatEffect?.setSaturation(1);
    }
  });

  const composerChildren: ReactElement[] = [];

  // Keep the effect stack readable: each enabled flag contributes a single pass
  // or effect instance here instead of spreading pass wiring across scene files.
  if (effectiveBloomEnabled) {
    composerChildren.push(
      <Bloom
        key="bloom"
        mipmapBlur={false}
        intensity={effectiveBloomIntensity}
        luminanceThreshold={effectiveBloomThreshold}
        luminanceSmoothing={effectiveBloomSmoothing}
        radius={effectiveBloomRadius}
        resolutionScale={bloomResolutionScale}
      />,
    );
  }

  if (scanlineActive && scanlineEffect) {
    composerChildren.push(<primitive key="scanline" object={scanlineEffect} />);
  }

  if (barrelBlurActive && barrelBlurEffect) {
    composerChildren.push(<primitive key="barrel" object={barrelBlurEffect} />);
  }

  if (effectiveChromaticEnabled) {
    composerChildren.push(
      <ChromaticAberration
        key="chromatic"
        offset={chromaticOffsetVector}
        radialModulation={chromaticRadialModulation}
        modulationOffset={chromaticModulationOffset}
      />,
    );
  }

  if (glitchActive && glitchBurstEffect) {
    composerChildren.push(<primitive key="glitch" object={glitchBurstEffect} />);
  }

  if (databendActive && databendEffect) {
    composerChildren.push(<primitive key="databend" object={databendEffect} />);
  }

  if (hueSatActive && hueSatEffect) {
    composerChildren.push(<primitive key="hue" object={hueSatEffect} />);
  }

  if (pixelMosaicActive && pixelMosaicEffect) {
    composerChildren.push(<primitive key="pixel" object={pixelMosaicEffect} />);
  }

  if (thermalVisionActive && thermalVisionEffect) {
    composerChildren.push(<primitive key="thermal" object={thermalVisionEffect} />);
  }

  if (screenXrayActive && screenXrayEffect) {
    composerChildren.push(<primitive key="xray" object={screenXrayEffect} />);
  }

  if (!composerEnabled || composerChildren.length === 0) {
    return null;
  }

  return (
    <EffectComposer
      multisampling={0}
      resolutionScale={composerResolutionScale}
    >
      {composerChildren}
    </EffectComposer>
  );
}
