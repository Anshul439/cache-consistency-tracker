import { Worker } from "bullmq";
import { bullmqConnection } from "../config/bullmq";
import { checkConsistency, confirmInconsistency } from "../services/tracker.service";
import { CONSISTENCY_QUEUE_NAME } from "./consistency.queue";

type ConsistencyJobData = {
  id: string;
};

export const startConsistencyQueueWorker = () => {
  const worker = new Worker<ConsistencyJobData>(
    CONSISTENCY_QUEUE_NAME,
    async (job) => {
      if (job.name === "check-item") {
        await checkConsistency(job.data.id);
        return;
      }

      if (job.name === "confirm-item") {
        await confirmInconsistency(job.data.id);
        return;
      }

      throw new Error(`Unknown consistency job: ${job.name}`);
    },
    { connection: bullmqConnection },
  );

  worker.on("error", (error) => {
    console.error("Consistency queue worker error:", error);
  });

  worker.on("failed", (job, error) => {
    console.error("Consistency queue job failed:", {
      jobId: job?.id,
      jobName: job?.name,
      error,
    });
  });

  return worker;
};
