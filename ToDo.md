# Matrix Visualization Roadmap

> Last reviewed: 2026-03-23

This file tracks the active Matrix implementation in `src/text-rain/`, marks what has already landed, and sorts the remaining work by value and effort.

Post-task verification for this ToDo:

- After finishing any item here, run `npm run check:visible` in `visualizations/matrix` or `npm run check:matrix-visible` from the repo root.
- This check opens the standalone Matrix app in a real Chromium window, captures a screenshot, and fails if it cannot detect the expected green rain glyphs.

Deferred for later redesign:

- The shortcut overlay is intentionally not live right now, even though the roadmap item was explored on this scratch branch.

## Completed

These items are already present in the active `text-rain` codepath.

- `src/main.tsx` points to `src/text-rain/App.tsx`, making `text-rain` the production entrypoint
- Theme variants now exist in `src/text-rain/matrix-effects-config.ts` and can be cycled with `t` or changed in the GUI
- Flat typed-array simulation state replaced the older per-column JS object graph
- Column reset now reuses in-place buffers instead of allocating fresh cell arrays
- Active instance count tracks `activeColumns * ROWS`, so inactive columns are not drawn
- Instanced attribute uploads are limited to the active prefix via update ranges
- Character mutation is throttled to simulation advancement rather than every frame
- Canvas DPR is capped at `1.5`
- OrbitControls are active in the 3D scene
- Matrix effect settings are bridged into the shared special-effects stack
- `MatrixEffects.tsx` already documents and uses the mutable params mirror pattern
- `initialHeadY()` and `resetHeadY()` are already split into separate helpers
- Vite dedupes React and the shared R3F stack for the standalone app

## Partially Completed

These ideas exist in some form, but the original goal is only partly met.

### Performance

- Hidden-instance writes are reduced in practice:
  inactive columns are no longer drawn, but the backing buffers are still sized to the full `COLUMN_COUNT * ROWS` maximum.
- Atlas generation is centralized:
  `buildAtlas()` runs once, but still does synchronous work during the initial render rather than moving fully off the critical path (e.g., via a Web Worker or pre-render initialization).

## Suggested Next Order

This is the recommended order for the next passes.

1. **Keyboard shortcut overlay**
   Status: deferred
   Explored on this scratch branch, but intentionally not left live. Revisit with a redesign if you want a production-ready version later.

2. **Theme variants for the rain palette**
   Status: **DONE** (2026-03-23)
   Added phosphor, amber, ice, and ghost palette presets with GUI + `t` cycling.

3. **Resolve the legacy canvas implementation**
   Status: **DONE** (2026-03-23)
   Removed the unreachable top-level `src/App.tsx` and `src/MatrixRain.tsx` files so `text-rain` is the only Matrix renderer in the package.

4. **Resolve `MonolithPixelGlitchEffect`**
   Status: **DONE** (2026-03-23)
   Deleted the stale effect class because it was not wired into the active scene or shared effect stack.

## Remaining Work By Theme

### P1: Strong Follow-Ups

- Add adaptive active-column scaling based on rolling frame time
- Shrink the maximum backing buffer size from the current full theoretical cap
- Move atlas construction off the first render path (Web Worker or pre-initialization)
- Centralize all simulation constants into one typed config object
- Replace raw trail color literals with named palette constants

### P2: Advanced / Experimental

- Add automatic performance mode switching (hardware-aware render-mode between canvas fallback and instanced 3D)
- Add URL-driven render mode or preset selection
- Explore dynamic DPR or other cross-display quality adaptation when displays change
- Add auto quality tiers for lower-end GPUs

## Fresh Ideas

These are not from the original list, but they fit the current architecture well.

### UX / Controls

- Camera preset buttons:
  default, close, wide, and shallow-angle views for quick composition changes.
- Screenshot mode:
  hide the GUI and export a clean still at a larger render size.
- Shareable URL presets:
  encode rain density, palette, bloom, and camera mode into the URL.

### Visual Direction

- Glyph set packs:
  classic kana, alphanumeric-only, custom symbols, or user-provided glyph strings.
- CRT preset bundles:
  phosphor green, amber terminal, cold blue, and monochrome monitor looks.
- Depth layering presets:
  a few curated scene compositions using different fog, spacing, and camera ranges.

### Platform / Robustness

- Lightweight benchmark readout:
  show FPS and active column count in a hidden debug overlay.
- Device class presets:
  desktop, laptop, and integrated-GPU starting profiles.
- Small test harness for simulation invariants:
  column reset behavior, active count clamping, and typed-array bounds.

## Notes

- The active implementation is the `text-rain` path, and there is now only one Matrix renderer in the package.
- Keep docs and `src/text-rain/README.md` in sync when hotkeys or entrypoint behavior change.
- Prefer preserving the current low-allocation simulation patterns over broad architectural churn.
