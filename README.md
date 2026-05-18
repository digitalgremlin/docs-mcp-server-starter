# Docs MCP Server Starter

Give Claude, Cursor, and any MCP-compatible AI assistant queryable access to up-to-date technical documentation. This Apify Actor runs a persistent MCP server that indexes docs sites, exposes search and fetch tools over the Model Context Protocol, and caches pages for fast follow-up queries.

Ships with five ready-to-use templates (Next.js, Tailwind CSS, React, TypeScript, Prisma). Fork it for any docs site by supplying a URL and a CSS content selector — no code changes required.

## Who is this for?

- **Developers using AI coding assistants** who want answers grounded in the *current* docs, not training-data snapshots that may be months out of date
- **Teams with internal documentation** who want their AI tooling to answer questions against their own docs, not just public sources
- **MCP builders** who want a working Standby-mode reference implementation to fork

## What it does

- Crawls and indexes up to 10 documentation sources on startup
- Exposes four MCP tools over JSON-RPC on a persistent HTTP endpoint
- Caches fetched pages in an LRU cache (default 50) so repeat queries return instantly
- Returns content as clean markdown by default, or raw text on request

## Input

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `sources` | array (1–10) | required | Each source needs a `name` plus either a `template` ID *or* a custom `url` + `contentSelector`. Optional `sitemapUrl`. |
| `maxPagesPerSource` | integer (1–500) | 200 | Cap on how many pages per source get indexed at startup. Lower this to speed up boot for large docs sites. |
| `cacheMaxPages` | integer (1–200) | 50 | LRU page cache shared across all sources. Raise this if you query the same pages repeatedly. |
| `markdownOutput` | boolean | `true` | Convert extracted page HTML to markdown. Set `false` to return raw text. |

### Curated templates

`nextjs`, `tailwind`, `react`, `typescript`, `prisma`

### Custom source example

```json
{
  "sources": [
    { "name": "Apify SDK", "url": "https://docs.apify.com/sdk/js", "contentSelector": "main article" }
  ]
}
```

## MCP tools

| Tool | Purpose | Required args |
| --- | --- | --- |
| `list_sources` | List configured sources with page counts | — |
| `get_toc` | Return the page index (table of contents) for a source | `source` |
| `search_docs` | Case-insensitive keyword search across titles and cached content | `query` (optional: `source`, `maxResults` ≤ 30) |
| `get_page` | Fetch full page content; checks LRU cache first | `url` |

### Example tool calls

```json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": { "name": "list_sources", "arguments": {} } }

{ "jsonrpc": "2.0", "id": 2, "method": "tools/call",
  "params": { "name": "search_docs",
              "arguments": { "query": "server actions", "source": "Next.js Docs", "maxResults": 5 } } }

{ "jsonrpc": "2.0", "id": 3, "method": "tools/call",
  "params": { "name": "get_page",
              "arguments": { "url": "https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions" } } }
```

## How it works

1. **Boot:** `Actor.init()`, validate input, resolve any curated templates
2. **Index:** for each source, fetch the sitemap (or discover from the entry URL), cap at `maxPagesPerSource`, and build a page index (`url` + `title`)
3. **Serve:** start an HTTP server on `ACTOR_STANDBY_PORT` (default `4321`); accept POST requests carrying JSON-RPC MCP messages
4. **Cache:** `get_page` returns cached content when available; on miss it fetches, extracts via the source's `contentSelector`, optionally converts to markdown, and stores in the LRU
5. **Search:** `search_docs` scans page titles in all source indexes and content in the LRU cache only — page bodies are not pre-indexed; warm the cache by calling `get_page` on the pages you want searchable

## Running on Apify

This actor runs in **Standby mode** — a persistent HTTP server, not a batch job. Connect an MCP client to the Standby URL exposed by Apify after deploy. The server starts after indexing completes; check the run logs for `MCP server listening.` before sending requests.

## Design choices (v1)

- **Keyword search, not vectors.** No embedding costs, no vector store to maintain, predictable behavior. Good fit for docs lookups where terminology is precise.
- **Static HTTP fetching only.** Works with any docs site served by a static generator (Hugo, Next.js static export, Docusaurus, WordPress, MkDocs, etc.). Sites that require JS execution or sit behind bot challenges (Cloudflare, login walls) won't index — pick the underlying static source instead.
- **Search reads cached bodies; uncached pages match on title.** Warm the cache by calling `get_page` on the pages you want full-text searchable.
- **Caps.** Max 10 sources, 500 pages per source, 200 pages in cache.

## Local development

```bash
npm install
npm test            # pipeline, cache, indexer, extractor, mcp, searcher, sitemap suites
apify run           # local Standby — server listens on ACTOR_STANDBY_PORT or 4321
```

## License

Apache-2.0
