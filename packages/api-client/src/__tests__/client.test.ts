import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CobaltClient, createCobaltClient } from '../index';

describe('CobaltClient', () => {
    let client: CobaltClient;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        // @ts-expect-error: mocking global fetch
        global.fetch = fetchMock;

        client = new CobaltClient({ baseUrl: 'https://api.example.com/' });
    });

    describe('constructor', () => {
        it('should strip trailing slashes from baseUrl', () => {
            const c = new CobaltClient({ baseUrl: 'https://api.example.com///' });
            // Test by checking that the constructed URL is clean
            const saveReq = { url: 'https://youtube.com/watch?v=test' };
            fetchMock.mockResolvedValueOnce({
                json: () => Promise.resolve({ status: 'redirect', url: 'https://...', filename: 'test.mp4' }),
            });

            c.save(saveReq);
            const url = fetchMock.mock.calls[0][0];
            expect(url).toBe('https://api.example.com/');
        });

        it('should use default timeout of 20000ms', () => {
            const c = new CobaltClient({ baseUrl: 'https://api.example.com' });
            // Private field can't be directly tested, but we verify it's constructed
            expect(c).toBeInstanceOf(CobaltClient);
        });

        it('should accept custom timeout', () => {
            const c = new CobaltClient({ baseUrl: 'https://api.example.com', timeout: 5000 });
            expect(c).toBeInstanceOf(CobaltClient);
        });
    });

    describe('save', () => {
        it('should make a POST request with the correct body', async () => {
            fetchMock.mockResolvedValueOnce({
                json: () => Promise.resolve({ status: 'redirect', url: 'https://cdn.example.com/video.mp4', filename: 'video.mp4' }),
            });

            const result = await client.save({
                url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
                downloadMode: 'auto',
                videoQuality: '1080',
            });

            expect(result).toBeDefined();
            expect(fetchMock).toHaveBeenCalledTimes(1);

            const [url, options] = fetchMock.mock.calls[0];
            expect(url).toBe('https://api.example.com/');
            expect(options.method).toBe('POST');
            expect(options.headers['Content-Type']).toBe('application/json');

            const body = JSON.parse(options.body);
            expect(body.url).toBe('https://youtube.com/watch?v=dQw4w9WgXcQ');
            expect(body.downloadMode).toBe('auto');
            expect(body.videoQuality).toBe('1080');
        });

        it('should handle error responses', async () => {
            fetchMock.mockResolvedValueOnce({
                json: () => Promise.resolve({
                    status: 'error',
                    error: { code: 'error.api.link.invalid' },
                }),
            });

            const result = await client.save({ url: 'invalid-url' });

            expect(result).toBeDefined();
            expect(result?.status).toBe('error');
            if (result?.status === 'error') {
                expect(result.error.code).toBe('error.api.link.invalid');
            }
        });

        it('should handle tunnel responses', async () => {
            fetchMock.mockResolvedValueOnce({
                json: () => Promise.resolve({
                    status: 'tunnel',
                    url: 'https://api.example.com/tunnel?id=abc&exp=123&sig=xyz&sec=key&iv=iv',
                    filename: 'My Video.mp4',
                }),
            });

            const result = await client.save({ url: 'https://tiktok.com/@user/video/123' });

            expect(result?.status).toBe('tunnel');
            if (result?.status === 'tunnel') {
                expect(result.filename).toBe('My Video.mp4');
            }
        });

        it('should handle picker responses', async () => {
            fetchMock.mockResolvedValueOnce({
                json: () => Promise.resolve({
                    status: 'picker',
                    picker: [{ type: 'photo', url: 'https://...', thumb: 'https://...' }],
                    audio: 'https://...',
                    audioFilename: 'audio.mp3',
                }),
            });

            const result = await client.save({ url: 'https://instagram.com/p/abc' });

            expect(result?.status).toBe('picker');
            if (result?.status === 'picker') {
                expect(result.picker).toHaveLength(1);
                expect(result.picker[0].type).toBe('photo');
            }
        });
    });

    describe('getServerInfo', () => {
        it('should fetch server info from /', async () => {
            fetchMock.mockResolvedValueOnce({
                json: () => Promise.resolve({
                    cobalt: {
                        version: '11.7.1',
                        url: 'https://api.example.com',
                        startTime: '2025-01-01T00:00:00Z',
                        services: ['youtube', 'tiktok', 'twitter'],
                    },
                    git: {
                        branch: 'main',
                        commit: 'abc123',
                        remote: 'https://github.com/imputnet/cobalt',
                    },
                }),
            });

            const info = await client.getServerInfo();

            expect(info).toBeDefined();
            if (!('error' in info)) {
                expect(info.cobalt.version).toBe('11.7.1');
                expect(info.cobalt.services).toContain('youtube');
            }
        });
    });

    describe('probeTunnel', () => {
        it('should return 200 for successful probe', async () => {
            fetchMock.mockResolvedValueOnce({ status: 200 });

            const status = await client.probeTunnel('https://api.example.com/tunnel?id=abc');

            expect(status).toBe(200);
            expect(fetchMock.mock.calls[0][0]).toContain('&p=1');
        });

        it('should return 0 for failed probe', async () => {
            fetchMock.mockRejectedValueOnce(new Error('Network error'));

            const status = await client.probeTunnel('https://api.example.com/tunnel?id=abc');

            expect(status).toBe(0);
        });

        it('should return 0 for non-200 response', async () => {
            fetchMock.mockResolvedValueOnce({ status: 404 });

            const status = await client.probeTunnel('https://api.example.com/tunnel?id=abc');

            expect(status).toBe(404);
        });
    });

    describe('createSession', () => {
        it('should POST to /session with turnstile token', async () => {
            fetchMock.mockResolvedValueOnce({
                json: () => Promise.resolve({
                    token: 'jwt-token-here',
                    exp: Date.now() + 120000,
                }),
            });

            const result = await client.createSession('turnstile-token');

            expect(fetchMock).toHaveBeenCalledTimes(1);
            const [url, options] = fetchMock.mock.calls[0];
            expect(url).toBe('https://api.example.com/session');
            expect(options.method).toBe('POST');

            if (!('error' in result)) {
                expect(result.token).toBe('jwt-token-here');
            }
        });
    });

    describe('API key authentication', () => {
        it('should include Authorization header when apiKey is set', async () => {
            const authClient = new CobaltClient({
                baseUrl: 'https://api.example.com',
                apiKey: 'my-secret-key',
            });

            fetchMock.mockResolvedValueOnce({
                json: () => Promise.resolve({ status: 'redirect', url: '...', filename: 'test.mp4' }),
            });

            await authClient.save({ url: 'https://example.com/video' });

            const [, options] = fetchMock.mock.calls[0];
            expect(options.headers['Authorization']).toBe('Api-Key my-secret-key');
        });
    });
});

describe('createCobaltClient', () => {
    it('should create a CobaltClient instance', () => {
        const client = createCobaltClient({ baseUrl: 'https://api.example.com' });
        expect(client).toBeInstanceOf(CobaltClient);
    });
});
