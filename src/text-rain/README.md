# text-rain

This folder contains the active **3D text-object Matrix rain** implementation used by the app.

The current Vite entrypoint imports `src/text-rain/App.tsx` from `src/main.tsx`, so this directory is what powers the Matrix digital rain scene right now.

## Files

- `App.tsx` — scene setup for the text-based version
- `MatrixRain.tsx` — true 3D rain using lots of `drei <Text>` objects

## Entry point

The app is currently started with this import in `src/main.tsx`:

```ts
import App from './text-rain/App'
```

## Caveat

This version is much heavier at startup/performance because it creates a large number of real text objects.
