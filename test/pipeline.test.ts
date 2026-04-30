import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSourceIndex } from '../src/indexer.js';
import { handleMcpRequest, type ServerState } from '../src/mcp.js';
import { LruCache } from '../src/cache.js';
import type { CachedPage, FetchFn } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf-8');

const PAGE_URL = 'https://example.com/docs/getting-started';
const CONTENT_HTML = fx('content-page.html');

const fixtureFetch: FetchFn = async (url) => {
  if (url.endsWith('sitemap.xml')) return { html: fx('sitemap-simple.xml'), ok: true, status: 200 };
  if (url === PAGE_URL) return { html: CONTENT_HTML, ok: true, status: 200 };
  return { html: '', ok: false, status: 404 };
};

const req = (id: number, method: string, params?: Record<string, unknown>) =>
  ({ jsonrpc: '2.0' as const, id, method, params });

const toolResult = (r: Awaited<ReturnType<typeof handleMcpRequest>>) =>
  JSON.parse((r.result as { content: Array<{ text: string }> }).content[0].text);

describe('pipeline integration', () => {
  it('builds index from sitemap fixture and get_toc returns correct pages', async () => {
    const source = await buildSourceIndex(
      { name: 'Test Docs', url: 'https://example.com/docs', contentSelector: 'main.content' },
      fixtureFetch,
      200,
    );
    expect(source.pages[0].url).toBe(PAGE_URL);
    expect(source.pages[0].title).toBe('Getting Started');

    const state: ServerState = {
      sources: [source],
      cache: new LruCache<string, CachedPage>(50),
      fetchFn: fixtureFetch,
      markdownOutput: true,
    };

    const tocR = await handleMcpRequest(req(1, 'tools/call', { name: 'get_toc', arguments: { source: 'Test Docs' } }), state);
    const toc = toolResult(tocR);
    expect(toc.source).toBe('Test Docs');
    expect(toc.pages[0].url).toBe(PAGE_URL);
  });

  it('get_page fetches content, extracts markdown, returns cachedAt=null', async () => {
    const source = await buildSourceIndex(
      { name: 'Test Docs', url: 'https://example.com/docs', contentSelector: 'main.content' },
      fixtureFetch,
      200,
    );
    const state: ServerState = {
      sources: [source],
      cache: new LruCache<string, CachedPage>(50),
      fetchFn: fixtureFetch,
      markdownOutput: true,
    };

    const r = await handleMcpRequest(req(1, 'tools/call', { name: 'get_page', arguments: { url: PAGE_URL } }), state);
    const result = toolResult(r);

    expect(result.url).toBe(PAGE_URL);
    expect(result.title).toBe('Getting Started');
    expect(result.source).toBe('Test Docs');
    expect(result.content).toMatch(/# Getting Started/);
    expect(result.content).not.toContain('Site Header');
    expect(result.content).not.toContain('Inner Navigation');
    expect(result.cachedAt).toBeNull();
  });

  it('get_page returns cachedAt timestamp on second call', async () => {
    const source = await buildSourceIndex(
      { name: 'Test Docs', url: 'https://example.com/docs', contentSelector: 'main.content' },
      fixtureFetch,
      200,
    );
    const state: ServerState = {
      sources: [source],
      cache: new LruCache<string, CachedPage>(50),
      fetchFn: fixtureFetch,
      markdownOutput: true,
    };

    await handleMcpRequest(req(1, 'tools/call', { name: 'get_page', arguments: { url: PAGE_URL } }), state);
    const r2 = await handleMcpRequest(req(2, 'tools/call', { name: 'get_page', arguments: { url: PAGE_URL } }), state);
    const result = toolResult(r2);

    expect(result.cachedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('search_docs finds page by title after index build', async () => {
    const source = await buildSourceIndex(
      { name: 'Test Docs', url: 'https://example.com/docs', contentSelector: 'main.content' },
      fixtureFetch,
      200,
    );
    const state: ServerState = {
      sources: [source],
      cache: new LruCache<string, CachedPage>(50),
      fetchFn: fixtureFetch,
      markdownOutput: true,
    };

    const r = await handleMcpRequest(req(1, 'tools/call', { name: 'search_docs', arguments: { query: 'getting' } }), state);
    const result = toolResult(r);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].matchType).toBe('title');
    expect(result.results[0].url).toBe(PAGE_URL);
  });
});
