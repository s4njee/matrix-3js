import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const isGitHubPages = process.env.GITHUB_ACTIONS === 'true'

export default defineConfig({
  base: isGitHubPages ? '/matrix-3js/' : '/',
  resolve: {
    dedupe: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      '@react-three/drei',
      '@react-three/fiber',
      '@react-three/postprocessing',
      'postprocessing',
      'three',
    ],
  },
  plugins: [react()],
})
