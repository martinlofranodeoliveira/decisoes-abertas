import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const checks = [];
async function checkFiles(directory) {
  for (const item of await readdir(directory)) {
    if (['.git', 'node_modules', '.impeccable'].includes(item)) continue;
    const p = path.join(directory, item), info = await lstat(p);
    if (info.isSymbolicLink()) throw Error('Link simbólico fora do contrato de publicação.');
    if (info.isDirectory()) { await checkFiles(p); continue; }
    if (/^\.env|\.(?:pem|key|sqlite|db)$/.test(item)) throw Error('Arquivo privado ou operacional encontrado.');
    if (!/\.(?:html|mjs|js|css|json|md|yml|svg)$/.test(item)) continue;
    const text = await readFile(p, 'utf8');
    if (/(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}|(?:appgprj_|appgdep_)[a-z0-9]{15,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) throw Error('Possível credencial ou identidade de hosting em arquivo público: ' + path.relative(root, p));
    checks.push(path.relative(root, p));
  }
}
await checkFiles(root);
const html = await readFile(path.join(root, 'dist/index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)) {
  const url = match[1]; if (/^https?:/.test(url)) continue;
  const local = url.split(/[?#]/)[0]; if (!local || local === './') continue;
  await lstat(path.join(root, 'dist', local));
}
if (!html.includes("connect-src 'none'") || !html.includes('seed 23abf336')) throw Error('Política de conteúdo ou contrato visual ausente.');
console.log(JSON.stringify({ status: 'pass', textFiles: checks.length, staticConnectPolicy: "none", dependenciesBundled: 0 }));
