import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/dreamdex-indexer': {
        target: 'https://dev.smk.somnia.host',
        changeOrigin: true,
        rewrite: () => '/v1/graphql',
      },
    },
  },
})
