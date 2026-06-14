import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';
import fs from 'fs';

function copyPreload() {
  const src = path.resolve(__dirname, 'src/preload/index.cjs');
  const dest = path.resolve(__dirname, 'dist-electron/preload/index.cjs');

  const copy = () => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  };

  return {
    name: 'copy-electron-preload',
    buildStart: copy,
    configureServer() {
      copy();
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [
    copyPreload(),
    svelte(),
    electron([
      {
        // Main process entry
        entry: 'src/main/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron/main',
            minify: false,
            rollupOptions: {
              external: (id) => {
                // bundle workspace packages that electron-builder can't find in asar
                if (id === '@imput/version-info') return false;
                return !id.startsWith('.') && !path.isAbsolute(id);
              }
            }
          }
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
