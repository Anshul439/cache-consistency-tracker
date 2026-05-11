import { redisClient } from "../config/redis";
import { db } from "../db";
import { items, inconsistencies } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";

// Tracks in-progress grace period timers by cache key.
// Prevents duplicate DETECTED logs if the same item is checked multiple times within the 2s window.
const pendingValidation = new Map<string, NodeJS.Timeout>();

const hasValueMismatch = (cacheValue: unknown, dbValue: unknown) =>
  !isDeepStrictEqual(cacheValue, dbValue);

export const checkConsistency = async (id: string) => {
  const key = `item:${id}`;

  const cacheData = await redisClient.get(key);
  const [dbData] = await db.select().from(items).where(eq(items.id, id));

  if (!cacheData || !dbData) return;

  let parsedCache;
  try {
    parsedCache = JSON.parse(cacheData);
  } catch {
    return;
  }

  if (hasValueMismatch(parsedCache.value, dbData.value)) {
    const [existing] = await db
      .select()
      .from(inconsistencies)
      .where(
        and(
          eq(inconsistencies.key, key),
          eq(inconsistencies.cacheVersion, parsedCache.version),
          eq(inconsistencies.dbVersion, dbData.version),
          eq(inconsistencies.resolved, false),
        ),
      );

    const isPending = pendingValidation.has(key);

    if (!existing && !isPending) {
      console.log(JSON.stringify({
        type: "INCONSISTENCY_DETECTED",
        key,
        cache: parsedCache.value,
        db: dbData.value,
        cacheVersion: parsedCache.version,
        dbVersion: dbData.version,
      }));
    }

    // Debounce: reset timer on each detection, confirm only after 2s of sustained mismatch
    if (pendingValidation.has(key)) {
      clearTimeout(pendingValidation.get(key)!);
    }

    const timer = setTimeout(async () => {
      await confirmInconsistency(id);
      pendingValidation.delete(key);
    }, 2000);

    pendingValidation.set(key, timer);
  } else {
    if (pendingValidation.has(key)) {
      clearTimeout(pendingValidation.get(key)!);
      pendingValidation.delete(key);
      console.log(JSON.stringify({ type: "RESOLVED_BEFORE_CONFIRMATION", key }));
    }

    const result = await db
      .update(inconsistencies)
      .set({ resolved: true, lastSeen: new Date() })
      .where(and(eq(inconsistencies.key, key), eq(inconsistencies.resolved, false)))
      .returning();

    if (result.length > 0) {
      console.log(JSON.stringify({ type: "INCONSISTENCY_RESOLVED", key, resolvedCount: result.length }));
    }
  }
};

const confirmInconsistency = async (id: string) => {
  const key = `item:${id}`;

  const cacheData = await redisClient.get(key);
  const [dbData] = await db.select().from(items).where(eq(items.id, id));

  if (!cacheData || !dbData) return;

  let parsedCache;
  try {
    parsedCache = JSON.parse(cacheData);
  } catch {
    return;
  }

  if (hasValueMismatch(parsedCache.value, dbData.value)) {
    const [existing] = await db
      .select()
      .from(inconsistencies)
      .where(
        and(
          eq(inconsistencies.key, key),
          eq(inconsistencies.cacheVersion, parsedCache.version),
          eq(inconsistencies.dbVersion, dbData.version),
          eq(inconsistencies.resolved, false),
        ),
      );

    if (!existing) {
      console.log(JSON.stringify({
        type: "INCONSISTENCY_CONFIRMED",
        key,
        cache: parsedCache.value,
        db: dbData.value,
        cacheVersion: parsedCache.version,
        dbVersion: dbData.version,
      }));

      await db.insert(inconsistencies).values({
        key,
        cacheVersion: parsedCache.version,
        dbVersion: dbData.version,
        cacheValue: parsedCache.value,
        dbValue: dbData.value,
        count: 1,
        firstSeen: new Date(),
        lastSeen: new Date(),
        note: `Confirmed: cache(${parsedCache.version}) vs db(${dbData.version})`,
        resolved: false,
      });
    } else {
      await db
        .update(inconsistencies)
        .set({
          count: existing.count + 1,
          lastSeen: new Date(),
          cacheValue: parsedCache.value,
          dbValue: dbData.value,
          note: `Confirmed: cache(${parsedCache.version}) vs db(${dbData.version})`,
        })
        .where(eq(inconsistencies.id, existing.id));
    }
  }
};
