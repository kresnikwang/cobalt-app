import * as Storage from "$lib/storage";

// Minimal m3u8 parser — extracts segment URIs from a master or media playlist.
// Returns absolute URLs resolved against the playlist base URL.
const parseM3U8Segments = (text: string, baseUrl: string): string[] => {
    const segments: string[] = [];
    const lines = text.split('\n');

    for (const raw of lines) {
        const line = raw.trim();
        // Skip comments, directives, and empty lines
        if (!line || line.startsWith('#')) {
            continue;
        }

        // Absolute URL
        if (line.startsWith('http://') || line.startsWith('https://')) {
            segments.push(line);
        } else {
            // Resolve relative URL against the playlist base
            segments.push(new URL(line, baseUrl).toString());
        }
    }

    return segments;
};

const networkErrors = [
    "TypeError: Failed to fetch",
    "TypeError: network error",
];

let attempts = 0;

const hlsFetch = async (tunnelUrl: string) => {
    const error = async (code: string, retry = true) => {
        attempts++;
        if (retry && attempts <= 3) {
            await hlsFetch(tunnelUrl);
        } else {
            self.postMessage({
                cobaltHLSWorker: { error: code }
            });
            self.close();
        }
    };

    try {
        // Step 1: fetch the m3u8 playlist via the tunnel
        self.postMessage({
            cobaltHLSWorker: { phase: 'playlist', progress: 0 }
        });

        const playlistResp = await fetch(tunnelUrl);
        if (!playlistResp.ok) {
            return error("queue.hls.bad_playlist_response");
        }

        const playlistText = await playlistResp.text();
        if (!playlistText.trim().startsWith('#EXTM3U')) {
            return error("queue.hls.invalid_playlist");
        }

        // Resolve the *effective* URL in case of redirects
        const playlistBase = playlistResp.url || tunnelUrl;

        // Step 2: parse segments
        const segments = parseM3U8Segments(playlistText, playlistBase);
        if (segments.length === 0) {
            return error("queue.hls.no_segments");
        }

        self.postMessage({
            cobaltHLSWorker: {
                phase: 'segments',
                total: segments.length,
                current: 0,
                progress: 0,
            }
        });

        // Step 3: download all segments sequentially
        const segmentBlobs: Blob[] = [];
        let totalBytes = 0;

        for (let i = 0; i < segments.length; i++) {
            const segUrl = segments[i];
            let segResp: Response;

            try {
                segResp = await fetch(segUrl);
            } catch {
                return error("queue.hls.segment_fetch_failed", false);
            }

            if (!segResp.ok) {
                return error("queue.hls.segment_bad_response", false);
            }

            const blob = await segResp.blob();
            if (blob.size === 0) {
                return error("queue.hls.segment_empty", false);
            }

            segmentBlobs.push(blob);
            totalBytes += blob.size;

            self.postMessage({
                cobaltHLSWorker: {
                    phase: 'segments',
                    total: segments.length,
                    current: i + 1,
                    size: totalBytes,
                    progress: Math.round(((i + 1) / segments.length) * 80), // 0–80% for downloads
                }
            });
        }

        // Step 4: concatenate all segments into one file
        self.postMessage({
            cobaltHLSWorker: { phase: 'merge', progress: 85 }
        });

        const concatenated = new Blob(segmentBlobs);

        self.postMessage({
            cobaltHLSWorker: { phase: 'merge', progress: 95 }
        });

        // Store to OPFS and return a File handle
        const storage = await Storage.init(totalBytes);
        const buffer = await concatenated.arrayBuffer();
        await storage.write(new Uint8Array(buffer), 0);

        const file = Storage.retype(
            await storage.res(),
            'video/MP2T' // MPEG transport stream — standard HLS segment format
        );

        self.postMessage({
            cobaltHLSWorker: {
                phase: 'done',
                progress: 100,
                result: file,
            }
        });

    } catch (e) {
        if (networkErrors.includes(String(e))) {
            return error("queue.hls.network_error");
        }
        console.error("error from the hls worker:");
        console.error(e);
        return error("queue.hls.crashed", false);
    }
};

self.onmessage = async (event: MessageEvent) => {
    if (event.data.cobaltHLSWorker?.tunnelUrl) {
        await hlsFetch(event.data.cobaltHLSWorker.tunnelUrl);
    }
};
