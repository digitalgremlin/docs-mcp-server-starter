import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSourceIndex } from '../src/indexer.js';
import type { FetchFn } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf-8');

const makeFetch = (routes: Record<string, string>): FetchFn =>
  async (url) => {
    const html = routes[url];
    return html !== undefined
      ? { html, ok: true, status: 200 }
      : { html: '', ok: false, status: 404 };
  };

describe('buildSourceIndex', () => {
  it('builds index from explicit sitemapUrl', async () => {
    const fetch = makeFetch({
      'https://example.com/docs/sitemap.xml': fx('sitemap-simple.xml'),
    });
    const index = await buildSourceIndex(
      { name: 'Test', url: 'https://example.com/docs', sitemapUrl: 'https://example.com/docs/sitemap.xml', contentSelector: 'main' },
      fetch,
      200,
    );
    expect(index.name).toBe('Test');
    expect(index.pages.length).toBe(3);
    expect(index.pages[0].url).toBe('https://example.com/docs/getting-started');
  });

  it('falls back to /sitemap.xml when no explicit sitemapUrl', async () => {
    const fetch = makeFetch({
      'https://example.com/docs/sitemap.xml': fx('sitemap-simple.xml'),
    });
    const index = await buildSourceIndex(
      { name: 'Test', url: 'https://example.com/docs', contentSelector: 'main' },
      fetch,
      200,
    );
    expect(index.pages.length).toBe(3);
  });

  it('falls back to /sitemap_index.xml when /sitemap.xml returns 404', async () => {
    const fetch = makeFetch({
      'https://example.com/docs/sitemap_index.xml': fx('sitemap-index.xml'),
      'https://example.com/sitemap-1.xml': fx('sitemap-simple.xml'),
      'https://example.com/sitemap-2.xml': fx('sitemap-dupes.xml'),
    });
    const index = await buildSourceIndex(
      { name: 'Test', url: 'https://example.com/docs', contentSelector: 'main' },
      fetch,
      200,
    );
    expect(index.pages.length).toBeGreaterThan(0);
  });

  it('falls back to index page scraping when all sitemaps 404', async () => {
    const fetch = makeFetch({
      'https://example.com/docs': fx('index-page.html'),
    });
    const index = await buildSourceIndex(
      { name: 'Test', url: 'https://example.com/docs', contentSelector: 'main' },
      fetch,
      200,
    );
    expect(index.pages.length).toBeGreaterThan(0);
    expect(index.pages[0].url).toContain('getting-started');
  });

  it('applies maxPages cap', async () => {
    const fetch = makeFetch({
      'https://example.com/docs/sitemap.xml': fx('sitemap-simple.xml'),
    });
    const index = await buildSourceIndex(
      { name: 'Test', url: 'https://example.com/docs', contentSelector: 'main' },
      fetch,
      2,
    );
    expect(index.pages.length).toBe(2);
  });

  it('resolves template by id when template field is set', async () => {
    const fetch = makeFetch({});
    const index = await buildSourceIndex(
      { name: 'Next.js', template: 'nextjs' },
      fetch,
      200,
    );
    expect(index.url).toBe('https://nextjs.org/docs');
    expect(index.contentSelector).toBe('article');
  });

  it('throws when no template and no url provided', async () => {
    await expect(
      buildSourceIndex({ name: 'Bad' }, async () => ({ html: '', ok: false, status: 404 }), 200),
    ).rejects.toThrow();
  });
});
