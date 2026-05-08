import express from "express";
import dotenv from "dotenv";
import { connectRedis } from "./config/redis";
import itemRoutes from "./routes/item.route";
import { metrics } from "./utils/metrics";
import { db } from "./db";
import { inconsistencies } from "./db/schema";
import { eq, count, avg, sql } from "drizzle-orm";

dotenv.config();

const app = express();
app.use(express.json());

const start = async () => {
  await connectRedis();

  app.use("/items", itemRoutes);

  app.get("/metrics", async (req, res) => {
    try {
      const [activeResult] = await db
        .select({ value: count() })
        .from(inconsistencies)
        .where(eq(inconsistencies.resolved, false));

      const [resolvedResult] = await db
        .select({ value: count() })
        .from(inconsistencies)
        .where(eq(inconsistencies.resolved, true));

      const [avgResult] = await db
        .select({
          avgDuration: avg(
            sql`EXTRACT(EPOCH FROM (${inconsistencies.lastSeen} - ${inconsistencies.firstSeen}))`
          ),
        })
        .from(inconsistencies)
        .where(eq(inconsistencies.resolved, true));

      const avgResolution = avgResult?.avgDuration ?? 0;

      res.json({
        cacheHits: metrics.cacheHits,
        cacheMisses: metrics.cacheMisses,
        activeInconsistencies: activeResult.value,
        resolvedInconsistencies: resolvedResult.value,
        totalInconsistencies: activeResult.value + resolvedResult.value,
        avgResolutionTime: Number(avgResolution).toFixed(2),
      });
    } catch (error) {
      console.error("Error fetching metrics:", error);
      res.status(500).json({ msg: "Internal server error" });
    }
  });

  app.listen(process.env.PORT, () => {
    console.log(`Server running on port ${process.env.PORT}`);
  });
};

start();
