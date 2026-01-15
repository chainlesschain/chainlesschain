import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

export default defineConfig({
  plugins: [
    uni()
  ],
  server: {
    port: 8080,
    host: '0.0.0.0'
  },
  build: {
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  }
})
