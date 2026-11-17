import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { aggregate, matchEvents, validateFixtures } from './evaluation.mjs';
const manifestPath = resolve(process.argv[2] ?? 'fixtures/manifest.json');
try {
  const manifest = validateFixtures(JSON.parse(await readFile(manifestPath, 'utf8')));
  if (!manifest.clips.length) { console.error('UNVERIFIED: no annotated real clips. Synthetic tests cannot establish accuracy.'); process.exit(2); }
  await mkdir('.cache/swift', { recursive: true });
  const compile = spawnSync('swiftc', ['-module-cache-path', resolve('.cache/swift'), 'modules/jump-analysis/ios/ContactDetector.swift', 'modules/jump-analysis/ios/VideoAnalyzer.swift', 'scripts/VideoEvaluation.swift', '-o', '.cache/video-evaluation'], { stdio: 'inherit' });
  if (compile.status !== 0) process.exit(compile.status ?? 1);
  const rows = [];
  for (const c of manifest.clips) {
    const path = resolve(dirname(manifestPath), c.file);
    if (relative(dirname(manifestPath), path).startsWith('..')) throw Error('Clip must be within fixture directory.');
    const bytes = await readFile(path);
    if (createHash('sha256').update(bytes).digest('hex') !== c.sha256) throw Error(`Clip hash mismatch: ${c.id}`);
    const run = spawnSync(resolve('.cache/video-evaluation'), [path, String(c.originalFPS), c.jumpType], { encoding: 'utf8', maxBuffer: 2_000_000, timeout: 300_000 });
    if (run.status !== 0) throw Error(`Native evaluation failed: ${c.id}. No accuracy result produced.`);
    const actual = JSON.parse(run.stdout);
    const origin = actual.analysis?.timestamps[0] ?? 0;
    const detected = (actual.analysis?.events ?? []).map(e => ({ takeoffSeconds: (e.takeoff[0] + e.takeoff[1]) / 2 - origin, landingSeconds: (e.landing[0] + e.landing[1]) / 2 - origin }));
    rows.push({ id: c.id, type: c.jumpType, category: c.category, reference: c.reference, referenceEvents: c.expected.events.length, expected: c.expected.outcome, outcome: actual.outcome, match: matchEvents(detected, c.expected.events), actual });
  }
  const missingCoverage = ['standing', 'running', 'repeated', 'original-cfr', 'original-vfr', 'slow-motion', 'exported', 'failure'].filter(k => !rows.some(r => r.type === k || r.category === k));
  const report = { status: 'observed-sample-only; no accuracy threshold or device validation implied', evaluatedAt: new Date().toISOString(), matcherToleranceSeconds: 0.25, missingCoverage, aggregate: aggregate(rows), categories: Object.fromEntries([...new Set(rows.map(r => `${r.type}/${r.category}`))].map(k => [k, aggregate(rows.filter(r => `${r.type}/${r.category}` === k))])), rows };
  const output = resolve(process.argv[3] ?? '.cache/video-evaluation.json');
  await writeFile(output, JSON.stringify(report, null, 2)); console.log(`Observed ${rows.length} real clips. Report: ${output}`);
  if (missingCoverage.length || rows.some(r => r.expected !== r.outcome || r.match.missed || r.match.falseDetections)) process.exitCode = 1;
} catch (e) { console.error(e.message); process.exitCode = 1; }
