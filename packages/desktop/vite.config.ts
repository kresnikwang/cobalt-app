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
        // Main process entry — force CJS output because Electron's built-in
        // `electron` module is CJS-only and cannot be ESM-imported.
        // By specifying lib.formats=['cjs'], we override vite-plugin-electron's
        // default which would output ESM (because package.json has "type":"module").
        entry: 'src/main/index.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron/main',
            minify: false,
            lib: {
              entry: path.resolve(__dirname, 'src/main/index.ts'),
              formats: ['cjs'],
              fileName: () => 'index.cjs',
            },
            rollupOptions: {
              external: (id) => {
                // bundle workspace packages that electron-builder can't find in asar
                if (id === '@imput/version-info') return false;
                // Externalize the cobalt API — it uses top-level await (incompatible with CJS)
                // and will be loaded via dynamic import() at runtime
                if (id.includes('/api/src/cobalt') || id.includes('\\api\\src\\cobalt')) return true;
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
