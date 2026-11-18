import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { sourceFiles } from './source-files.mjs';
const patterns = [ /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\b(?:sb_secret|sk_live|sk_proj)_[A-Za-z0-9_-]{15,}/, /\bAKIA[0-9A-Z]{16}\b/, /eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/, /postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/ ];
let count = 0;
for (const path of await sourceFiles()) {
  if (!/\.(?:ts|tsx|js|mjs|cjs|json|md|sql|toml|swift|plist|env|example|sh)$/.test(path)) continue;
  const value = await readFile(path, 'utf8');
  if (patterns.some(p => p.test(value))) { console.error(`Potential credential in ${path}; value withheld.`); count++; }
}
let bundleFiles = 0;
async function scanBundle(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch (e) { if (e.code === 'ENOENT') return; throw e; }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await scanBundle(path);
    else {
      bundleFiles++;
      const value = (await readFile(path)).toString('utf8');
      if (patterns.some(p => p.test(value))) { console.error(`Potential credential in exported asset ${path}; value withheld.`); count++; }
    }
  }
}
await scanBundle('.cache/ios-export');
await scanBundle('.cache/DerivedData/Build/Products/Debug-iphonesimulator/JumpLab.app');
const history = spawnSync('git', ['log', '--all', '-p', '--no-ext-diff', '--no-textconv', '--format='], {
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
});
if (history.status === 0) {
  if (patterns.some(pattern => pattern.test(history.stdout))) {
    console.error('Potential credential in reachable Git history. The value is withheld.');
    count++;
  }
} else console.error('Git history scan unavailable. Check repository read access or scan commits in batches.');
console.log('Pattern scan: ' + count + ' findings across source, ' + bundleFiles + ' client asset files and ' + (history.status === 0 ? 'reachable Git patches.' : 'no Git history.'));
process.exitCode = count ? 1 : history.status === 0 ? 0 : 2;
