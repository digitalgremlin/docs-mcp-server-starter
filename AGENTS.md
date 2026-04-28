# AGENTS.md

## Actor: Docs MCP Server Starter

### Bounded implementation tasks (acceptable for Codex)

- Implement a single pure-function module (cache, sitemap, extractor, indexer, searcher)
- Write tests for a single module given function signatures
- Implement the MCP handler (mcp.ts) given complete test spec and tool contract
- Add a new curated template to templates.ts

### Off-limits for Codex (requires Claude Code review)

- Any change to the MCP tool contract (tool names, input/output schemas)
- Any change to the LRU eviction logic
- Modifications to main.ts beyond what is explicitly specified

### Testing

Always run `npm test` after any implementation. All tests must pass before marking a task complete.

### Non-negotiables

- Determinism is sacred — no randomness, no time-based behavior in tests
- Pure functions only — I/O in main.ts only
- Fixture-based tests — no network calls in tests
- `search_docs` must use `cache.peek()` not `cache.get()` to avoid affecting LRU order
