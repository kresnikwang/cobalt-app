import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        globals: true,
        setupFiles: ['./src/lib/polyfills/vitest-setup.ts'],
    },
    resolve: {
        alias: {
            '$lib': path.resolve(__dirname, 'src/lib'),
            '$components': path.resolve(__dirname, 'src/components'),
            '$app/environment': path.resolve(__dirname, 'src/lib/polyfills/vitest-env.ts'),
            '$i18n/languages.json': path.resolve(__dirname, 'src/lib/polyfills/vitest-languages.json'),
        },
    },
});
