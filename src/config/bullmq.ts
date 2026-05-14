const DEFAULT_REDIS_PORT = 6379;
const DEFAULT_REDIS_DB = 0;

const getRedisUrl = () => {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error("REDIS_URL is required for BullMQ");
  }

  return new URL(redisUrl);
};

export const bullmqConnection = (() => {
  const redisUrl = getRedisUrl();
  const dbPath = redisUrl.pathname.replace("/", "");

  return {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || DEFAULT_REDIS_PORT),
    username: redisUrl.username || undefined,
    password: redisUrl.password || undefined,
    db: dbPath ? Number(dbPath) : DEFAULT_REDIS_DB,
  };
})();
