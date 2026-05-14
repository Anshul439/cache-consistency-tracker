import { redisClient } from "../config/redis";
import { db } from "../db";
import { items, inconsistencies } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import {
  cancelPendingConfirmation,
  hasPendingConfirmation,
  scheduleConsistencyConfirmation,
} from "../queues/consistency.queue";

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

    const isPending = await hasPendingConfirmation(id);

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

    await scheduleConsistencyConfirmation(id);
  } else {
    const clearedPendingConfirmation = await cancelPendingConfirmation(id);
    if (clearedPendingConfirmation) {
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

export const confirmInconsistency = async (id: string) => {
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
