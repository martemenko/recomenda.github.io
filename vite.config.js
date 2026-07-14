import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Troque pelo nome exato do seu repositório no GitHub Pages, ex: '/recomenda.github.io/'
  base: './',
})
