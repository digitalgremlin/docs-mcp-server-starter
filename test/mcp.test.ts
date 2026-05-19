import { describe, it, expect } from 'vitest';
import { handleMcpRequest } from '../src/mcp.js';
import { LruCache } from '../src/cache.js';
import type { SourceIndex, CachedPage, FetchFn, SourceConfig } from '../src/types.js';

const makeState = (sources: SourceIndex[] = [], fetchFn?: FetchFn) => ({
  sources: new Map(sources.map((s) => [s.name, s])),
  cache: new LruCache<string, CachedPage>(50),
  fetchFn: fetchFn ?? (async () => ({ html: '', ok: false, status: 500 })),
  markdownOutput: true,
  maxPagesPerSource: 200,
  buildLocks: new Map<string, Promise<SourceIndex>>(),
});

const req = (id: number, method: string, params?: Record<string, unknown>) =>
  ({ jsonrpc: '2.0' as const, id, method, params });

const toolResult = (response: Awaited<ReturnType<typeof handleMcpRequest>>) =>
  JSON.parse((response.result as { content: Array<{ text: string }> }).content[0].text);

describe('MCP protocol', () => {
  it('handles initialize', async () => {
    const r = await handleMcpRequest(req(1, 'initialize', { protocolVersion: '2024-11-05' }), makeState());
    expect(r.error).toBeUndefined();
    expect((r.result as { protocolVersion: string }).protocolVersion).toBe('2024-11-05');
    expect((r.result as { capabilities: unknown }).capabilities).toEqual({ tools: {} });
  });

  it('handles tools/list — returns all 4 tools', async () => {
    const r = await handleMcpRequest(req(2, 'tools/list'), makeState());
    const tools = (r.result as { tools: Array<{ name: string }> }).tools;
    const names = tools.map(t => t.name);
    expect(names).toContain('list_sources');
    expect(names).toContain('get_toc');
    expect(names).toContain('search_docs');
    expect(names).toContain('get_page');
  });

  it('returns -32601 for unknown method', async () => {
    const r = await handleMcpRequest(req(3, 'unknown/method'), makeState());
    expect(r.error?.code).toBe(-32601);
  });

  it('returns -32602 for tools/call with missing name', async () => {
    const r = await handleMcpRequest(req(4, 'tools/call', { arguments: {} }), makeState());
    expect(r.error?.code).toBe(-32602);
  });
});

describe('list_sources', () => {
  it('returns source names, urls, and page counts', async () => {
    const sources: SourceIndex[] = [{
      name: 'Next.js',
      url: 'https://nextjs.org/docs',
      contentSelector: 'article',
      pages: [
        { url: 'https://nextjs.org/docs/getting-started', title: 'Getting Started', section: null },
      ],
    }];
    const r = await handleMcpRequest(req(1, 'tools/call', { name: 'list_sources', arguments: {} }), makeState(sources));
    const result = toolResult(r);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toEqual({ name: 'Next.js', url: 'https://nextjs.org/docs', pageCount: 1 });
  });
});

describe('get_toc', () => {
  const sources: SourceIndex[] = [{
    name: 'Docs',
    url: 'https://a.com/docs',
    contentSelector: 'main',
    pages: [
      { url: 'https://a.com/docs/intro', title: 'Introduction', section: null },
      { url: 'https://a.com/docs/api/ref', title: 'API Reference', section: 'Api' },
    ],
  }];

  it('returns pages for a known source', async () => {
    const r = await handleMcpRequest(req(1, 'tools/call', { name: 'get_toc', arguments: { source: 'Docs' } }), makeState(sources));
    const result = toolResult(r);
    expect(result.source).toBe('Docs');
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].url).toBe('https://a.com/docs/intro');
  });

  it('returns error for unknown source', async () => {
    const r = await handleMcpRequest(req(2, 'tools/call', { name: 'get_toc', arguments: { source: 'Unknown' } }), makeState(sources));
    const result = toolResult(r);
    expect(result.error).toMatch(/Unknown/);
  });

  it('returns -32602 when source field is missing', async () => {
    const r = await handleMcpRequest(req(3, 'tools/call', { name: 'get_toc', arguments: {} }), makeState(sources));
    expect(r.error?.code).toBe(-32602);
  });
});

describe('search_docs', () => {
  const sources: SourceIndex[] = [{
    name: 'Docs',
    url: 'https://a.com/docs',
    contentSelector: 'main',
    pages: [
      { url: 'https://a.com/docs/api', title: 'API Reference', section: null },
      { url: 'https://a.com/docs/config', title: 'Configuration', section: null },
    ],
  }];

  it('returns matching results', async () => {
    const r = await handleMcpRequest(req(1, 'tools/call', { name: 'search_docs', arguments: { query: 'api' } }), makeState(sources));
    const result = toolResult(r);
    expect(result.query).toBe('api');
    expect(result.source).toBeNull();
    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe('API Reference');
  });

  it('returns -32602 when query is missing', async () => {
    const r = await handleMcpRequest(req(2, 'tools/call', { name: 'search_docs', arguments: {} }), makeState(sources));
    expect(r.error?.code).toBe(-32602);
  });

  it('caps maxResults at 30', async () => {
    const r = await handleMcpRequest(req(3, 'tools/call', { name: 'search_docs', arguments: { query: 'a', maxResults: 999 } }), makeState(sources));
    const result = toolResult(r);
    expect(result.results.length).toBeLessThanOrEqual(30);
  });
});

describe('get_page', () => {
  const pageUrl = 'https://a.com/docs/intro';
  const sources: SourceIndex[] = [{
    name: 'Docs',
    url: 'https://a.com/docs',
    contentSelector: 'main.content',
    pages: [{ url: pageUrl, title: 'Introduction', section: null }],
  }];

  it('fetches page, returns content, and sets cachedAt to null on first fetch', async () => {
    const fetchFn: FetchFn = async () => ({
      html: `<html><body><main class="content"><h1>Introduction</h1><p>Hello.</p></main></body></html>`,
      ok: true,
      status: 200,
    });
    const r = await handleMcpRequest(req(1, 'tools/call', { name: 'get_page', arguments: { url: pageUrl } }), makeState(sources, fetchFn));
    const result = toolResult(r);
    expect(result.url).toBe(pageUrl);
    expect(result.title).toBe('Introduction');
    expect(result.content).toContain('Introduction');
    expect(result.cachedAt).toBeNull();
  });

  it('returns from cache on second fetch, cachedAt is ISO timestamp', async () => {
    const fetchFn: FetchFn = async () => ({
      html: `<html><body><main class="content"><p>Cached.</p></main></body></html>`,
      ok: true, status: 200,
    });
    const state = makeState(sources, fetchFn);
    await handleMcpRequest(req(1, 'tools/call', { name: 'get_page', arguments: { url: pageUrl } }), state);
    const r2 = await handleMcpRequest(req(2, 'tools/call', { name: 'get_page', arguments: { url: pageUrl } }), state);
    const result = toolResult(r2);
    expect(result.cachedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns error object for URL not in any source index', async () => {
    const r = await handleMcpRequest(req(1, 'tools/call', { name: 'get_page', arguments: { url: 'https://missing.com/page' } }), makeState(sources));
    const result = toolResult(r);
    expect(result.error).toBe('URL not found in any configured source index');
  });

  it('returns error object when fetch fails', async () => {
    const fetchFn: FetchFn = async () => ({ html: '', ok: false, status: 503 });
    const r = await handleMcpRequest(req(1, 'tools/call', { name: 'get_page', arguments: { url: pageUrl } }), makeState(sources, fetchFn));
    const result = toolResult(r);
    expect(result.error).toMatch(/503/);
    expect(result.url).toBe(pageUrl);
  });

  it('returns -32602 when url field is missing', async () => {
    const r = await handleMcpRequest(req(1, 'tools/call', { name: 'get_page', arguments: {} }), makeState(sources));
    expect(r.error?.code).toBe(-32602);
  });
});

// ─── Boundary tests (v0.2 lazy-indexing architecture) ─────────────────────────
//
// These tests define the NEW ServerState shape and lazy-indexing contract.
// They all fail today because:
//   1. ServerState.sources is SourceIndex[], not Map<string, SourceIndex>
//   2. handleMcpRequest has no ensureIndexed / buildLocks logic
//   3. dispatchTool calls state.sources.find / .map, which throw on a Map
//
// All three describe blocks should be RED until the v0.2 refactor lands.

// Inline sitemap fixtures for two independent sources.
// parseSitemapXml filters by baseUrl prefix, so each URL must match its source.
const SITEMAP_X = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://docs-x.example.com/intro</loc></url>
</urlset>`;

const SITEMAP_Y = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://docs-y.example.com/guide</loc></url>
</urlset>`;

const SOURCE_X_DEF: SourceConfig = {
  name: 'Docs X',
  url: 'https://docs-x.example.com',
  contentSelector: 'main',
};

const SOURCE_Y_DEF: SourceConfig = {
  name: 'Docs Y',
  url: 'https://docs-y.example.com',
  contentSelector: 'article',
};

// Constructs the v0.2 ServerState shape (Map-based sources + buildLocks).
// Passing this to handleMcpRequest currently throws at runtime because
// dispatchTool calls state.sources.find() / .map() on a Map object.
const makeStandbyState = (fetchFn?: FetchFn) => ({
  sources: new Map<string, SourceIndex>(),
  cache: new LruCache<string, CachedPage>(50),
  fetchFn: fetchFn ?? (async () => ({ html: '', ok: false, status: 500 })),
  markdownOutput: true,
  maxPagesPerSource: 200,
  buildLocks: new Map<string, Promise<SourceIndex>>(),
});

// ─── Boundary 1: lazy per-source indexing ────────────────────────────────────

describe('boundary 1 — lazy per-source indexing', () => {
  it('no index built at construction; first request for X builds X; second reuses it; first request for Y builds Y without touching X', async () => {
    let xFetchCalls = 0;
    let yFetchCalls = 0;

    const lazyFetch: FetchFn = async (url) => {
      if (url.includes('docs-x.example.com')) {
        xFetchCalls++;
        if (url.endsWith('sitemap.xml')) return { html: SITEMAP_X, ok: true, status: 200 };
        return { html: '<html><body><main><h1>X Intro</h1></main></body></html>', ok: true, status: 200 };
      }
      if (url.includes('docs-y.example.com')) {
        yFetchCalls++;
        if (url.endsWith('sitemap.xml')) return { html: SITEMAP_Y, ok: true, status: 200 };
        return { html: '<html><body><article><h1>Y Guide</h1></article></body></html>', ok: true, status: 200 };
      }
      return { html: '', ok: false, status: 404 };
    };

    const state = makeStandbyState(lazyFetch);

    // No network I/O at construction time
    expect(xFetchCalls).toBe(0);
    expect(yFetchCalls).toBe(0);

    // First request for X — must trigger exactly one index build
    const tocX1 = await handleMcpRequest(
      req(10, 'tools/call', { name: 'get_toc', arguments: { source: 'Docs X', sourceDef: SOURCE_X_DEF } }),
      state as unknown as Parameters<typeof handleMcpRequest>[1],
    );
    const resX1 = toolResult(tocX1);
    expect(resX1.source).toBe('Docs X');
    expect(resX1.pages).toHaveLength(1);
    expect((state.sources as Map<string, SourceIndex>).has('Docs X')).toBe(true);
    const xCallsAfterFirstRequest = xFetchCalls;
    expect(xCallsAfterFirstRequest).toBeGreaterThan(0);

    // Second request for X — index already in Map, no new fetches
    await handleMcpRequest(
      req(11, 'tools/call', { name: 'get_toc', arguments: { source: 'Docs X', sourceDef: SOURCE_X_DEF } }),
      state as unknown as Parameters<typeof handleMcpRequest>[1],
    );
    expect(xFetchCalls).toBe(xCallsAfterFirstRequest); // unchanged

    // First request for Y — builds Y, X's fetch count must not increase
    const tocY = await handleMcpRequest(
      req(12, 'tools/call', { name: 'get_toc', arguments: { source: 'Docs Y', sourceDef: SOURCE_Y_DEF } }),
      state as unknown as Parameters<typeof handleMcpRequest>[1],
    );
    const resY = toolResult(tocY);
    expect(resY.source).toBe('Docs Y');
    expect(resY.pages).toHaveLength(1);
    expect(xFetchCalls).toBe(xCallsAfterFirstRequest); // X not rebuilt
    expect(yFetchCalls).toBeGreaterThan(0);            // Y was built
    expect((state.sources as Map<string, SourceIndex>).has('Docs Y')).toBe(true);
  });
});

// ─── Boundary 2: buildLocks thundering-herd prevention ───────────────────────

describe('boundary 2 — buildLocks thundering-herd prevention', () => {
  it('two concurrent get_toc requests for the same unindexed source share one buildIndex call and both resolve with the same pages', async () => {
    let sitemapFetchCount = 0;

    const onceFetch: FetchFn = async (url) => {
      if (url.endsWith('sitemap.xml')) {
        sitemapFetchCount++;
        return { html: SITEMAP_X, ok: true, status: 200 };
      }
      return { html: '<html><body><main><h1>X Intro</h1></main></body></html>', ok: true, status: 200 };
    };

    const state = makeStandbyState(onceFetch);

    const [r1, r2] = await Promise.all([
      handleMcpRequest(
        req(20, 'tools/call', { name: 'get_toc', arguments: { source: 'Docs X', sourceDef: SOURCE_X_DEF } }),
        state as unknown as Parameters<typeof handleMcpRequest>[1],
      ),
      handleMcpRequest(
        req(21, 'tools/call', { name: 'get_toc', arguments: { source: 'Docs X', sourceDef: SOURCE_X_DEF } }),
        state as unknown as Parameters<typeof handleMcpRequest>[1],
      ),
    ]);

    // Exactly one sitemap fetch means exactly one index build (not two)
    expect(sitemapFetchCount).toBe(1);

    // Both responses carry the same page data (both got the same SourceIndex)
    const res1 = toolResult(r1);
    const res2 = toolResult(r2);
    expect(res1.source).toBe('Docs X');
    expect(res2.source).toBe('Docs X');
    expect(res1.pages).toEqual(res2.pages);

    // Only one entry in the Map — no duplicate keys
    expect((state.sources as Map<string, SourceIndex>).size).toBe(1);
  });
});
