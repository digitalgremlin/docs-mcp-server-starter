import type { SourceIndex, CachedPage, SearchResult, FetchFn, SourceDef } from './types.js';
import { buildSourceIndex } from './indexer.js';
import type { LruCache } from './cache.js';
import { extractContent } from './extractor.js';
import { searchDocs } from './searcher.js';

interface McpRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface McpResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface ServerState {
  sources: Map<string, SourceIndex>;
  cache: LruCache<string, CachedPage>;
  fetchFn: FetchFn;
  markdownOutput: boolean;
  maxPagesPerSource: number;
  buildLocks: Map<string, Promise<SourceIndex>>;
}

const TOOLS = [
  {
    name: 'list_sources',
    description: 'Return the configured documentation sources with page counts.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_toc',
    description: 'Return the table of contents (page index) for a source.',
    inputSchema: {
      type: 'object',
      properties: { source: { type: 'string', description: 'Source name' } },
      required: ['source'],
    },
  },
  {
    name: 'search_docs',
    description: 'Case-insensitive keyword search across page titles and cached content.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (1–500 chars)' },
        source: { type: 'string', description: 'Restrict to a specific source name' },
        maxResults: { type: 'number', description: 'Max results to return (default 10, max 30)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_page',
    description: 'Fetch full content of a documentation page. Checks cache first.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Page URL from a configured source index' } },
      required: ['url'],
    },
  },
];

export async function handleMcpRequest(request: McpRequest, state: ServerState): Promise<McpResponse> {
  const { id, method, params = {} } = request;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'docs-mcp-server', version: '1.0.0' },
      },
    };
  }

  if (method === 'notifications/initialized') {
    return { jsonrpc: '2.0', id, result: null };
  }

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }

  if (method === 'tools/call') {
    const toolName = params['name'];
    if (typeof toolName !== 'string' || !toolName) {
      return protocolError(id, -32602, 'Missing required field: name');
    }

    const args = (params['arguments'] ?? {}) as Record<string, unknown>;

    if (toolName === 'get_toc') {
      if (typeof args['source'] !== 'string' || !args['source']) {
        return protocolError(id, -32602, 'Missing required field: source');
      }
    }
    if (toolName === 'search_docs') {
      if (typeof args['query'] !== 'string' || !args['query']) {
        return protocolError(id, -32602, 'Missing required field: query');
      }
    }
    if (toolName === 'get_page') {
      if (typeof args['url'] !== 'string' || !args['url']) {
        return protocolError(id, -32602, 'Missing required field: url');
      }
    }

    const toolResult = await dispatchTool(toolName, args, state);
    return {
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: JSON.stringify(toolResult) }] },
    };
  }

  return protocolError(id, -32601, `Method not found: ${method}`);
}

function protocolError(id: McpRequest['id'], code: number, message: string): McpResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// Ensures a source is indexed. Returns immediately if already in the Map.
// Concurrent callers for the same unindexed source share one in-flight build
// promise via buildLocks, preventing duplicate network fetches. The lock is
// deleted on both resolve and reject so a failed build can be retried.
async function ensureIndexed(state: ServerState, sourceDef: SourceDef): Promise<SourceIndex> {
  const existing = state.sources.get(sourceDef.name);
  if (existing) return existing;

  const inflight = state.buildLocks.get(sourceDef.name);
  if (inflight) return inflight;

  const buildPromise = buildSourceIndex(sourceDef, state.fetchFn, state.maxPagesPerSource)
    .then((index) => {
      state.sources.set(index.name, index);
      state.buildLocks.delete(index.name);
      return index;
    })
    .catch((err: unknown) => {
      state.buildLocks.delete(sourceDef.name);
      throw err;
    });

  state.buildLocks.set(sourceDef.name, buildPromise);
  return buildPromise;
}

async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  state: ServerState,
): Promise<unknown> {
  const sourceDef = args['sourceDef'] as SourceDef | undefined;

  switch (name) {
    case 'list_sources':
      return {
        sources: Array.from(state.sources.values()).map((s) => ({
          name: s.name,
          url: s.url,
          pageCount: s.pages.length,
        })),
      };

    case 'get_toc': {
      const sourceName = args['source'] as string;
      if (sourceDef) {
        try {
          await ensureIndexed(state, sourceDef);
        } catch (e) {
          return { error: `Failed to build index for "${sourceDef.name}": ${e instanceof Error ? e.message : String(e)}` };
        }
      }
      const source = state.sources.get(sourceName);
      if (!source) {
        return {
          error: `Source not indexed: "${sourceName}". Pass sourceDef to index it on demand.`,
        };
      }
      return { source: source.name, pages: source.pages };
    }

    case 'search_docs': {
      const query = args['query'] as string;
      if (query.length > 500) return { error: 'query must be <= 500 characters' };
      if (sourceDef) {
        try {
          await ensureIndexed(state, sourceDef);
        } catch (e) {
          return { error: `Failed to build index for "${sourceDef.name}": ${e instanceof Error ? e.message : String(e)}` };
        }
      }
      const sourceFilter = typeof args['source'] === 'string' ? args['source'] : undefined;
      const maxResults = Math.min(
        typeof args['maxResults'] === 'number' ? Math.max(1, Math.floor(args['maxResults'])) : 10,
        30,
      );
      const results: SearchResult[] = searchDocs(
        query,
        Array.from(state.sources.values()),
        state.cache,
        { maxResults, sourceFilter },
      );
      return { query, source: sourceFilter ?? null, results };
    }

    case 'get_page': {
      const url = args['url'] as string;

      if (sourceDef) {
        try {
          await ensureIndexed(state, sourceDef);
        } catch (e) {
          return { error: `Failed to build index for "${sourceDef.name}": ${e instanceof Error ? e.message : String(e)}` };
        }
      }

      const cached = state.cache.get(url);
      if (cached) {
        return { url: cached.url, title: cached.title, source: cached.source, content: cached.content, cachedAt: cached.cachedAt };
      }

      const sourceIndex = Array.from(state.sources.values()).find((s) =>
        s.pages.some((p) => p.url === url),
      );
      if (!sourceIndex) return { error: 'URL not found in any configured source index' };

      const page = sourceIndex.pages.find((p) => p.url === url)!;
      const fetchResult = await state.fetchFn(url);
      if (!fetchResult.ok) {
        return { error: `Failed to fetch page: HTTP ${fetchResult.status}`, url };
      }

      const content = extractContent(fetchResult.html, sourceIndex.contentSelector, state.markdownOutput);
      const cachedPage: CachedPage = {
        url,
        title: page.title,
        source: sourceIndex.name,
        content,
        cachedAt: new Date().toISOString(),
      };
      state.cache.set(url, cachedPage);

      return { url, title: cachedPage.title, source: cachedPage.source, content: cachedPage.content, cachedAt: null };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
