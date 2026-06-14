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

/**
 * Remove `crossorigin` attributes from the built index.html.
 * Electron's `file://` protocol does not send CORS headers, so
 * `crossorigin` on `<script>` and `<link>` causes silent load failures.
 */
function stripCrossorigin() {
  return {
    name: 'strip-crossorigin',
    enforce: 'post' as const,
    closeBundle() {
      const htmlPath = path.resolve(__dirname, 'dist/index.html');
      if (!fs.existsSync(htmlPath)) return;
      let html = fs.readFileSync(htmlPath, 'utf-8');
      // Remove crossorigin from script and link tags
      html = html.replace(/\s+crossorigin(?:="[^"]*")?/g, '');
      fs.writeFileSync(htmlPath, html);
      console.log('[strip-crossorigin] Removed crossorigin attributes from dist/index.html');
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [
    copyPreload(),
    stripCrossorigin(),
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
