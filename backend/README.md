# @forge/backend

Onchain indexer + REST API for the Forge marketplace on Arc testnet.

**Status:** Phase 6.3-A scaffold (workspace + schema). Event handlers
land in Phase C; API endpoints in Phase D; production deploy in Phase E.

## Architecture

```
Arc testnet
  └── eth_getLogs polling (viem)
        └── src/indexer/handlers/  ← per-event handlers (Phase C)
              └── Postgres (Drizzle)
                    └── src/api/   ← Hono REST endpoints (Phase D)
                          └── consumed by frontend in lieu of direct RPC
```

The indexer is **additive**, not destructive. Frontend hooks continue
reading directly from chain until the API catches up; switch is per-hook,
gradual.

## Local development

```sh
# Install workspace deps (from repo root)
pnpm install

# Backend-only env:
cd backend
cp .env.example .env
$EDITOR .env  # set DATABASE_URL

# Set up Postgres
createdb forge_indexer
pnpm db:generate   # produces SQL migration from schema.ts
pnpm db:migrate    # applies migration to DATABASE_URL

# Run the indexer (Phase C+):
pnpm dev

# Run the API server (Phase D+):
pnpm api:dev
```

## Layout

```
src/
├── indexer/        Block-polling loop + per-event handlers
├── api/            Hono REST endpoints for the frontend
├── db/             Drizzle schema, client, migrations
└── lib/            Shared ABIs + addresses + chain config (mirrors frontend)
```
