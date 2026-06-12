// Vitest global setup — mocks modules that depend on SvelteKit or Vite-specific features
import { vi } from 'vitest';

vi.mock('$lib/i18n/translations', () => {
    const s = (v: any) => ({
        subscribe: (fn: any) => { fn(v); return () => {}; },
    });
    return {
        defaultLocale: 'en',
        t: s((key: string) => key),
        locale: s('en'),
        loading: s(false),
        locales: s(['en']),
        translations: s({}),
        loadTranslations: vi.fn(),
        addTranslations: vi.fn(),
        setLocale: vi.fn(),
        setRoute: vi.fn(),
    };
});
