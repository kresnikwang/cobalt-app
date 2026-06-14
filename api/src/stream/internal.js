import { request } from "undici";
import { Readable } from "node:stream";
import { closeRequest, getHeaders, pipe } from "./shared.js";
import { handleHlsPlaylist, isHlsResponse, probeInternalHLSTunnel } from "./internal-hls.js";

const min = (a, b) => a < b ? a : b;

const serviceNeedsChunks = new Set(["youtube", "vk"]);

function prepareHeaders(streamInfo, extra = {}) {
    const headers = {};

    // 1. Add default service headers
    for (const [key, value] of Object.entries(getHeaders(streamInfo.service))) {
        headers[key.toLowerCase()] = value;
    }

    // 2. Add streamInfo.headers (contains original scraper headers and client-forwarded headers)
    if (streamInfo.headers) {
        for (const [key, value] of streamInfo.headers) {
            headers[key.toLowerCase()] = value;
        }
    }

    // 3. Add extra parameters (like Range)
    for (const [key, value] of Object.entries(extra)) {
        headers[key.toLowerCase()] = value;
    }

    // 4. Strip dangerous / hop-by-hop headers
    delete headers['host'];
    delete headers['connection'];
    delete headers['upgrade'];
    delete headers['keep-alive'];
    delete headers['proxy-connection'];

    return headers;
}

async function* readChunks(streamInfo, size) {
    let read = 0n, chunksSinceTransplant = 0;
    const chunkSize = BigInt(8e6);

    while (read < size) {
        if (streamInfo.controller.signal.aborted) {
            throw new Error("controller aborted");
        }

        let chunk;
        try {
            chunk = await request(streamInfo.url, {
                headers: prepareHeaders(streamInfo, {
                    Range: `bytes=${read}-${read + chunkSize}`
                }),
                dispatcher: streamInfo.dispatcher,
                signal: streamInfo.controller.signal,
                maxRedirections: 4
            });
        } catch (err) {
            throw err;
        }

        if (chunk.statusCode !== 200 && chunk.statusCode !== 206) {
            console.error(`readChunks: HTTP ${chunk.statusCode} for range ${read}-${read + chunkSize}`);
        }

        if (chunk.statusCode === 403 && chunksSinceTransplant >= 1 && streamInfo.transplant) {
            chunksSinceTransplant = 0;
            try {
                await streamInfo.transplant(streamInfo.dispatcher);
                continue;
            } catch {}
        }

        chunksSinceTransplant++;

        const expected = min(chunkSize, size - read);
        const received = BigInt(chunk.headers['content-length']);

        if (received < expected / 2n) {
            closeRequest(streamInfo.controller);
        }

        for await (const data of chunk.body) {
            yield data;
        }

        read += received;
    }
}

async function handleChunkedStream(streamInfo, res) {
    const { signal } = streamInfo.controller;
    const cleanup = () => (res.end(), closeRequest(streamInfo.controller));

    try {
        let req, attempts = 3;
        let size = 0n;
        let contentType = '';

        while (attempts--) {
            let success = false;
            // 1. Try HEAD request first
            try {
                req = await fetch(streamInfo.url, {
                    headers: prepareHeaders(streamInfo),
                    method: 'HEAD',
                    dispatcher: streamInfo.dispatcher,
                    signal
                });

                if (req.status === 200) {
                    const cl = req.headers.get('content-length');
                    if (cl && cl !== '0') {
                        size = BigInt(cl);
                        contentType = req.headers.get('content-type') || '';
                        if (streamInfo.service !== "youtube") {
                            streamInfo.url = req.url;
                        }
                        success = true;
                    }
                }
            } catch (e) {
                console.error("HEAD request failed:", e.message || e);
            }

            // 2. Fallback to GET with Range: bytes=0-0 (useful for YouTube and others blocking HEAD)
            if (!success) {
                try {
                    req = await fetch(streamInfo.url, {
                        headers: prepareHeaders(streamInfo, {
                            Range: 'bytes=0-0'
                        }),
                        method: 'GET',
                        dispatcher: streamInfo.dispatcher,
                        signal
                    });

                    if (req.status === 206) {
                        const cr = req.headers.get('content-range');
                        if (cr) {
                            const match = cr.match(/\/(\d+)$/);
                            if (match) {
                                size = BigInt(match[1]);
                                contentType = req.headers.get('content-type') || '';
                                if (streamInfo.service !== "youtube") {
                                    streamInfo.url = req.url;
                                }
                                success = true;
                            }
                        }
                    } else if (req.status === 200) {
                        const cl = req.headers.get('content-length');
                        if (cl && cl !== '0') {
                            size = BigInt(cl);
                            contentType = req.headers.get('content-type') || '';
                            if (streamInfo.service !== "youtube") {
                                streamInfo.url = req.url;
                            }
                            success = true;
                        }
                    }
                } catch (e) {
                    console.error("GET fallback request failed:", e.message || e);
                }
            }

            if (success) {
                break;
            }

            // If req failed with 403, transplant and try again
            if (req && req.status === 403 && streamInfo.transplant) {
                try {
                    await streamInfo.transplant(streamInfo.dispatcher);
                } catch {
                    break;
                }
            } else {
                break;
            }
        }

        if (!size) {
            console.error("handleChunkedStream failed to resolve size!");
            return cleanup();
        }

        const generator = readChunks(streamInfo, size);

        const abortGenerator = () => {
            generator.return();
            signal.removeEventListener('abort', abortGenerator);
        }

        signal.addEventListener('abort', abortGenerator);

        const stream = Readable.from(generator);

        if (contentType) res.setHeader('content-type', contentType);
        res.setHeader('content-length', String(size));

        pipe(stream, res, cleanup);
    } catch {
        cleanup();
    }
}

async function handleGenericStream(streamInfo, res) {
    const { signal } = streamInfo.controller;
    const cleanup = () => res.end();

    try {
        const headers = prepareHeaders(streamInfo);

        const fileResponse = await request(streamInfo.url, {
            headers,
            dispatcher: streamInfo.dispatcher,
            signal,
            maxRedirections: 16
        });

        res.status(fileResponse.statusCode);
        fileResponse.body.on('error', () => {});

        const isHls = isHlsResponse(fileResponse, streamInfo);

        for (const [ name, value ] of Object.entries(fileResponse.headers)) {
            if (!isHls || name.toLowerCase() !== 'content-length') {
                res.setHeader(name, value);
            }
        }

        if (fileResponse.statusCode < 200 || fileResponse.statusCode > 299) {
            return cleanup();
        }

        if (isHls) {
            await handleHlsPlaylist(streamInfo, fileResponse, res);
        } else {
            pipe(fileResponse.body, res, cleanup);
        }
    } catch {
        closeRequest(streamInfo.controller);
        cleanup();
    }
}

export function internalStream(streamInfo, res) {
    if (streamInfo.headers) {
        streamInfo.headers.delete('icy-metadata');
    }

    if (serviceNeedsChunks.has(streamInfo.service) && !streamInfo.isHLS) {
        return handleChunkedStream(streamInfo, res);
    }

    return handleGenericStream(streamInfo, res);
}

export async function probeInternalTunnel(streamInfo) {
    try {
        const signal = AbortSignal.timeout(3000);
        const headers = prepareHeaders(streamInfo);

        if (streamInfo.isHLS) {
            return probeInternalHLSTunnel({
                ...streamInfo,
                signal,
                headers
            });
        }

        // Try HEAD first
        let response = await request(streamInfo.url, {
            method: 'HEAD',
            headers,
            dispatcher: streamInfo.dispatcher,
            signal,
            maxRedirections: 16
        });

        if (response.statusCode === 200) {
            const size = +response.headers['content-length'];
            if (!isNaN(size)) return size;
        }

        // Fallback to GET with Range: bytes=0-0
        response = await request(streamInfo.url, {
            method: 'GET',
            headers: prepareHeaders(streamInfo, {
                range: 'bytes=0-0'
            }),
            dispatcher: streamInfo.dispatcher,
            signal,
            maxRedirections: 16
        });

        if (response.statusCode === 206) {
            const contentRange = response.headers['content-range'];
            if (contentRange) {
                const match = contentRange.match(/\/(\d+)$/);
                if (match) {
                    return +match[1];
                }
            }
        } else if (response.statusCode === 200) {
            const size = +response.headers['content-length'];
            if (!isNaN(size)) return size;
        }

        throw "unable to probe size";
    } catch {}
}
