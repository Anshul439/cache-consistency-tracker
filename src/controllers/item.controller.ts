import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { items, inconsistencies } from "../db/schema";
import { eq, desc, and } from "drizzle-orm";
import { getCache, setCacheSafely } from "../services/cache.service";
import { metrics } from "../utils/metrics";

const createItemSchema = z.object({
  name: z.string().min(1, "name is required"),
  value: z.unknown().refine((v) => v !== undefined && v !== null, {
    message: "value is required",
  }),
});

const updateItemSchema = z.object({
  value: z.unknown().refine((v) => v !== undefined && v !== null, {
    message: "value is required",
  }),
});

export const createItem = async (req: Request, res: Response) => {
  try {
    const parsed = createItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ errors: parsed.error.flatten().fieldErrors });
    }

    const { name, value } = parsed.data;
    const [item] = await db.insert(items).values({ name, value }).returning();

    return res.json(item);
  } catch (error) {
    console.error("Error creating item:", error);
    return res.status(500).json({ msg: "Internal server error" });
  }
};

export const getItem = async (req: Request, res: Response) => {
  const { id } = req.params;
  const cacheKey = `item:${id}`;

  try {
    const cached = await getCache(cacheKey);
    if (cached) {
      metrics.cacheHits++;
      console.log("Cache HIT");
      return res.json({ source: "cache", data: cached });
    }

    metrics.cacheMisses++;
    console.log("Cache MISS");

    const [item] = await db.select().from(items).where(eq(items.id, id));

    if (!item) {
      return res.status(404).json({ msg: "Item not found" });
    }

    await setCacheSafely(cacheKey, item);
    return res.json({ source: "db", data: item });
  } catch (error) {
    console.error("Error in getItem:", error);
    return res.status(500).json({ msg: "Internal server error" });
  }
};

export const updateItem = async (req: Request, res: Response) => {
  const { id } = req.params;
  const cacheKey = `item:${id}`;

  const parsed = updateItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: parsed.error.flatten().fieldErrors });
  }

  const { value } = parsed.data;

  try {
    const [oldItemFromDB] = await db.select().from(items).where(eq(items.id, id));

    const [updated] = await db
      .update(items)
      .set({ value, version: (oldItemFromDB.version ?? 1) + 1 })
      .where(eq(items.id, id))
      .returning();

    if (!updated) {
      return res.status(404).json({ msg: "Item not found" });
    }

    await setCacheSafely(cacheKey, updated);

    // Simulates a stale cache overwrite to trigger inconsistency detection
    if (process.env.FAILURE_MODE === "delay" && oldItemFromDB) {
      setTimeout(async () => {
        console.log("Simulating stale overwrite...");
        await setCacheSafely(cacheKey, oldItemFromDB);
      }, 2000);
    }

    return res.json({ msg: "Updated", data: updated });
  } catch (error) {
    console.error("Error in updateItem:", error);
    return res.status(500).json({ msg: "Internal server error" });
  }
};

export const getInconsistencies = async (req: Request, res: Response) => {
  try {
    const logs = await db
      .select()
      .from(inconsistencies)
      .orderBy(desc(inconsistencies.lastSeen));

    const logsWithDuration = logs.map((log) => {
      const duration = log.lastSeen.getTime() - log.firstSeen.getTime();
      return { ...log, durationMs: duration, durationSec: (duration / 1000).toFixed(2) };
    });

    return res.json(logsWithDuration);
  } catch (error) {
    console.error("Error fetching inconsistencies:", error);
    return res.status(500).json({ msg: "Internal server error" });
  }
};

export const getActiveInconsistencies = async (req: Request, res: Response) => {
  try {
    const logs = await db
      .select()
      .from(inconsistencies)
      .where(eq(inconsistencies.resolved, false))
      .orderBy(desc(inconsistencies.lastSeen));

    const logsWithDuration = logs.map((log) => {
      const duration = log.lastSeen.getTime() - log.firstSeen.getTime();
      return { ...log, durationMs: duration, durationSec: (duration / 1000).toFixed(2) };
    });

    return res.json(logsWithDuration);
  } catch (error) {
    console.error("Error fetching active inconsistencies:", error);
    return res.status(500).json({ msg: "Internal server error" });
  }
};

export const refreshItem = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const cacheKey = `item:${id}`;
    const [item] = await db.select().from(items).where(eq(items.id, id));

    if (!item) {
      return res.status(404).json({ msg: "Item not found" });
    }

    await setCacheSafely(cacheKey, item);

    const result = await db
      .update(inconsistencies)
      .set({ resolved: true, lastSeen: new Date() })
      .where(and(eq(inconsistencies.key, cacheKey), eq(inconsistencies.resolved, false)))
      .returning();

    if (result.length > 0) {
      console.log(JSON.stringify({ type: "INCONSISTENCY_RESOLVED", key: cacheKey, resolvedCount: result.length, source: "manual" }));
    }

    return res.json({ msg: "Item refreshed and inconsistencies resolved", data: item });
  } catch (error) {
    console.error("Error refreshing item:", error);
    return res.status(500).json({ msg: "Internal server error" });
  }
};