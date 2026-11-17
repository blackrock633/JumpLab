import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
const excluded = new Set(['node_modules', '.git', '.cache', '.expo', 'Pods', 'build', 'media', 'xcuserdata']);
export async function sourceFiles(dir = '.') {
  const all = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.name === '.env' || entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) all.push(...await sourceFiles(path));
    else all.push(path);
  }
  return all;
}
