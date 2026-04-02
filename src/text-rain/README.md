# text-rain

This folder contains the active **3D instanced Matrix rain** implementation used by the app.

The current Vite entrypoint imports `src/text-rain/App.tsx` from `src/main.tsx`, so this directory is what powers the Matrix digital rain scene right now.

## Files

- `App.tsx` — scene setup, shared hotkeys, and top-level special-effect state
- `MatrixEffects.tsx` — lil-gui controls plus the shared post-processing stack bridge
- `matrix-effects-config.ts` — defaults for Matrix-specific effect tuning and palette presets
- `MatrixRain.tsx` — atlas-backed instanced glyph quads driven by a flat typed-array simulation and theme-aware glyph colors

## Entry point

The app is currently started with this import in `src/main.tsx`:

```ts
import App from './text-rain/App'
```

## Caveat

This version is still performance-sensitive, but the active path no longer creates per-cell text objects. It uses one instanced mesh plus typed-array simulation buffers and only uploads the active column slice each frame.

## Hotkeys

- `g` — toggle the effects GUI
- `t` — cycle the rain palette theme
- `4` — toggle cinematic mode
- `z` — toggle databend mode
- `x` — toggle x-ray mode
- `c` — toggle chromatic aberration
- `v` — toggle hue cycle
- `b` — toggle pixel mosaic
- `n` — toggle thermal vision
- `ArrowLeft` — reduce active rain columns
- `ArrowRight` — increase active rain columns

## More context

For the cross-project effect ownership map, see `../../../../docs/special-effects.md`.
