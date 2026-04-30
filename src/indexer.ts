import type { SourceConfig, SourceIndex, PageEntry, FetchFn } from './types.js';
import { resolveTemplate } from './templates.js';
import { parseSitemapXml, parseIndexPage } from './sitemap.js';

interface ResolvedConfig {
  name: string;
  url: string;
  sitemapUrl: string | null;
  contentSelector: string;
}

function resolveConfig(config: SourceConfig): ResolvedConfig {
  if (config.template) {
    const tmpl = resolveTemplate(config.template);
    if (!tmpl) throw new Error(`Unknown template: "${config.template}"`);
    return {
      name: config.name,
      url: tmpl.url,
      sitemapUrl: config.sitemapUrl ?? tmpl.sitemapUrl,
      contentSelector: tmpl.contentSelector,
    };
  }
  if (!config.url || !config.contentSelector) {
    throw new Error(`Source "${config.name}" requires url and contentSelector when no template is given`);
  }
  return {
    name: config.name,
    url: config.url.replace(/\/$/, ''),
    sitemapUrl: config.sitemapUrl ?? null,
    contentSelector: config.contentSelector,
  };
}

async function discoverAndFetchSitemapXml(
  resolved: ResolvedConfig,
  fetchFn: FetchFn,
): Promise<string | null> {
  const base = resolved.url.replace(/\/$/, '');
  const candidates = [
    resolved.sitemapUrl,
    `${base}/sitemap.xml`,
    `${base}/sitemap_index.xml`,
  ].filter(Boolean) as string[];

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const result = await fetchFn(candidate);
    if (result.ok) return result.html;
  }
  return null;
}

export async function buildSourceIndex(
  config: SourceConfig,
  fetchFn: FetchFn,
  maxPages: number,
): Promise<SourceIndex> {
  const resolved = resolveConfig(config);
  const sitemapXml = await discoverAndFetchSitemapXml(resolved, fetchFn);
  let pages: PageEntry[];

  if (sitemapXml) {
    const parsed = parseSitemapXml(sitemapXml, resolved.url, maxPages);
    if (parsed.isSitemapIndex) {
      const allPages: PageEntry[] = [];
      for (const sitemapUrl of parsed.sitemapUrls) {
        if (allPages.length >= maxPages) break;
        const subResult = await fetchFn(sitemapUrl);
        if (subResult.ok) {
          const sub = parseSitemapXml(subResult.html, resolved.url, maxPages - allPages.length);
          allPages.push(...sub.pages);
        }
      }
      pages = allPages.slice(0, maxPages);
    } else {
      pages = parsed.pages;
    }
  } else {
    const result = await fetchFn(resolved.url);
    pages = result.ok
      ? parseIndexPage(result.html, resolved.url).slice(0, maxPages)
      : [];
  }

  return { name: resolved.name, url: resolved.url, contentSelector: resolved.contentSelector, pages };
}

export async function buildAllIndexes(
  sources: SourceConfig[],
  fetchFn: FetchFn,
  maxPages: number,
): Promise<SourceIndex[]> {
  return Promise.all(sources.map((s) => buildSourceIndex(s, fetchFn, maxPages)));
}
