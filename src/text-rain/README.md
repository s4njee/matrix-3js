# text-rain

This folder contains the active **3D text-object Matrix rain** implementation used by the app.

The current Vite entrypoint imports `src/text-rain/App.tsx` from `src/main.tsx`, so this directory is what powers the Matrix digital rain scene right now.

## Files

- `App.tsx` — scene setup, shared hotkeys, and top-level special-effect state
- `MatrixEffects.tsx` — lil-gui controls plus the shared post-processing stack bridge
- `matrix-effects-config.ts` — defaults for Matrix-specific effect tuning
- `MatrixRain.tsx` — true 3D rain using lots of text instances
- `MonolithPixelGlitchEffect.ts` — legacy custom effect class that is currently not wired into `App.tsx`

## Entry point

The app is currently started with this import in `src/main.tsx`:

```ts
import App from './text-rain/App'
```

## Caveat

This version is much heavier at startup/performance because it creates a large number of real text objects.

## Hotkeys

- `g` — toggle the effects GUI
- `4` — toggle cinematic mode
- `z` — toggle databend mode
- `x` — toggle x-ray mode
- `c` — toggle chromatic aberration
- `v` — toggle hue cycle
- `b` — toggle pixel mosaic
- `n` — toggle thermal vision
- `[` — reduce active rain columns
- `]` — increase active rain columns

## More context

For the cross-project effect ownership map, see `../../../../docs/special-effects.md`.
