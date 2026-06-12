// Vitest polyfill for $lib/i18n/translations
import { readable } from 'svelte/store';
import { vi } from 'vitest';

type TranslationFn = (key: string, params?: any) => string;

const stubT: TranslationFn = (key: string) => key;

export const defaultLocale = 'en';
export const t = readable(stubT);
export const locale = readable('en');
export const loading = readable(false);
export const locales = readable(['en']);
export const translations = readable({});
export const loadTranslations = vi.fn();
export const addTranslations = vi.fn();
export const setLocale = vi.fn();
export const setRoute = vi.fn();
