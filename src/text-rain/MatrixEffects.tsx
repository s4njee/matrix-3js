import { useEffect, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import GUI from 'lil-gui'
import {
  SharedEffectStack,
  type SharedFxMode,
  SHARED_FX_CINEMATIC,
  SHARED_FX_DATABEND,
  isEditableTarget,
} from '../../../../src/shared/special-effects/index.ts'
import type { MatrixEffectSettings } from './matrix-effects-config'

interface MatrixSpecialEffects {
  chromaticAberrationEnabled: boolean
  currentFx: SharedFxMode
  hue: number
  hueCycleBaseHue: number
  hueCycleEnabled: boolean
  hueCycleStartTime: number
  hueSatEnabled: boolean
  pixelMosaicEnabled: boolean
  saturation: number
  thermalVisionEnabled: boolean
  xrayMode: boolean
}

interface MatrixEffectsProps {
  effectSettings: MatrixEffectSettings
  setEffectSettings: Dispatch<SetStateAction<MatrixEffectSettings>>
  specialEffects: MatrixSpecialEffects
}

export default function MatrixEffects({
  effectSettings,
  setEffectSettings,
  specialEffects,
}: MatrixEffectsProps) {
  const paramsRef = useRef({ ...effectSettings })
  const syncGuiDisplayRef = useRef(() => {})

  useEffect(() => {
    const params = paramsRef.current
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
  }, [setEffectSettings])

  useEffect(() => {
    Object.assign(paramsRef.current, effectSettings)
    syncGuiDisplayRef.current()
  }, [effectSettings])

  return (
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
