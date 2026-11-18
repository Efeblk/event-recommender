import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.EVENT_REC_CATALOG = 'bundled';
process.env.DEPLOYMENT_ENV = 'production';
process.env.VERCEL = '1';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, '.vercel', 'output');
const { default: handler, closeServer } = await import(
  new URL('../.vercel/output/functions/server.func/index.mjs', import.meta.url)
);
const types = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(
    new URL(request.url ?? '/', 'http://local').pathname,
  );
  const relative = normalize(pathname).replace(/^[/\\]+/, '');
  const file = join(output, 'static', relative);
  if (file.startsWith(join(output, 'static'))) {
    const metadata = await stat(file).catch(() => null);
    if (metadata?.isFile()) {
      response.writeHead(200, {
        'content-type': types[extname(file)] ?? 'application/octet-stream',
      });
      createReadStream(file).pipe(response);
      return;
    }
  }
  const routed = new URL('/server', 'http://local');
  routed.searchParams.set('__event_rec_path', pathname);
  const incoming = new URL(request.url ?? '/', 'http://local');
  for (const [key, value] of incoming.searchParams)
    routed.searchParams.append(key, value);
  request.url = `${routed.pathname}${routed.search}`;
  await handler(request, response);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string')
  throw new Error('Smoke server failed.');
const origin = `http://127.0.0.1:${address.port}`;

try {
  const health = await fetch(`${origin}/api/health`);
  if (health.status !== 200)
    throw new Error(`health returned ${health.status}`);
  const ready = await fetch(`${origin}/api/ready`);
  const readiness = await ready.json();
  if (
    ready.status !== 200 ||
    readiness.ready !== true ||
    readiness.source !== 'bundled'
  )
    throw new Error(`ready returned ${ready.status}`);
  const events = await fetch(`${origin}/api/events`);
  const catalog = await events.json();
  if (
    events.status !== 200 ||
    !Array.isArray(catalog.events) ||
    !catalog.events.length
  )
    throw new Error(`events returned ${events.status}`);
  const home = await fetch(origin);
  const html = await home.text();
  if (home.status !== 200 || !html.toLowerCase().includes('<!doctype html'))
    throw new Error(`home returned ${home.status}`);
  const asset = html.match(/(?:src|href)="(\/_next\/static\/[^"?]+)["?]/)?.[1];
  if (!asset) throw new Error('home has no static asset');
  const staticResponse = await fetch(`${origin}${asset}`);
  if (staticResponse.status !== 200)
    throw new Error(`static asset returned ${staticResponse.status}`);
  console.log(
    `Vercel smoke passed: health, ready, ${catalog.events.length} cards, home, static asset.`,
  );
} finally {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await closeServer();
}
