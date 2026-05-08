import dotenv from "dotenv";
import { connectRedis } from "./config/redis";
import { startConsistencyJob } from "./jobs/consistency.job";

dotenv.config();

const startWorker = async () => {
  await connectRedis();

  console.log("Worker started");

  startConsistencyJob();
};

startWorker();