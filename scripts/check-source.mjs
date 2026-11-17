import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { sourceFiles } from './source-files.mjs';
let errors = 0;
for (const path of await sourceFiles()) {
  if (/\.(mjs|cjs)$/.test(path) && spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' }).status !== 0) errors++;
  if (!/^(src|modules)\/.+\.(ts|tsx|swift)$/.test(path)) continue;
  const value = await readFile(path, 'utf8');
  if (/console\.(log|debug|error)|print\(|NSLog\(|setInterval\(/.test(value)) { console.error(`${path}: unexpected log sink or polling interval`); errors++; }
}
console.log(`Focused source checks: ${errors} failures (syntax, application log sinks, polling). TypeScript checks run separately.`);
process.exitCode = errors ? 1 : 0;
