// Shared keyboard/state helpers used by Matrix, Atom, and parts of Monolith.
export const SHARED_FX_NONE = 'none';
export const SHARED_FX_CINEMATIC = 'cinematic';
export const SHARED_FX_DATABEND = 'databend';
export const HUE_CYCLE_SPEED = (Math.PI * 2) / 8;

export type SharedFxMode =
  | typeof SHARED_FX_NONE
  | typeof SHARED_FX_CINEMATIC
  | typeof SHARED_FX_DATABEND;

export type SharedSpecialEffectAction =
  | 'cinematic'
  | 'databend'
  | 'xrayMode'
  | 'chromaticAberration'
  | 'hueCycle'
  | 'pixelMosaic'
  | 'thermalVision';

export interface ChromaticXrayState {
  chromaticAberrationEnabled: boolean;
  restoreChromaticAfterXray: boolean;
  xrayMode: boolean;
}

export interface HueCycleState {
  hue: number;
  hueCycleBaseHue: number;
  hueCycleEnabled: boolean;
  hueCycleSavedEnabled: boolean;
  hueCycleSavedHue: number;
  hueCycleSavedSaturation: number;
  hueCycleStartTime: number;
  hueSatEnabled: boolean;
  saturation: number;
}

export interface SharedSpecialEffectState extends ChromaticXrayState, HueCycleState {
  currentFx: SharedFxMode;
  pixelMosaicEnabled: boolean;
  thermalVisionEnabled: boolean;
}

export type SharedSpecialEffectHandlers = Partial<Record<SharedSpecialEffectAction, () => void>>;
export type SharedSpecialEffectUpdater<T extends SharedSpecialEffectState = SharedSpecialEffectState> = (
  updater: (current: T) => T,
) => void;

const SHARED_SPECIAL_EFFECT_ACTIONS: Record<string, SharedSpecialEffectAction> = {
  '4': 'cinematic',
  z: 'databend',
  x: 'xrayMode',
  c: 'chromaticAberration',
  v: 'hueCycle',
  b: 'pixelMosaic',
  n: 'thermalVision',
};

export function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

export function toggleSharedFxMode(currentFx: SharedFxMode, nextFx: Exclude<SharedFxMode, 'none'>) {
  return currentFx === nextFx ? SHARED_FX_NONE : nextFx;
}

export function createInitialSharedSpecialEffectState(
  overrides: Partial<SharedSpecialEffectState> = {},
): SharedSpecialEffectState {
  return {
    chromaticAberrationEnabled: false,
    currentFx: SHARED_FX_NONE,
    hue: 0,
    hueCycleBaseHue: 0,
    hueCycleEnabled: false,
    hueCycleSavedEnabled: false,
    hueCycleSavedHue: 0,
    hueCycleSavedSaturation: 0,
    hueCycleStartTime: 0,
    hueSatEnabled: false,
    pixelMosaicEnabled: false,
    restoreChromaticAfterXray: false,
    saturation: 0,
    thermalVisionEnabled: false,
    xrayMode: false,
    ...overrides,
  };
}

export function setChromaticAberrationState(
  state: ChromaticXrayState,
  enabled: boolean,
): ChromaticXrayState {
  // Chromatic aberration and x-ray are mutually exclusive screen treatments.
  // When x-ray turns off we can restore the prior chromatic state, but the
  // actual coupling logic should stay centralized here instead of being copied
  // into scene packages.
  if (!enabled) {
    return {
      ...state,
      chromaticAberrationEnabled: false,
      restoreChromaticAfterXray: false,
    };
  }

  if (state.xrayMode) {
    return {
      chromaticAberrationEnabled: true,
      restoreChromaticAfterXray: false,
      xrayMode: false,
    };
  }

  return {
    ...state,
    chromaticAberrationEnabled: true,
  };
}

export function toggleChromaticAberrationState(state: ChromaticXrayState) {
  return setChromaticAberrationState(state, !state.chromaticAberrationEnabled);
}

export function setXrayModeState(state: ChromaticXrayState, enabled: boolean): ChromaticXrayState {
  if (!enabled) {
    return {
      chromaticAberrationEnabled: state.restoreChromaticAfterXray,
      restoreChromaticAfterXray: false,
      xrayMode: false,
    };
  }

  if (state.xrayMode) {
    return state;
  }

  return {
    chromaticAberrationEnabled: false,
    restoreChromaticAfterXray: state.chromaticAberrationEnabled,
    xrayMode: true,
  };
}

export function toggleXrayModeState(state: ChromaticXrayState) {
  return setXrayModeState(state, !state.xrayMode);
}

export function toggleHueCycleState(state: HueCycleState, now: number): HueCycleState {
  if (!state.hueCycleEnabled) {
    return {
      ...state,
      hueCycleBaseHue: state.hue,
      hueCycleEnabled: true,
      hueCycleSavedEnabled: state.hueSatEnabled,
      hueCycleSavedHue: state.hue,
      hueCycleSavedSaturation: state.saturation,
      hueCycleStartTime: now,
      hueSatEnabled: true,
      saturation: 1,
    };
  }

  return {
    ...state,
    hue: state.hueCycleSavedHue,
    hueCycleEnabled: false,
    hueSatEnabled: state.hueCycleSavedEnabled,
    saturation: state.hueCycleSavedSaturation,
  };
}

export function getHueCycleHue(baseHue: number, startTime: number, now: number) {
  return ((baseHue + ((now - startTime) * HUE_CYCLE_SPEED) + Math.PI) % (Math.PI * 2)) - Math.PI;
}

export function setSharedChromaticAberrationEnabled<T extends SharedSpecialEffectState>(
  state: T,
  enabled: boolean,
) {
  return {
    ...state,
    ...setChromaticAberrationState(state, enabled),
  };
}

export function setSharedXrayModeEnabled<T extends SharedSpecialEffectState>(
  state: T,
  enabled: boolean,
) {
  return {
    ...state,
    ...setXrayModeState(state, enabled),
  };
}

export function applySharedSpecialEffectAction<T extends SharedSpecialEffectState>(
  state: T,
  action: SharedSpecialEffectAction,
  now: number,
) {
  // Keep the scene packages declarative: each action returns the next full
  // shared-effects snapshot instead of scattering small state mutations around.
  switch (action) {
    case 'cinematic':
      return {
        ...state,
        currentFx: toggleSharedFxMode(state.currentFx, SHARED_FX_CINEMATIC),
      };
    case 'databend':
      return {
        ...state,
        currentFx: toggleSharedFxMode(state.currentFx, SHARED_FX_DATABEND),
      };
    case 'chromaticAberration':
      return setSharedChromaticAberrationEnabled(state, !state.chromaticAberrationEnabled);
    case 'hueCycle':
      return {
        ...state,
        ...toggleHueCycleState(state, now),
      };
    case 'pixelMosaic':
      return {
        ...state,
        pixelMosaicEnabled: !state.pixelMosaicEnabled,
      };
    case 'thermalVision':
      return {
        ...state,
        thermalVisionEnabled: !state.thermalVisionEnabled,
      };
    case 'xrayMode':
      return setSharedXrayModeEnabled(state, !state.xrayMode);
    default:
      return state;
  }
}

export function createSharedSpecialEffectHandlers<T extends SharedSpecialEffectState>(
  updateState: SharedSpecialEffectUpdater<T>,
  getNow: () => number = () => performance.now() / 1000,
): Record<SharedSpecialEffectAction, () => void> {
  const applyAction = (action: SharedSpecialEffectAction) => {
    updateState((current) => applySharedSpecialEffectAction(current, action, getNow()));
  };

  return {
    cinematic: () => applyAction('cinematic'),
    chromaticAberration: () => applyAction('chromaticAberration'),
    databend: () => applyAction('databend'),
    hueCycle: () => applyAction('hueCycle'),
    pixelMosaic: () => applyAction('pixelMosaic'),
    thermalVision: () => applyAction('thermalVision'),
    xrayMode: () => applyAction('xrayMode'),
  };
}

export function createSharedEffectHotkeyListener(
  handlers: SharedSpecialEffectHandlers,
  { preventDefault = true } = {},
) {
  // Scene packages supply the actual behavior; this helper only normalizes the
  // shared hotkey map and editable-target guard.
  return (event: KeyboardEvent) => {
    if (event.repeat || isEditableTarget(event.target)) return false;

    const action = SHARED_SPECIAL_EFFECT_ACTIONS[event.key.toLowerCase()];
    if (!action) return false;

    const handler = handlers[action];
    if (!handler) return false;

    if (preventDefault) {
      event.preventDefault();
    }

    handler();
    return true;
  };
}
