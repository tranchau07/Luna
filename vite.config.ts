import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', 'three-custom-shader-material', 'three-mesh-bvh', 'postprocessing'],
          nature: ['@dgreenheck/ez-tree', 'three.quarks', 'yuka'],
        },
      },
    },
  },
});
