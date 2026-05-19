# Docs MCP Server Starter

Actor: `joeslade/docs-mcp-server-starter`
Standby URL: `https://joeslade--docs-mcp-server-starter.apify.actor`
Console: `https://console.apify.com/actors/svh29mBnmXJ0TdXka`

## Commands

```bash
npm test                       # vitest (75 tests across 7 files)
npx tsc --noEmit               # type check
apify run --purge              # local Standby boot, no INPUT.json needed
./scripts/smoke-test.sh        # local end-to-end MCP verification
./scripts/smoke-test-prod.sh   # prod Standby endpoint verification
```

## Architecture

Four MCP tools over JSON-RPC 2.0 HTTP (Standby mode): `list_sources`, `get_toc`, `search_docs`, `get_page`.

State lives in `ServerState` (`src/mcp.ts`):
- `sources: Map<string, SourceIndex>` — built lazily, keyed by source name
- `buildLocks: Map<string, Promise<SourceIndex>>` — thundering-herd guard
- `cache: LruCache<string, CachedPage>` — page content cache
- `maxPagesPerSource: number` — passed through to `buildSourceIndex`

`ensureIndexed(state, sourceDef)` is the entry point for on-demand indexing. Checks `sources` Map first; on miss, creates a `buildPromise` via `buildSourceIndex`, stores it in `buildLocks`, stores the result in `sources` on resolve. Lock deleted on both resolve and reject (retryable).

Sources come from two places: (1) pre-built at boot from `input.sources[]`, (2) on-demand via `sourceDef` argument in any tool call.

## Lessons from v0.2.0 Standby Refactor

### Standby actors must accept empty input

Apify boots Standby containers with no INPUT.json. Any `validateInput` that throws on missing required fields causes a crash loop — Apify spawns replacements that all fail identically (133 failed runs in 90s was the observed failure mode). Fix: make all fields optional (`sources?: SourceConfig[]`) and default to empty (`sources = input.sources ?? []`). Pre-index at boot only if sources were provided.

### Map vs Array for mutable server state

`ServerState.sources` started as a frozen `SourceIndex[]` passed at construction. Lazy indexing requires a mutable `Map<string, SourceIndex>` that grows at request time. All `find()` calls become `get()`; `map()` calls become `Array.from(values()).map()`. Downstream consumers that still expect `SourceIndex[]` (e.g. `searchDocs`) receive `Array.from(state.sources.values())` — no changes needed in those files.

### buildLocks thundering-herd pattern

Two concurrent first requests for the same uncached source must not trigger two index builds:

```typescript
const inflight = state.buildLocks.get(name);
if (inflight) return inflight;
const p = buildSourceIndex(...).then(idx => {
  state.sources.set(idx.name, idx);
  state.buildLocks.delete(idx.name);
  return idx;
}).catch(err => {
  state.buildLocks.delete(name);  // allow retry on failure
  throw err;
});
state.buildLocks.set(name, p);
return p;
```

The lock is stored before `await`, so concurrent callers share the same Promise. Delete on both resolve and reject.

### Standby isEnabled is false by default after apify push

`apify push` deploys the actor but does not enable Standby mode, even with `"standby"` in `actor.json.tags`. After push, `actorStandby.isEnabled` is `false` and all requests to the Standby URL return `actor-standby-mode-not-enabled`. Enable via API:

```bash
curl -X PUT "https://api.apify.com/v2/acts/<ACTOR_ID>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"actorStandby":{"isEnabled":true,"build":"latest","memoryMbytes":1024,"idleTimeoutSecs":300}}'
```

Or toggle in Console → Actor Settings → Standby.

### Docker local testing: omit APIFY_IS_AT_HOME

Setting `-e APIFY_IS_AT_HOME=1` tells the Apify SDK the container is on-platform. Without a real run context, `ChargingManager.fetchPricingInfo` throws "Actor run ID not found." Omit it — the SDK falls back to local dev mode:

```bash
docker run --rm -e ACTOR_STANDBY_PORT=4321 -p 4321:4321 <image>
```
