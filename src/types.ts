export interface SourceConfig {
  name: string;
  template?: string | null;
  url?: string | null;
  sitemapUrl?: string | null;
  contentSelector?: string | null;
}

export interface ActorInput {
  sources?: SourceConfig[];
  maxPagesPerSource?: number;
  cacheMaxPages?: number;
  markdownOutput?: boolean;
}

// Alias used in MCP tool arguments for inline on-demand source definitions
export type SourceDef = SourceConfig;

export interface PageEntry {
  title: string;
  url: string;
  section: string | null;
}

export interface SourceIndex {
  name: string;
  url: string;
  contentSelector: string;
  pages: PageEntry[];
}

export interface CachedPage {
  url: string;
  title: string;
  source: string;
  content: string;
  cachedAt: string; // ISO 8601 — when first fetched and stored
}

export interface SearchResult {
  title: string;
  url: string;
  source: string;
  snippet: string;
  matchType: 'title' | 'content';
}

// Injected for testability — real impl uses built-in fetch, tests use fixtures
export type FetchFn = (url: string) => Promise<{ html: string; ok: boolean; status: number }>;
