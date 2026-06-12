import { describe, it, expect, vi } from 'vitest';

// mocks are handled by vitest-setup.ts and vitest config aliases
const { validateSettings } = await import('$lib/settings/validate');

describe('validateSettings', () => {
    const minimalValid = {
        schemaVersion: 7,
    };

    const fullValid = {
        schemaVersion: 7,
        appearance: { theme: 'light' },
        save: {
            downloadMode: 'auto',
            filenameStyle: 'classic',
            videoQuality: '1080',
            youtubeVideoCodec: 'h264',
            savingMethod: 'download',
            youtubeDubLang: 'original',
        },
    };

    it('should reject settings without schemaVersion', () => {
        expect(validateSettings({} as any)).toBe(false);
    });

    it('should accept minimal valid settings', () => {
        expect(validateSettings(minimalValid)).toBe(true);
    });

    it('should accept fully populated valid settings', () => {
        expect(validateSettings(fullValid)).toBe(true);
    });

    it('should reject invalid theme value', () => {
        expect(validateSettings({
            schemaVersion: 7,
            appearance: { theme: 'purple' },
        } as any)).toBe(false);
    });

    it('should accept all valid theme options', () => {
        for (const theme of ['auto', 'light', 'dark'] as const) {
            expect(validateSettings({
                schemaVersion: 7,
                appearance: { theme },
            })).toBe(true);
        }
    });

    it('should reject invalid download mode', () => {
        expect(validateSettings({
            schemaVersion: 7,
            save: { downloadMode: 'invalid' },
        } as any)).toBe(false);
    });

    it('should reject invalid video quality', () => {
        expect(validateSettings({
            schemaVersion: 7,
            save: { videoQuality: '9999' },
        } as any)).toBe(false);
    });

    it('should reject if appearance is a string instead of object', () => {
        expect(validateSettings({
            schemaVersion: 7,
            appearance: 'dark',
        } as any)).toBe(false);
    });

    it('should reject extra top-level properties not in defaults', () => {
        expect(validateSettings({
            schemaVersion: 7,
            extraField: 'anything',
        } as any)).toBe(false);
    });
});
