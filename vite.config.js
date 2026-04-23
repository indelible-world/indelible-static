import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/indelible-static/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        publish: resolve(__dirname, 'publish.html'),
      },
    },
  },
})
