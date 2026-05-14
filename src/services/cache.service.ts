import { redisClient } from "../config/redis";
import { db } from "../db";
import { inconsistencies, items } from "../db/schema";
import { and, eq } from "drizzle-orm";
import { InferSelectModel } from "drizzle-orm";

type Item = InferSelectModel<typeof items>;

export const getCache = async (key: string) => {
  const data = await redisClient.get(key);

  if (!data) return null;

  try {
    return JSON.parse(data);
  } catch {
    console.log("Invalid cache data");
    return null;
  }
};

export const setCacheSafely = async (key: string, incoming: Item) => {
  const enableVersioning = process.env.ENABLE_VERSIONING === "true";

  const current = await redisClient.get(key);

  if (current) {
    let parsed;
    try {
      parsed = JSON.parse(current);
    } catch {
      console.log("Corrupted cache entry");
      return;
    }

    // Block stale writes: if incoming version is older than what's already cached, reject it
    if (enableVersioning && parsed.version > incoming.version) {
      console.log("Stale write blocked");

      const [existing] = await db
        .select()
        .from(inconsistencies)
        .where(
          and(
            eq(inconsistencies.key, key),
            eq(inconsistencies.cacheVersion, incoming.version),
            eq(inconsistencies.dbVersion, parsed.version),
          )
        );

      if (existing) {
        await db
          .update(inconsistencies)
          .set({
            count: existing.count + 1,
            lastSeen: new Date(),
            cacheValue: incoming.value,
            dbValue: parsed.value,
            note: `Stale write blocked: incoming(${incoming.version}) < current(${parsed.version})`,
          })
          .where(eq(inconsistencies.id, existing.id));
      } else {
        await db.insert(inconsistencies).values({
          key,
          cacheVersion: incoming.version,
          dbVersion: parsed.version,
          cacheValue: incoming.value,
          dbValue: parsed.value,
          count: 1,
          firstSeen: new Date(),
          lastSeen: new Date(),
          note: `Stale write blocked: incoming(${incoming.version}) < current(${parsed.version})`,
          resolved: false,
        });
      }

      return;
    }
  }

  await redisClient.set(key, JSON.stringify(incoming));
};