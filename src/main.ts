import { Actor, log } from 'apify';
import http from 'node:http';
import type { ActorInput, CachedPage, FetchFn } from './types.js';
import { buildAllIndexes } from './indexer.js';
import { LruCache } from './cache.js';
import { handleMcpRequest, type ServerState } from './mcp.js';

async function fetchUrl(url: string): Promise<{ html: string; ok: boolean; status: number }> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'docs-mcp-server-starter/0.1 (Apify Actor)' },
  });
  const html = await response.text();
  return { html, ok: response.ok, status: response.status };
}

function validateInput(raw: unknown): ActorInput {
  const input = raw as ActorInput | null;
  if (!input?.sources?.length) throw new Error('Input must include at least one source.');
  if (input.sources.length > 10) throw new Error('sources: maximum 10 allowed.');
  for (const src of input.sources) {
    if (!src.name) throw new Error('Each source must have a name.');
    if (!src.template && (!src.url || !src.contentSelector)) {
      throw new Error(`Source "${src.name}": requires template OR (url + contentSelector).`);
    }
  }
  const maxPagesPerSource = input.maxPagesPerSource ?? 200;
  const cacheMaxPages = input.cacheMaxPages ?? 50;
  if (maxPagesPerSource < 1 || maxPagesPerSource > 500) throw new Error('maxPagesPerSource must be 1–500.');
  if (cacheMaxPages < 1 || cacheMaxPages > 200) throw new Error('cacheMaxPages must be 1–200.');
  return { ...input, maxPagesPerSource, cacheMaxPages, markdownOutput: input.markdownOutput ?? true };
}

await Actor.init();

try {
  const raw = await Actor.getInput();
  const input = validateInput(raw);

  log.info('Building source indexes…', { sources: input.sources.map((s) => s.name) });
  const fetchFn: FetchFn = fetchUrl;
  const sources = await buildAllIndexes(input.sources, fetchFn, input.maxPagesPerSource!);
  const totalPages = sources.reduce((n, s) => n + s.pages.length, 0);
  log.info('Indexes ready.', { totalPages, sourceCount: sources.length });

  const cache = new LruCache<string, CachedPage>(input.cacheMaxPages!);
  const state: ServerState = { sources, cache, fetchFn, markdownOutput: input.markdownOutput! };

  const port = parseInt(process.env['ACTOR_STANDBY_PORT'] ?? '4321', 10);

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain' }).end('Method Not Allowed');
      return;
    }
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const request = JSON.parse(body) as Parameters<typeof handleMcpRequest>[0];
        const response = await handleMcpRequest(request, state);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Bad Request');
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, () => log.info('MCP server listening.', { port }));
    server.on('error', reject);
    process.on('SIGTERM', () => server.close(() => resolve()));
  });
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  log.error('Actor failed.', { message });
  await Actor.fail(message);
}

await Actor.exit();
