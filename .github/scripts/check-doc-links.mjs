// Checks that relative links in tracked Markdown files point to files that exist.
// It makes no network calls. External links are not checked.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const files = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const link = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const broken = [];
for (const file of files) {
  const text = (await readFile(file, 'utf8')).replace(/```[\s\S]*?```/g, '');
  for (const [, target] of text.matchAll(link)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
    const relative = decodeURIComponent(target.split('#')[0]);
    if (!existsSync(path.join(path.dirname(file), relative))) broken.push(`${file}: ${target}`);
  }
}
if (broken.length > 0) {
  console.error(`Broken relative links:\n${broken.join('\n')}`);
  process.exit(1);
}
console.log(`Checked relative links in ${files.length} Markdown files.`);
