import * as cheerio from 'cheerio';
import type { PageEntry } from './types.js';

export function parseSitemapXml(
  xml: string,
  baseUrl: string,
  maxPages: number,
): { pages: PageEntry[]; isSitemapIndex: boolean; sitemapUrls: string[] } {
  const $ = cheerio.load(xml, { xmlMode: true });

  if ($('sitemapindex').length > 0) {
    const sitemapUrls: string[] = [];
    $('sitemapindex sitemap loc').each((_, el) => {
      sitemapUrls.push($(el).text().trim());
    });
    return { pages: [], isSitemapIndex: true, sitemapUrls };
  }

  const seen = new Set<string>();
  const pages: PageEntry[] = [];
  const normalizedBase = baseUrl.replace(/\/$/, '');

  $('urlset url loc').each((_, el) => {
    if (pages.length >= maxPages) return false as unknown as void;

    const url = $(el).text().trim();
    if (!url.startsWith(normalizedBase) || seen.has(url)) return;

    seen.add(url);
    pages.push({
      url,
      title: titleFromUrl(url, normalizedBase),
      section: sectionFromUrl(url, normalizedBase),
    });
  });

  return { pages, isSitemapIndex: false, sitemapUrls: [] };
}

export function parseIndexPage(html: string, baseUrl: string): PageEntry[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const pages: PageEntry[] = [];
  const normalizedBase = baseUrl.replace(/\/$/, '');

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const text = $(el).text().trim();

    let url: string;
    try {
      url = new URL(href, baseUrl).toString().replace(/\/$/, '');
    } catch {
      return;
    }

    if (!url.startsWith(normalizedBase) || seen.has(url) || url === normalizedBase) return;

    seen.add(url);
    pages.push({
      url,
      title: text || titleFromUrl(url, normalizedBase),
      section: sectionFromUrl(url, normalizedBase),
    });
  });

  return pages;
}

export function titleFromUrl(url: string, baseUrl: string): string {
  const normalizedBase = baseUrl.replace(/\/$/, '');
  const path = url.replace(normalizedBase, '').replace(/^\/+/, '').replace(/\/+$/, '');
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 0) return 'Index';

  const last = segments[segments.length - 1];
  return last.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function sectionFromUrl(url: string, baseUrl: string): string | null {
  const normalizedBase = baseUrl.replace(/\/$/, '');
  const path = url.replace(normalizedBase, '').replace(/^\/+/, '').replace(/\/+$/, '');
  const segments = path.split('/').filter(Boolean);

  if (segments.length < 2) return null;

  return segments[0].replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}
