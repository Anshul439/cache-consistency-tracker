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

A `pendingValidation` Map prevents duplicate `DETECTED` logs if the same item is picked up multiple times within the grace window.

---

## Flow

```
PUT /items/:id → update DB + Redis
  └─ [FAILURE_MODE=delay] → overwrite Redis with stale value after 2s

Worker (every 5s) → cursor-based sweep → compare DB vs Redis
  MATCH    → resolve open records
  MISMATCH → new? log + start grace period
              known? silent update
              after 2s: recheck → confirm → persist
```

---

## Stack

- **Node.js + TypeScript**, Express v5
- **PostgreSQL** (Drizzle ORM)
- **Redis**

---

## Setup

```bash
pnpm install
```

`.env`:
```env
PORT=5001
POSTGRES_URL=postgresql://postgres:PASSWORD@localhost:5432/polaris_db
REDIS_URL=redis://localhost:6379
FAILURE_MODE=delay
```

```bash
pnpm drizzle-kit push   # create tables
pnpm dev                # API server
pnpm worker             # background sweeper
pnpm studio             # Drizzle Studio
```

