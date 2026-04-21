import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target:                'esnext',
    assetsInlineLimit:     100_000_000,
    chunkSizeWarningLimit: 100_000_000,
    cssCodeSplit:          false,
    minify:                true,
    rollupOptions: {
      input: 'index.html',
      output: {
        inlineDynamicImports: true,
        format:               'iife',
      },
    },
  },
  base: './',
});
