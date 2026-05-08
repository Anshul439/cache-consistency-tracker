import { pgTable, text, integer, boolean, timestamp, jsonb, uuid } from "drizzle-orm/pg-core";

export const items = pgTable("items", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  value: jsonb("value").notNull(),
  version: integer("version").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdateFn(() => new Date()).notNull(),
});

export const inconsistencies = pgTable("inconsistencies", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  cacheVersion: integer("cache_version").notNull(),
  dbVersion: integer("db_version").notNull(),
  resolved: boolean("resolved").default(false).notNull(),
  count: integer("count").default(1).notNull(),
  cacheValue: jsonb("cache_value"),
  dbValue: jsonb("db_value"),
  firstSeen: timestamp("first_seen").defaultNow().notNull(),
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
  note: text("note"),
});
