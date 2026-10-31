import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,

  build: {
    outDir: 'dist-node-red',
    emptyOutDir: true,

    lib: {
      entry: 'src/node-red-viewer.js',
      formats: ['es'],
      fileName: () => 'viewer.js'
    }
  }
});