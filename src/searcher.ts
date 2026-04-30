import type { SourceIndex, SearchResult, CachedPage } from './types.js';
import type { LruCache } from './cache.js';

export function searchDocs(
  query: string,
  sources: SourceIndex[],
  cache: LruCache<string, CachedPage>,
  options: { maxResults: number; sourceFilter?: string },
): SearchResult[] {
  const q = query.toLowerCase();
  const titleMatches: Array<SearchResult & { _pos: number }> = [];
  const contentMatches: Array<SearchResult & { _pos: number }> = [];

  for (const source of sources) {
    if (options.sourceFilter && source.name !== options.sourceFilter) continue;

    for (const page of source.pages) {
      const lowerTitle = page.title.toLowerCase();
      const titlePos = lowerTitle.indexOf(q);

      if (titlePos !== -1) {
        titleMatches.push({
          title: page.title,
          url: page.url,
          source: source.name,
          snippet: page.title.slice(0, 300),
          matchType: 'title',
          _pos: titlePos,
        });
        continue;
      }

      const cached = cache.peek(page.url);
      if (cached) {
        const lowerContent = cached.content.toLowerCase();
        const contentPos = lowerContent.indexOf(q);
        if (contentPos !== -1) {
          contentMatches.push({
            title: page.title,
            url: page.url,
            source: source.name,
            snippet: cached.content.slice(0, 300),
            matchType: 'content',
            _pos: contentPos,
          });
        }
      }
    }
  }

  titleMatches.sort((a, b) => a._pos - b._pos);
  contentMatches.sort((a, b) => a._pos - b._pos);

  return [...titleMatches, ...contentMatches]
    .slice(0, options.maxResults)
    .map(({ _pos: _, ...r }) => r);
}
