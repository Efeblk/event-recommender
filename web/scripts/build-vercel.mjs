import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '.vercel', 'output');
if (relative(root, output) !== join('.vercel', 'output'))
  throw new Error('Refusing to write outside the web project.');

await exec(process.execPath, [join(root, 'scripts', 'build-node.mjs')], {
  cwd: root,
  env: { ...process.env, EVENT_REC_RUNTIME: 'node' },
  maxBuffer: 16 * 1024 * 1024,
}).then(({ stdout, stderr }) => {
  process.stdout.write(stdout);
  process.stderr.write(stderr);
});

const standalone = join(root, 'dist-node');
await readFile(join(standalone, 'server.js'));
await rm(output, {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 200,
});

const staticOutput = join(output, 'static');
const functionOutput = join(output, 'functions', 'server.func');
await mkdir(staticOutput, { recursive: true });
await mkdir(functionOutput, { recursive: true });
await cp(join(standalone, 'dist', 'client'), staticOutput, { recursive: true });
await cp(join(standalone, 'public'), staticOutput, {
  recursive: true,
  force: true,
});
await cp(standalone, join(functionOutput, 'standalone'), { recursive: true });
await cp(
  join(root, 'scripts', 'vercel-handler.mjs'),
  join(functionOutput, 'index.mjs'),
);

await writeFile(
  join(functionOutput, '.vc-config.json'),
  `${JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      maxDuration: 60,
    },
    null,
    2,
  )}\n`,
);
await writeFile(
  join(output, 'config.json'),
  `${JSON.stringify(
    {
      version: 3,
      routes: [
        {
          src: '/_next/static/(.*)',
          headers: {
            'cache-control': 'public, max-age=31536000, immutable',
          },
          continue: true,
        },
        { handle: 'filesystem' },
        { src: '/(.*)', dest: '/server?__event_rec_path=/$1' },
      ],
    },
    null,
    2,
  )}\n`,
);

console.log(`Vercel Build Output API v3: ${relative(root, output)}`);
