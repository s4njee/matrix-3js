# text-rain

This folder preserves the **3D text-object Matrix rain** experiment.

It is **not wired into the main app right now**. The current app uses the faster canvas-texture approach in `src/MatrixRain.tsx`.

## Files

- `App.tsx` — scene setup for the text-based version
- `MatrixRain.tsx` — true 3D rain using lots of `drei <Text>` objects

## To try it later

Temporarily edit `src/main.tsx` or `src/App.tsx` to import from this folder instead, for example:

```ts
import App from './text-rain/App'
```

Then switch back when you're done.

## Caveat

This version is much heavier at startup/performance because it creates a large number of real text objects.
