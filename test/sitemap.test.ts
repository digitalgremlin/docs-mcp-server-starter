import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSitemapXml, parseIndexPage, titleFromUrl, sectionFromUrl } from '../src/sitemap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf-8');

const BASE_URL = 'https://example.com/docs';

describe('parseSitemapXml — standard sitemap', () => {
  it('returns pages and isSitemapIndex=false', () => {
    const { pages, isSitemapIndex } = parseSitemapXml(fx('sitemap-simple.xml'), BASE_URL, 200);
    expect(isSitemapIndex).toBe(false);
    expect(pages).toHaveLength(3);
    expect(pages[0].url).toBe('https://example.com/docs/getting-started');
    expect(pages[1].url).toBe('https://example.com/docs/api/overview');
    expect(pages[2].url).toBe('https://example.com/docs/advanced');
  });

  it('excludes URLs not under baseUrl', () => {
    const { pages } = parseSitemapXml(fx('sitemap-simple.xml'), BASE_URL, 200);
    expect(pages.every((p) => p.url.startsWith(BASE_URL))).toBe(true);
  });

  it('deduplicates repeated URLs', () => {
    const { pages } = parseSitemapXml(fx('sitemap-dupes.xml'), BASE_URL, 200);
    const urls = pages.map((p) => p.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toHaveLength(3);
  });

  it('applies maxPages cap in sitemap order', () => {
    const { pages } = parseSitemapXml(fx('sitemap-simple.xml'), BASE_URL, 2);
    expect(pages).toHaveLength(2);
    expect(pages[0].url).toBe('https://example.com/docs/getting-started');
    expect(pages[1].url).toBe('https://example.com/docs/api/overview');
  });

  it('assigns title from last URL segment', () => {
    const { pages } = parseSitemapXml(fx('sitemap-simple.xml'), BASE_URL, 200);
    expect(pages[0].title).toBe('Getting Started');
    expect(pages[2].title).toBe('Advanced');
  });

  it('assigns section from first path segment after baseUrl when path has 2+ segments', () => {
    const { pages } = parseSitemapXml(fx('sitemap-simple.xml'), BASE_URL, 200);
    expect(pages[1].section).toBe('Api');
    expect(pages[0].section).toBeNull();
  });
});

describe('parseSitemapXml — sitemap index', () => {
  it('detects sitemap index and returns sitemapUrls', () => {
    const { isSitemapIndex, sitemapUrls, pages } = parseSitemapXml(fx('sitemap-index.xml'), BASE_URL, 200);
    expect(isSitemapIndex).toBe(true);
    expect(pages).toHaveLength(0);
    expect(sitemapUrls).toEqual([
      'https://example.com/sitemap-1.xml',
      'https://example.com/sitemap-2.xml',
    ]);
  });
});

describe('parseIndexPage', () => {
  it('extracts links under baseUrl as pages', () => {
    const pages = parseIndexPage(fx('index-page.html'), BASE_URL);
    const urls = pages.map((p) => p.url);
    expect(urls).toContain('https://example.com/docs/getting-started');
    expect(urls).toContain('https://example.com/docs/api/overview');
  });

  it('excludes external links', () => {
    const pages = parseIndexPage(fx('index-page.html'), BASE_URL);
    expect(pages.every((p) => p.url.startsWith(BASE_URL))).toBe(true);
  });

  it('deduplicates links', () => {
    const pages = parseIndexPage(fx('index-page.html'), BASE_URL);
    const urls = pages.map((p) => p.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('uses link text as title', () => {
    const pages = parseIndexPage(fx('index-page.html'), BASE_URL);
    const starter = pages.find((p) => p.url.includes('getting-started'));
    expect(starter?.title).toBe('Getting Started');
  });
});

describe('titleFromUrl', () => {
  it('converts last path segment to title case', () => {
    expect(titleFromUrl('https://example.com/docs/getting-started', BASE_URL)).toBe('Getting Started');
  });

  it('handles multi-segment path — uses last segment', () => {
    expect(titleFromUrl('https://example.com/docs/api/overview', BASE_URL)).toBe('Overview');
  });

  it('returns Index for bare base URL', () => {
    expect(titleFromUrl('https://example.com/docs/', BASE_URL)).toBe('Index');
  });
});

describe('sectionFromUrl', () => {
  it('returns first path segment after base for 2+ segment path', () => {
    expect(sectionFromUrl('https://example.com/docs/api/overview', BASE_URL)).toBe('Api');
  });

  it('returns null for single-segment path', () => {
    expect(sectionFromUrl('https://example.com/docs/getting-started', BASE_URL)).toBeNull();
  });

  it('returns null for bare base URL', () => {
    expect(sectionFromUrl('https://example.com/docs/', BASE_URL)).toBeNull();
  });
});
