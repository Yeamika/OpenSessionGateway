import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error("REDIS_URL is required");
}

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

export const redis =
  globalForRedis.redis ??
  new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
