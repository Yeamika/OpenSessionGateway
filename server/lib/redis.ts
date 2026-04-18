import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error("REDIS_URL is required");
}

const parsedRedisUrl = new URL(redisUrl);

const redisOptions = {
  host: parsedRedisUrl.hostname,
  port: parsedRedisUrl.port ? Number(parsedRedisUrl.port) : 6379,
  username: parsedRedisUrl.username ? decodeURIComponent(parsedRedisUrl.username) : undefined,
  password: parsedRedisUrl.password ? decodeURIComponent(parsedRedisUrl.password) : undefined,
  db: parsedRedisUrl.pathname.length > 1 ? Number(parsedRedisUrl.pathname.slice(1)) : undefined,
  tls: parsedRedisUrl.protocol === "rediss:" ? {} : undefined,
  lazyConnect: true,
  maxRetriesPerRequest: 2,
};

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

export const redis =
  globalForRedis.redis ??
  new Redis(redisOptions);

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
