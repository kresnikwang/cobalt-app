import FFmpegWorker from "$lib/task-manager/workers/ffmpeg?worker";

import { killWorker } from "$lib/task-manager/run-worker";
import { updateWorkerProgress } from "$lib/state/task-manager/current-tasks";
import { pipelineTaskDone, itemError, queue } from "$lib/state/task-manager/queue";

import type { FileInfo } from "$lib/types/libav";
import type { CobaltQueue } from "$lib/types/queue";

// Per-pipeline retry counter (keyed by parentId) to avoid
// sharing state across concurrent ffmpeg workers.
const startAttempts = new Map<string, number>();

export const runFFmpegWorker = async (
    workerId: string,
    parentId: string,
    files: File[],
    args: string[],
    output: FileInfo,
    variant: 'remux' | 'encode',
    yesthreads: boolean,
    resetStartCounter = false,
) => {
    const worker = new FFmpegWorker();

    // Chrome sometimes refuses to start libav WASM workers on the first attempt.
    // This is a known Chromium bug (WASM/SharedArrayBuffer initialization race).
    // We retry the worker startup up to 10 times per pipeline before giving up.

    if (resetStartCounter) startAttempts.set(parentId, 0);

    let bumpAttempts = 0;
    const startCheck = setInterval(() => {
        bumpAttempts++;

        if (bumpAttempts === 10) {
            const attempts = (startAttempts.get(parentId) || 0) + 1;
            startAttempts.set(parentId, attempts);

            if (attempts <= 10) {
                killWorker(worker, unsubscribe, startCheck);
                // fire-and-forget retry via a new worker instance
                runFFmpegWorker(
                    workerId, parentId,
                    files, args, output,
                    variant, yesthreads
                ).catch((err) => {
                    console.error(`ffmpeg worker retry #${attempts} failed:`, err);
                    itemError(parentId, workerId, "queue.worker_didnt_start");
                });
            } else {
                killWorker(worker, unsubscribe, startCheck);
                startAttempts.delete(parentId); // cleanup
                itemError(parentId, workerId, "queue.worker_didnt_start");
            }
        }
    }, 500);

    const unsubscribe = queue.subscribe((queue: CobaltQueue) => {
        if (!queue[parentId]) {
            killWorker(worker, unsubscribe, startCheck);
        }
    });

    worker.postMessage({
        cobaltFFmpegWorker: {
            variant,
            files,
            args,
            output,
            yesthreads,
        }
    });

    worker.onerror = (e) => {
        console.error("ffmpeg worker crashed:", e);
        killWorker(worker, unsubscribe, startCheck);

        return itemError(parentId, workerId, "queue.generic_error");
    };

    let totalDuration: number | null = null;

    worker.onmessage = (event) => {
        const eventData = event.data.cobaltFFmpegWorker;
        if (!eventData) return;

        clearInterval(startCheck);

        if (eventData.progress) {
            if (eventData.progress.duration) {
                totalDuration = eventData.progress.duration;
            }

            updateWorkerProgress(workerId, {
                percentage: totalDuration ? (eventData.progress.durationProcessed / totalDuration) * 100 : 0,
                size: eventData.progress.size,
            })
        }

        if (eventData.render) {
            killWorker(worker, unsubscribe, startCheck);
            return pipelineTaskDone(
                parentId,
                workerId,
                eventData.render,
            );
        }

        if (eventData.error) {
            killWorker(worker, unsubscribe, startCheck);
            return itemError(parentId, workerId, eventData.error);
        }
    };
}
