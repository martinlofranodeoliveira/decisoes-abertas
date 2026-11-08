import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const folder of ['assets']) await cp(path.join(root, folder), path.join(dist, folder), { recursive: true });
let html = await readFile(path.join(root, 'index.html'), 'utf8');
if (process.env.SITE_URL) {
  const url = new URL(process.env.SITE_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('SITE_URL precisa ser uma URL HTTPS pública.');
  const safe = url.href.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  html = html.replace('</head>', `<link rel="canonical" href="${safe}"></head>`);
}
await writeFile(path.join(dist, 'index.html'), html);
await writeFile(path.join(dist, '.nojekyll'), '');
await writeFile(path.join(dist, 'robots.txt'), 'User-agent: *\nAllow: /\n');
console.log(JSON.stringify({ status: 'built', directory: 'dist', runtimeDependencies: 0, providerRequests: 0 }));
