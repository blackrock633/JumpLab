import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { aggregate, matchEvents, missingEvaluationCoverage, validateFixtures } from './evaluation.mjs';
import { acceptedMeasurements, METHOD } from '../src/core/measurement.ts';
const manifestPath = resolve(process.argv[2] ?? 'fixtures/manifest.json');
try {
  const manifest = validateFixtures(JSON.parse(await readFile(manifestPath, 'utf8')));
  if (!manifest.clips.length) { console.error('UNVERIFIED: no annotated real clips. Synthetic tests cannot establish accuracy.'); process.exit(2); }
  await mkdir('.cache/swift', { recursive: true });
  const compile = spawnSync('swiftc', ['-module-cache-path', resolve('.cache/swift'), 'modules/jump-analysis/ios/ContactDetector.swift', 'modules/jump-analysis/ios/VideoAnalyzer.swift', 'scripts/VideoEvaluation.swift', '-o', '.cache/video-evaluation'], { stdio: 'inherit' });
  if (compile.status !== 0) process.exit(compile.status ?? 1);
  const rows = [];
  for (const c of manifest.clips) {
    const fixtureDir = await realpath(dirname(manifestPath));
    const path = await realpath(resolve(fixtureDir, c.file));
    const within = relative(fixtureDir, path);
    if (isAbsolute(within) || within === '..' || within.startsWith('..' + sep)) throw Error('Clip must be within fixture directory.');
    const hash = createHash('sha256');
    for await (const bytes of createReadStream(path)) hash.update(bytes);
    if (hash.digest('hex') !== c.sha256) throw Error(`Clip hash mismatch: ${c.id}`);
    const run = spawnSync(resolve('.cache/video-evaluation'), [path, String(c.originalFPS), c.jumpType], { encoding: 'utf8', maxBuffer: 2_000_000, timeout: 300_000 });
    if (run.status !== 0) throw Error(`Native evaluation failed: ${c.id}. No accuracy result produced.`);
    const actual = JSON.parse(run.stdout);
    actual.method = METHOD;
    const detected = [];
    if (actual.analysis) {
      try {
        const values = acceptedMeasurements(actual.analysis, actual.analysis.events.map((_, i) => String(i)), c.jumpType, c.originalFPS, true, new Date().toISOString());
        actual.outcome = 'accept';
        for (const value of values) {
          const origin = value.timing.presentationStart;
          const [a, b] = value.evidence.takeoff, [c, d] = value.evidence.landing;
          detected.push({ takeoffSeconds: (a + b) / 2 - origin, landingSeconds: (c + d) / 2 - origin });
        }
      } catch (error) { actual.outcome = 'reject'; actual.reason = error.message; }
    }
    rows.push({ id: c.id, type: c.jumpType, category: c.category, reference: c.reference, referenceEvents: c.expected.events.length, expected: c.expected.outcome, outcome: actual.outcome, match: matchEvents(detected, c.expected.events), actual });
  }
  const missingCoverage = missingEvaluationCoverage(rows);
  const report = { status: 'observed-sample-only; no accuracy threshold or device validation implied', evaluatedAt: new Date().toISOString(), matcherToleranceSeconds: 0.25, missingCoverage, aggregate: aggregate(rows), categories: Object.fromEntries([...new Set(rows.map(r => `${r.type}/${r.category}`))].map(k => [k, aggregate(rows.filter(r => `${r.type}/${r.category}` === k))])), rows };
  const output = resolve(process.argv[3] ?? '.cache/video-evaluation.json');
  await writeFile(output, JSON.stringify(report, null, 2)); console.log(`Observed ${rows.length} real clips. Report: ${output}`);
  if (missingCoverage.length || rows.some(r => r.expected !== r.outcome || r.match.missed || r.match.falseDetections)) process.exitCode = 1;
} catch (e) { console.error(e.message); process.exitCode = 1; }
