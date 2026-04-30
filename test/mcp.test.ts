import { describe, it, expect } from 'vitest';
import { handleMcpRequest } from '../src/mcp.js';
import { LruCache } from '../src/cache.js';
import type { SourceIndex, CachedPage, FetchFn } from '../src/types.js';

const makeState = (sources: SourceIndex[] = [], fetchFn?: FetchFn) => ({
  sources,
  cache: new LruCache<string, CachedPage>(50),
  fetchFn: fetchFn ?? (async () => ({ html: '', ok: false, status: 500 })),
  markdownOutput: true,
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
