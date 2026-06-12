import type {
    CobaltSaveRequest,
    CobaltAPIResponse,
    CobaltErrorResponse,
    CobaltServerInfo,
    CobaltSession,
} from './types.js';

export type { CobaltSaveRequest, CobaltAPIResponse, CobaltErrorResponse, CobaltServerInfo };
export type * from './types.js';

export interface CobaltClientOptions {
    /** Base URL of the Cobalt API instance (e.g. "https://api.cobalt.tools") */
    baseUrl: string;
    /** API key for authentication (optional) */
    apiKey?: string;
    /** Request timeout in milliseconds (default: 20000) */
    timeout?: number;
}

export class CobaltClient {
    readonly #baseUrl: string;
    readonly #apiKey?: string;
    readonly #timeout: number;

    constructor(options: CobaltClientOptions) {
        this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.#apiKey = options.apiKey;
        this.#timeout = options.timeout ?? 20000;
    }

    /** Get the processing instance information */
    async getServerInfo(): Promise<CobaltServerInfo | CobaltErrorResponse> {
        return this.#fetch<CobaltServerInfo>('/');
    }

    /**
     * Process a URL for saving — the main "save what you love" endpoint.
     * The response type depends on the content and request parameters.
     */
    async save(request: CobaltSaveRequest): Promise<CobaltAPIResponse | undefined> {
        return this.#fetch<CobaltAPIResponse>('/', {
            method: 'POST',
            body: JSON.stringify(request),
        });
    }

    /**
     * Create a JWT session (requires Turnstile captcha on the server).
     * Returns a session token that can be used for authenticated requests.
     */
    async createSession(turnstileToken: string): Promise<CobaltSession | CobaltErrorResponse> {
        return this.#fetch<CobaltSession>('/session', {
            method: 'POST',
            headers: {
                'Cf-Turnstile-Token': turnstileToken,
            },
        });
    }

    /**
     * Probe a tunnel URL to check if the media is ready.
     * Returns the HTTP status code (200 = ready).
     */
    async probeTunnel(url: string): Promise<number> {
        try {
            const resp = await this.#fetchRaw(`${url}&p=1`);
            return resp?.status ?? 0;
        } catch {
            return 0;
        }
    }

    // ─── Private ────────────────────────────────────────

    async #fetch<T>(path: string, init?: RequestInit): Promise<T | undefined> {
        const url = `${this.#baseUrl}${path}`;
        const headers: Record<string, string> = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            ...(init?.headers as Record<string, string>),
        };

        if (this.#apiKey) {
            headers['Authorization'] = `Api-Key ${this.#apiKey}`;
        }

        // @ts-expect-error: AbortSignal.timeout may not be in all TypeScript lib targets
        const signal = init?.signal ?? AbortSignal.timeout(this.#timeout);

        try {
            const resp = await fetch(url, { ...init, headers, signal });
            return resp.json() as Promise<T>;
        } catch {
            return undefined;
        }
    }

    async #fetchRaw(url: string): Promise<Response | undefined> {
        try {
            // @ts-expect-error: AbortSignal.timeout
            return await fetch(url, { signal: AbortSignal.timeout(this.#timeout) });
        } catch {
            return undefined;
        }
    }
}

/**
 * Create a Cobalt API client.
 *
 * @example
 * ```ts
 * import { createCobaltClient } from '@imput/cobalt-client';
 *
 * const cobalt = createCobaltClient({ baseUrl: 'https://api.cobalt.tools' });
 * const result = await cobalt.save({ url: 'https://youtube.com/watch?v=...' });
 * ```
 */
export function createCobaltClient(options: CobaltClientOptions): CobaltClient {
    return new CobaltClient(options);
}
