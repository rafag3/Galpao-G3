import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        // Bibliotecas em chunks separados: o cache do navegador sobrevive
        // a deploys que só mudam o código do jogo.
        manualChunks(id) {
          if (id.includes('@babylonjs')) return 'babylon';
          if (id.includes('@dimforge')) return 'rapier';
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
