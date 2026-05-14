import dotenv from "dotenv";
import { connectRedis } from "./config/redis";
import { startConsistencyJob } from "./jobs/consistency.job";
import { startConsistencyQueueWorker } from "./queues/consistency.worker";

dotenv.config();

const startWorker = async () => {
  await connectRedis();

  console.log("Worker started");

  startConsistencyQueueWorker();
  startConsistencyJob();
};

startWorker();
