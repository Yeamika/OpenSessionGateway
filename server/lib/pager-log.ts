import { redis } from "@/lib/redis";

const PAGER_LOG_KEY = "opensession_gateway:pager:records";
const MAX_PAGER_RECORDS = 200;

export type PagerRecord = {
  id: string;
  createdAt: string;
  caller: string;
  callee: string;
  message: string;
  status: "success" | "failed" | "timeout" | "offline";
};

export async function addPagerRecord(record: PagerRecord) {
  await redis.lpush(PAGER_LOG_KEY, JSON.stringify(record));
  await redis.ltrim(PAGER_LOG_KEY, 0, MAX_PAGER_RECORDS - 1);
}

export async function listPagerRecords(limit = 50): Promise<PagerRecord[]> {
  const size = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50;
  const rows = await redis.lrange(PAGER_LOG_KEY, 0, size - 1);
  const parsed: PagerRecord[] = [];
  for (const row of rows) {
    try {
      const item = JSON.parse(row) as PagerRecord;
      if (item && typeof item.id === "string") {
        parsed.push(item);
      }
    } catch {
    }
  }
  return parsed;
}
