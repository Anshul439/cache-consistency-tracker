import { Queue } from "bullmq";
import { bullmqConnection } from "../config/bullmq";

export const CONSISTENCY_QUEUE_NAME = "consistency-validation";
export const CONSISTENCY_CONFIRMATION_DELAY_MS = 2000;
export const POST_WRITE_CHECK_DELAY_MS = CONSISTENCY_CONFIRMATION_DELAY_MS + 500;

type ConsistencyJobData = {
  id: string;
};

const getConfirmationDeduplicationId = (id: string) => `confirm-${id}`;

export const consistencyQueue = new Queue<ConsistencyJobData>(CONSISTENCY_QUEUE_NAME, {
  connection: bullmqConnection,
});

export const scheduleConsistencyCheck = async (id: string, delayMs = 0) => {
  await consistencyQueue.add(
    "check-item",
    { id },
    {
      delay: delayMs,
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
};

export const scheduleConsistencyConfirmation = async (id: string) => {
  await consistencyQueue.add(
    "confirm-item",
    { id },
    {
      delay: CONSISTENCY_CONFIRMATION_DELAY_MS,
      deduplication: {
        id: getConfirmationDeduplicationId(id),
        ttl: CONSISTENCY_CONFIRMATION_DELAY_MS,
        extend: true,
        replace: true,
      },
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
};

export const hasPendingConfirmation = async (id: string) => {
  const jobId = await consistencyQueue.getDeduplicationJobId(
    getConfirmationDeduplicationId(id),
  );

  return Boolean(jobId);
};

export const cancelPendingConfirmation = async (id: string) => {
  const deduplicationId = getConfirmationDeduplicationId(id);
  const jobId = await consistencyQueue.getDeduplicationJobId(deduplicationId);

  if (!jobId) {
    return false;
  }

  await consistencyQueue.removeDeduplicationKey(deduplicationId);

  const pendingJob = await consistencyQueue.getJob(jobId);
  if (pendingJob) {
    await pendingJob.remove();
  }

  return true;
};
