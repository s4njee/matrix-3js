# Matrix Visualization Roadmap

> Last reviewed: 2026-03-23

This file tracks the active Matrix implementation in `src/text-rain/`, marks what has already landed, and sorts the remaining work by value and effort.

## Completed

These items are already present in the active `text-rain` codepath.

- `src/main.tsx` points to `src/text-rain/App.tsx`, making `text-rain` the production entrypoint
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

### Architecture

- Two Matrix implementations still exist:
  the legacy top-level canvas version remains in `src/App.tsx` and `src/MatrixRain.tsx`. These files are not reachable from the active `src/main.tsx` → `src/text-rain/App.tsx` entrypoint but are still in the repo.

  > **📋 TODO (code):** Decide and act — either promote the legacy canvas renderer as a selectable 2D fallback (useful for low-end devices without WebGL) or delete both files. Keeping dead code creates confusion about what is "real." Decision criteria:
  > - **Keep** if you want a canvas-2D fallback for integrated GPUs or older browsers.
  > - **Delete** if maintaining two codepaths isn't worth the complexity and you're comfortable requiring WebGL.

- `MonolithPixelGlitchEffect.ts` still exists in `src/text-rain/`:
  this is a pixel-glitch post-processing effect named after Monolith's version. It was likely copied or adapted for use in Matrix but is not wired into the active effect stack.

  > **📋 TODO (code):** Either integrate this into `MatrixEffects.tsx` and the shared effect hotkey system, or delete it. It is the largest piece of stale-but-real code in the package.

### Performance

- Hidden-instance writes are reduced in practice:
  inactive columns are no longer drawn, but the backing buffers are still sized to the full `COLUMN_COUNT * ROWS` maximum.
- Atlas generation is centralized:
  `buildAtlas()` runs once, but still does synchronous work during the initial render rather than moving fully off the critical path (e.g., via a Web Worker or pre-render initialization).

## Suggested Next Order

This is the recommended order for the next passes.

1. **Keyboard shortcut overlay**
   Why first: clear UX win, low risk, and helps users discover the density controls and shared FX keys. This feature appears in all three visualization ToDos — consider building it once in the shared effects stack.

2. **Theme variants for the rain palette**
   Why next: visible payoff with modest implementation cost.

3. **Resolve the legacy canvas implementation** (see TODO note above)
   Why next: removes ambiguity about the active codepath.

4. **Resolve `MonolithPixelGlitchEffect`** (see TODO note above)
   Why next: eliminates the largest piece of disconnected code.

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

- The active implementation is the `text-rain` path, not the older top-level files.
- Keep docs and `src/text-rain/README.md` in sync when hotkeys or entrypoint behavior change.
- Prefer preserving the current low-allocation simulation patterns over broad architectural churn.
