import { request as proxyRequest } from 'node:http';
import { join } from 'node:path';
import { startProdServer } from './standalone/node_modules/vinext/dist/server/prod-server.js';

const server = startProdServer({
  host: '127.0.0.1',
  port: 0,
  outDir: join(import.meta.dirname, 'standalone', 'dist'),
  silent: true,
});

/** Test cleanup only. Vercel keeps the server for the warm instance. */
export async function closeServer() {
  const started = await server;
  await new Promise((resolve, reject) =>
    started.server.close((error) => (error ? reject(error) : resolve())),
  );
}

function applicationPath(requestUrl) {
  const url = new URL(requestUrl ?? '/', 'http://event-rec.local');
  const routedPath = url.searchParams.get('__event_rec_path');
  if (!routedPath) return requestUrl ?? '/';
  url.searchParams.delete('__event_rec_path');
  return `${routedPath}${url.search}`;
}

/** Proxy bytes to vinext's proven Node handler. Both directions stay streamed. */
export default async function handler(request, response) {
  const started = await server;
  await new Promise((resolve, reject) => {
    const headers = { ...request.headers };
    delete headers.connection;
    delete headers['proxy-connection'];
    const upstream = proxyRequest(
      {
        host: '127.0.0.1',
        port: started.port,
        method: request.method,
        path: applicationPath(request.url),
        headers,
      },
      (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.statusMessage,
          upstreamResponse.headers,
        );
        upstreamResponse.on('error', reject);
        upstreamResponse.pipe(response);
        upstreamResponse.on('end', resolve);
      },
    );
    upstream.on('error', reject);
    request.on('aborted', () => upstream.destroy());
    request.pipe(upstream);
  }).catch((error) => {
    if (!response.headersSent)
      response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    if (!response.writableEnded)
      response.end('Application server unavailable.');
    throw error;
  });
}
