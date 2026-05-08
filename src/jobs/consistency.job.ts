import { db } from "../db";
import { items } from "../db/schema";
import { gt, asc } from "drizzle-orm";
import { checkConsistency } from "../services/tracker.service";

// Cursor-based sweep: tracks the last checked item ID to paginate through the table sequentially
let lastCheckedId = "00000000-0000-0000-0000-000000000000";

export const startConsistencyJob = () => {
  setInterval(async () => {
    const batch = await db
      .select()
      .from(items)
      .where(gt(items.id, lastCheckedId))
      .orderBy(asc(items.id))
      .limit(100);

    if (batch.length === 0) {
      // Full sweep complete — reset cursor to restart from the beginning
      console.log(JSON.stringify({ type: "SWEEP_COMPLETE" }));
      lastCheckedId = "00000000-0000-0000-0000-000000000000";
      return;
    }

    for (const item of batch) {
      await checkConsistency(item.id);
    }

    lastCheckedId = batch[batch.length - 1].id;
  }, 5000);
};
