import { useEffect, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import GUI from 'lil-gui'
import {
  SharedEffectStack,
  SHARED_FX_CINEMATIC,
  SHARED_FX_DATABEND,
  isEditableTarget,
  type SharedSpecialEffectState,
} from '../../../../src/shared/special-effects/index.ts'
import {
  MATRIX_PALETTE_PRESETS,
  type MatrixEffectSettings,
  type MatrixPaletteName,
} from './matrix-effects-config'

interface MatrixEffectsProps {
  effectSettings: MatrixEffectSettings
  paletteName: MatrixPaletteName
  setEffectSettings: Dispatch<SetStateAction<MatrixEffectSettings>>
  setPaletteName: Dispatch<SetStateAction<MatrixPaletteName>>
  specialEffects: SharedSpecialEffectState
}

export default function MatrixEffects({
  effectSettings,
  paletteName,
  setEffectSettings,
  setPaletteName,
  specialEffects,
}: MatrixEffectsProps) {
  // lil-gui expects mutable objects, while React state wants immutable
  // updates. Keep a live mirror here so the controls can read/write without
  // forcing the GUI to be recreated on every settings change.
  const paramsRef = useRef({ ...effectSettings })
  const paletteParamsRef = useRef({ paletteName })
  const syncGuiDisplayRef = useRef(() => {})

  useEffect(() => {
    const params = paramsRef.current
    const paletteParams = paletteParamsRef.current
    const gui = new GUI({ title: 'Effects', width: 280 })
    let guiVisible = false

    gui.domElement.style.zIndex = '20'
    gui.hide()

    const updateSetting = <K extends keyof MatrixEffectSettings>(key: K, value: MatrixEffectSettings[K]) => {
      setEffectSettings((current) => (
        current[key] === value ? current : { ...current, [key]: value }
      ))
    }

    const addNumberControl = (
      folder: GUI,
      key: keyof MatrixEffectSettings,
      label: string,
      min: number,
      max: number,
      step: number,
    ) => (
      folder.add(params, key, min, max, step).name(label).onChange((value: number) => {
        updateSetting(key, value as MatrixEffectSettings[typeof key])
      })
    )

    const scanFolder = gui.addFolder('Scanlines')
    scanFolder.add(params, 'scanEnabled').name('Enabled').onChange((value: boolean) => {
      updateSetting('scanEnabled', value)
    })
    addNumberControl(scanFolder, 'scanDensity', 'Density', 0.1, 5, 0.05)
    addNumberControl(scanFolder, 'scanOpacity', 'Opacity', 0, 1, 0.01)
    scanFolder.open()

    const bloomFolder = gui.addFolder('Bloom')
    bloomFolder.add(params, 'bloomEnabled').name('Enabled').onChange((value: boolean) => {
      updateSetting('bloomEnabled', value)
    })
    addNumberControl(bloomFolder, 'bloomIntensity', 'Intensity', 0, 3, 0.01)
    addNumberControl(bloomFolder, 'bloomThreshold', 'Threshold', 0, 1, 0.01)
    addNumberControl(bloomFolder, 'bloomSmoothing', 'Smoothing', 0, 1, 0.01)
    addNumberControl(bloomFolder, 'bloomRadius', 'Radius', 0, 1, 0.01)
    bloomFolder.open()

    const chromaticFolder = gui.addFolder('Chromatic')
    addNumberControl(chromaticFolder, 'chromaticOffset', 'Offset', 0, 0.02, 0.0001)
    addNumberControl(chromaticFolder, 'chromaticOscillationSpeed', 'Speed', 0, 10, 0.01)
    chromaticFolder.add(params, 'chromaticRadialModulation').name('Radial').onChange((value: boolean) => {
      updateSetting('chromaticRadialModulation', value)
    })
    addNumberControl(chromaticFolder, 'chromaticModulationOffset', 'Modulation', 0, 1, 0.01)

    const barrelFolder = gui.addFolder('Barrel Blur')
    addNumberControl(barrelFolder, 'barrelBlurAmount', 'Amount', 0, 0.4, 0.001)

    const paletteFolder = gui.addFolder('Palette')
    paletteFolder.add(
      paletteParams,
      'paletteName',
      Object.fromEntries(
        Object.entries(MATRIX_PALETTE_PRESETS).map(([key, value]) => [value.label, key]),
      ),
    ).name('Theme').onChange((value: MatrixPaletteName) => {
      setPaletteName(current => current === value ? current : value)
    })

    syncGuiDisplayRef.current = () => {
      gui.controllersRecursive().forEach((controller) => controller.updateDisplay())
    }

    const toggleGui = () => {
      guiVisible = !guiVisible

      if (guiVisible) {
        syncGuiDisplayRef.current()
        gui.show()
        return
      }

      gui.hide()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isEditableTarget(event.target)) return

      if (event.key === 'g' || event.key === 'G') {
        toggleGui()
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      gui.destroy()
    }
  }, [setEffectSettings, setPaletteName])

  useEffect(() => {
    Object.assign(paramsRef.current, effectSettings)
    syncGuiDisplayRef.current()
  }, [effectSettings])

  useEffect(() => {
    paletteParamsRef.current.paletteName = paletteName
    syncGuiDisplayRef.current()
  }, [paletteName])

  return (
    // Keep the effect stack declarative here so MatrixRain itself only worries
    // about simulation and geometry, while this bridge owns the post FX state.
    <SharedEffectStack
      barrelBlurAmount={effectSettings.barrelBlurAmount}
      bloomEnabled={effectSettings.bloomEnabled}
      bloomIntensity={effectSettings.bloomIntensity}
      bloomRadius={effectSettings.bloomRadius}
      bloomSmoothing={effectSettings.bloomSmoothing}
      bloomThreshold={effectSettings.bloomThreshold}
      chromaticAberrationEnabled={specialEffects.chromaticAberrationEnabled}
      chromaticModulationOffset={effectSettings.chromaticModulationOffset}
      chromaticOffset={effectSettings.chromaticOffset}
      chromaticOscillationSpeed={effectSettings.chromaticOscillationSpeed}
      chromaticRadialModulation={effectSettings.chromaticRadialModulation}
      cinematicEnabled={specialEffects.currentFx === SHARED_FX_CINEMATIC}
      databendEnabled={specialEffects.currentFx === SHARED_FX_DATABEND}
      hue={specialEffects.hue}
      hueCycleBaseHue={specialEffects.hueCycleBaseHue}
      hueCycleEnabled={specialEffects.hueCycleEnabled}
      hueCycleStartTime={specialEffects.hueCycleStartTime}
      hueSatEnabled={specialEffects.hueSatEnabled}
      pixelMosaicEnabled={specialEffects.pixelMosaicEnabled}
      saturation={specialEffects.saturation}
      scanlineDensity={effectSettings.scanDensity}
      scanlineEnabled={effectSettings.scanEnabled}
      scanlineOpacity={effectSettings.scanOpacity}
      screenXrayEnabled={specialEffects.xrayMode}
      thermalVisionEnabled={specialEffects.thermalVisionEnabled}
    />
  )
}
