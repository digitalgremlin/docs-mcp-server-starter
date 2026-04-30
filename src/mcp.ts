import type { SourceIndex, CachedPage, SearchResult, FetchFn } from './types.js';
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
  sources: SourceIndex[];
  cache: LruCache<string, CachedPage>;
  fetchFn: FetchFn;
  markdownOutput: boolean;
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

async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  state: ServerState,
): Promise<unknown> {
  switch (name) {
    case 'list_sources':
      return {
        sources: state.sources.map((s) => ({ name: s.name, url: s.url, pageCount: s.pages.length })),
      };

    case 'get_toc': {
      const source = state.sources.find((s) => s.name === (args['source'] as string));
      if (!source) return { error: `Source not found: "${args['source'] as string}"` };
      return { source: source.name, pages: source.pages };
    }

    case 'search_docs': {
      const query = args['query'] as string;
      if (query.length > 500) return { error: 'query must be <= 500 characters' };
      const sourceFilter = typeof args['source'] === 'string' ? args['source'] : undefined;
      const maxResults = Math.min(
        typeof args['maxResults'] === 'number' ? Math.max(1, Math.floor(args['maxResults'])) : 10,
        30,
      );
      const results: SearchResult[] = searchDocs(query, state.sources, state.cache, { maxResults, sourceFilter });
      return { query, source: sourceFilter ?? null, results };
    }

    case 'get_page': {
      const url = args['url'] as string;

      const cached = state.cache.get(url);
      if (cached) {
        return { url: cached.url, title: cached.title, source: cached.source, content: cached.content, cachedAt: cached.cachedAt };
      }

      const sourceIndex = state.sources.find((s) => s.pages.some((p) => p.url === url));
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
