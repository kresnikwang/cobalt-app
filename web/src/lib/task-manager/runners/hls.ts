import HLSWorker from "$lib/task-manager/workers/hls?worker";

import { killWorker } from "$lib/task-manager/run-worker";
import { updateWorkerProgress } from "$lib/state/task-manager/current-tasks";
import { pipelineTaskDone, itemError, queue } from "$lib/state/task-manager/queue";

import type { CobaltQueue, UUID } from "$lib/types/queue";

export const runHLSWorker = async (workerId: UUID, parentId: UUID, tunnelUrl: string) => {
    const worker = new HLSWorker();

    const unsubscribe = queue.subscribe((queue: CobaltQueue) => {
        if (!queue[parentId]) {
            killWorker(worker, unsubscribe);
        }
    });

    worker.postMessage({
        cobaltHLSWorker: {
            tunnelUrl,
        }
    });

    worker.onmessage = (event) => {
        const eventData = event.data.cobaltHLSWorker;
        if (!eventData) return;

        if (eventData.progress !== undefined || eventData.phase === 'segments') {
            updateWorkerProgress(workerId, {
                percentage: eventData.progress || 0,
                size: eventData.size,
            });
        }

        if (eventData.result) {
            killWorker(worker, unsubscribe);
            return pipelineTaskDone(
                parentId,
                workerId,
                eventData.result,
            );
        }

        if (eventData.error) {
            killWorker(worker, unsubscribe);
            return itemError(parentId, workerId, eventData.error);
        }
    };
};
