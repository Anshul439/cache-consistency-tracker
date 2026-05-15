# Cache Consistency Tracker

Early-stage Node.js prototype exploring **cache inconsistency detection** between Redis and PostgreSQL.

---

## The Problem

In systems with a cache layer, the DB and cache can silently diverge. Most systems either ignore this or spam logs on every detected mismatch. This prototype explores a middle ground — detecting inconsistencies, validating them with a grace period, and tracking their full lifecycle without log spam.

---

## Core Idea (Polaris-inspired)

Log only on state transitions. Not on every poll.

- **Detected** → mismatch found, 2s grace period starts
- **Confirmed** → still mismatched after 2s → written to DB
- **Persistent** → silent updates (`count++`, `lastSeen`) on repeat checks
- **Resolved** → values back in sync → marked resolved

The grace period exists because DB and Redis are written sequentially. The 2s window filters in-flight write blips before treating something as a real bug.

BullMQ delayed jobs hold the grace-period confirmation state, so pending confirmations survive worker restarts. Deduplication ensures the same item does not accumulate many identical confirmation jobs during that window.

---

## Flow

```text
PUT /items/:id → update DB + Redis
  ├─ enqueue immediate BullMQ consistency check
  ├─ enqueue delayed BullMQ post-write check
  └─ [FAILURE_MODE=delay] → overwrite Redis with stale value after 2s

BullMQ worker
  ├─ check-item   → compare DB vs Redis
  │                 MATCH    → resolve open records / cancel pending confirmation
  │                 MISMATCH → new? log DETECTED
  │                              then enqueue delayed confirmation
  └─ confirm-item → recheck after 2s grace period
                    still mismatched? confirm → persist

Backup audit worker (every 5s)
  └─ cursor-based sweep → compare DB vs Redis for all items over time
```

---

## Stack

- **Node.js + TypeScript**, Express v5
- **PostgreSQL** (Drizzle ORM)
- **Redis**
- **BullMQ** for durable delayed confirmation and queue-based checks

---

## Setup

**Docker (recommended):**
```bash
docker compose up
```
Starts PostgreSQL, Redis, the API server, and the background worker. Tables are created automatically on first run.

**Manual:**

```bash
pnpm install
```

`.env`:
```env
PORT=5001
POSTGRES_URL=postgresql://postgres:PASSWORD@localhost:5432/cache_consistency_db
REDIS_URL=redis://localhost:6379
FAILURE_MODE=delay
ENABLE_VERSIONING=false
```

```bash
pnpm drizzle-kit push   # create tables
pnpm dev                # API server
pnpm worker             # BullMQ worker + backup sweep worker
pnpm studio             # Drizzle Studio
```

## Current Architecture

- **API server**
  - handles create/read/update/debug-refresh routes
  - performs read-through caching
  - schedules queue-based consistency checks after writes

- **BullMQ worker**
  - processes immediate consistency checks
  - processes delayed confirmation jobs after the grace period

- **Backup sweep worker**
  - still scans items in batches every 5 seconds
  - acts as an audit path in case any write-triggered event is missed

## API

- `POST /items`
  - create a new item in PostgreSQL

- `GET /items/:id`
  - cache-first read: on a miss, fetches from DB and populates Redis

- `PUT /items/:id`
  - update the source-of-truth record
  - update Redis
  - enqueue immediate and delayed consistency checks

- `GET /items/inconsistencies/all`
  - list every recorded inconsistency, resolved and unresolved

- `GET /items/inconsistencies/active`
  - list only unresolved inconsistencies

- `POST /items/debug/refresh/:id`
  - manually refresh Redis from PostgreSQL
  - mark open inconsistency records for that key as resolved

- `GET /metrics`
  - return cache hit/miss counters and inconsistency lifecycle metrics

## Quick Test Flow

1. `POST /items`
2. `GET /items/:id`
3. `GET /items/:id` again
4. `PUT /items/:id`
5. wait a few seconds
6. `GET /items/inconsistencies/active`
7. `POST /items/debug/refresh/:id`
8. `GET /items/inconsistencies/active`
