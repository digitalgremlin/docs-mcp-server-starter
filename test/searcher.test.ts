import { describe, it, expect } from 'vitest';
import { searchDocs } from '../src/searcher.js';
import { LruCache } from '../src/cache.js';
import type { SourceIndex, CachedPage } from '../src/types.js';

const sourceA: SourceIndex = {
  name: 'DocsA',
  url: 'https://a.com/docs',
  contentSelector: 'main',
  pages: [
    { url: 'https://a.com/docs/installation', title: 'Installation Guide', section: null },
    { url: 'https://a.com/docs/api', title: 'API Reference', section: null },
    { url: 'https://a.com/docs/config', title: 'Configuration', section: null },
  ],
};

const sourceB: SourceIndex = {
  name: 'DocsB',
  url: 'https://b.com/docs',
  contentSelector: 'article',
  pages: [
    { url: 'https://b.com/docs/guide', title: 'Getting Started', section: null },
    { url: 'https://b.com/docs/api', title: 'API Docs', section: null },
  ],
};

const emptyCache = () => new LruCache<string, CachedPage>(10);

describe('searchDocs — title matching', () => {
  it('returns results matching query in title', () => {
    const results = searchDocs('api', [sourceA, sourceB], emptyCache(), { maxResults: 10 });
    expect(results.length).toBe(2);
    expect(results.every(r => r.matchType === 'title')).toBe(true);
  });

  it('is case-insensitive', () => {
    const results = searchDocs('INSTALLATION', [sourceA], emptyCache(), { maxResults: 10 });
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Installation Guide');
  });

  it('returns empty array when no matches', () => {
    const results = searchDocs('zzznotfound', [sourceA, sourceB], emptyCache(), { maxResults: 10 });
    expect(results).toHaveLength(0);
  });

  it('filters by sourceFilter', () => {
    const results = searchDocs('api', [sourceA, sourceB], emptyCache(), { maxResults: 10, sourceFilter: 'DocsA' });
    expect(results.every(r => r.source === 'DocsA')).toBe(true);
    expect(results).toHaveLength(1);
  });

  it('ranks by match position ascending within title matches', () => {
    const results = searchDocs('guide', [sourceA, sourceB], emptyCache(), { maxResults: 10 });
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Installation Guide');
  });

  it('respects maxResults', () => {
    const results = searchDocs('a', [sourceA, sourceB], emptyCache(), { maxResults: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

describe('searchDocs — content matching', () => {
  it('returns content match when title does not match but cached content does', () => {
    const cache = emptyCache();
    cache.set('https://a.com/docs/config', {
      url: 'https://a.com/docs/config',
      title: 'Configuration',
      source: 'DocsA',
      content: 'Set the api key and token here.',
      cachedAt: '2026-01-01T00:00:00.000Z',
    });
    const results = searchDocs('api', [sourceA], cache, { maxResults: 10 });
    const contentResult = results.find(r => r.url === 'https://a.com/docs/config');
    expect(contentResult?.matchType).toBe('content');
  });

  it('title matches rank above content matches', () => {
    const cache = emptyCache();
    cache.set('https://a.com/docs/config', {
      url: 'https://a.com/docs/config',
      title: 'Configuration',
      source: 'DocsA',
      content: 'api usage and setup',
      cachedAt: '2026-01-01T00:00:00.000Z',
    });
    const results = searchDocs('api', [sourceA], cache, { maxResults: 10 });
    const firstTitle = results.findIndex(r => r.matchType === 'title');
    const firstContent = results.findIndex(r => r.matchType === 'content');
    expect(firstTitle).toBeLessThan(firstContent);
  });

  it('snippet truncates at exactly 300 characters', () => {
    const cache = emptyCache();
    const longContent = 'api documentation: ' + 'x'.repeat(400);
    cache.set('https://b.com/docs/guide', {
      url: 'https://b.com/docs/guide',
      title: 'Getting Started',
      source: 'DocsB',
      content: longContent,
      cachedAt: '2026-01-01T00:00:00.000Z',
    });
    const results = searchDocs('api', [sourceB], cache, { maxResults: 10 });
    const match = results.find(r => r.matchType === 'content');
    expect(match).toBeDefined();
    expect(match!.snippet.length).toBe(300);
  });

  it('search does not trigger a fetch — peek does not affect cache order', () => {
    const cache = new LruCache<string, CachedPage>(2);
    const makePage = (url: string, content: string): CachedPage => ({
      url, title: 'T', source: 'S', content, cachedAt: '2026-01-01T00:00:00.000Z',
    });
    cache.set('https://a.com/docs/installation', makePage('https://a.com/docs/installation', 'api details'));
    cache.set('https://a.com/docs/api', makePage('https://a.com/docs/api', 'api reference'));

    searchDocs('api', [sourceA], cache, { maxResults: 10 });

    cache.set('https://a.com/docs/config', makePage('https://a.com/docs/config', 'x'));

    expect(cache.has('https://a.com/docs/installation')).toBe(false);
  });
});
