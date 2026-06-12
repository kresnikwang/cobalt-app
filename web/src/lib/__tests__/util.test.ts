import { describe, it, expect } from 'vitest';
import { formatFileSize, ffmpegMetadataArgs, uuid } from '$lib/util';

describe('formatFileSize', () => {
    it('should format bytes', () => {
        expect(formatFileSize(0)).toBe('0.00 B');
        expect(formatFileSize(500)).toBe('500.00 B');
    });

    it('should format kilobytes', () => {
        expect(formatFileSize(1024)).toBe('1.00 KB');
        expect(formatFileSize(1536)).toBe('1.50 KB');
    });

    it('should format megabytes', () => {
        expect(formatFileSize(1024 * 1024)).toBe('1.00 MB');
        expect(formatFileSize(10 * 1024 * 1024)).toBe('10.00 MB');
    });

    it('should format gigabytes', () => {
        expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB');
    });

    it('should handle undefined', () => {
        expect(formatFileSize(undefined)).toBe('0.00 B');
    });

    it('should handle 0', () => {
        expect(formatFileSize(0)).toBe('0.00 B');
    });
});

describe('ffmpegMetadataArgs', () => {
    it('should generate metadata args for known keys', () => {
        const metadata = { title: 'My Video', artist: 'Me' };
        const args = ffmpegMetadataArgs(metadata);
        expect(args).toContain('-metadata');
        expect(args).toContain('title=My Video');
        expect(args).toContain('-metadata');
        expect(args).toContain('artist=Me');
    });

    it('should handle sublanguage specially', () => {
        const metadata = { sublanguage: 'eng' };
        const args = ffmpegMetadataArgs(metadata);
        expect(args).toContain('-metadata:s:s:0');
        expect(args).toContain('language=eng');
    });

    it('should ignore unknown keys', () => {
        const metadata = { unknown_field: 'value' };
        const args = ffmpegMetadataArgs(metadata);
        expect(args).toHaveLength(0);
    });

    it('should ignore non-string values', () => {
        const metadata = { title: 123 };
        const args = ffmpegMetadataArgs(metadata);
        expect(args).toHaveLength(0);
    });

    it('should handle empty metadata', () => {
        const args = ffmpegMetadataArgs({});
        expect(args).toHaveLength(0);
    });

    it('should strip control characters from values', () => {
        const metadata = { title: 'test\u0000value' };
        const args = ffmpegMetadataArgs(metadata);
        expect(args).toContain('title=testvalue');
    });
});

describe('uuid', () => {
    it('should return a string', () => {
        const id = uuid();
        expect(typeof id).toBe('string');
    });

    it('should return a UUID v4 format', () => {
        const id = uuid();
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('should generate unique values', () => {
        const ids = new Set(Array.from({ length: 100 }, () => uuid()));
        expect(ids.size).toBe(100);
    });

    it('should have version 4 in the third group', () => {
        const id = uuid();
        const parts = id.split('-');
        expect(parts[2][0]).toBe('4');
    });
});
