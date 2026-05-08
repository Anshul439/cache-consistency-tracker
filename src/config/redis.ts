import { createClient } from "redis";

export const redisClient = createClient({
  url: process.env.REDIS_URL
});

redisClient.on("error", (err) => console.log("Redis Error", err));

export const connectRedis = async () => {
  await redisClient.connect();
  console.log("Redis connected");
};