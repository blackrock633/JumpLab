const finite = n => typeof n === 'number' && Number.isFinite(n);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
export function validateFixtures(manifest) {
  if (!object(manifest) || manifest.version !== 1 || !Array.isArray(manifest.clips)) throw Error('Fixture manifest version 1 with clips[] required.');
  const ids = new Set();
  for (const c of manifest.clips) {
    if (!object(c) || !nonempty(c.id) || ids.has(c.id) || !nonempty(c.file) || typeof c.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(c.sha256) ||
      !['standing', 'running', 'repeated'].includes(c.jumpType) || !['original-cfr', 'original-vfr', 'slow-motion', 'exported', 'failure'].includes(c.category) ||
      !finite(c.originalFPS) || c.originalFPS < 24 || c.originalFPS > 240 ||
      !object(c.reference) || !nonempty(c.reference.method) || !nonempty(c.reference.annotator) || !finite(c.reference.uncertaintySeconds) || c.reference.uncertaintySeconds < 0 ||
      !object(c.expected) || !['accept', 'reject'].includes(c.expected.outcome) || !Array.isArray(c.expected.events) ||
      ('reason' in c.expected && typeof c.expected.reason !== 'string')) throw Error(`Invalid fixture: ${c?.id ?? '(missing id)'}`);
    ids.add(c.id);
    if (c.expected.outcome === 'accept' && !c.expected.events.length) throw Error('Accepted reference requires complete annotated jumps.');
    if (c.expected.outcome === 'reject' && (!nonempty(c.expected.reason) || c.expected.events.length)) throw Error('Rejected fixture needs a reason and no valid events.');
    let last = -Infinity;
    for (const e of c.expected.events) {
      if (!object(e) || !finite(e.takeoffSeconds) || !finite(e.landingSeconds) || e.takeoffSeconds < 0 || e.takeoffSeconds <= last || e.landingSeconds <= e.takeoffSeconds || e.landingSeconds - e.takeoffSeconds > 1.5) throw Error(`Invalid reference event: ${c.id}`);
      last = e.landingSeconds;
    }
  }
  return manifest;
}
export function matchEvents(detected, reference, tolerance = 0.25) {
  // Ordered matching maximizes matched events, then minimizes boundary error.
  // Greedy nearest matching can consume the only candidate for a neighboring jump.
  const dp = Array.from({ length: detected.length + 1 }, () => Array(reference.length + 1));
  for (let i = detected.length; i >= 0; i--) for (let j = reference.length; j >= 0; j--) {
    if (i === detected.length || j === reference.length) { dp[i][j] = { pairs: [], cost: 0 }; continue; }
    const d = detected[i], r = reference[j], candidates = [dp[i + 1][j], dp[i][j + 1]];
    const cost = Math.abs(d.takeoffSeconds - r.takeoffSeconds) + Math.abs(d.landingSeconds - r.landingSeconds);
    if (Math.abs(d.takeoffSeconds - r.takeoffSeconds) <= tolerance && Math.abs(d.landingSeconds - r.landingSeconds) <= tolerance) {
      const next = dp[i + 1][j + 1]; candidates.push({ pairs: [[i, j], ...next.pairs], cost: cost + next.cost });
    }
    dp[i][j] = candidates.sort((a, b) => b.pairs.length - a.pairs.length || a.cost - b.cost)[0];
  }
  const errors = [];
  for (const [i, j] of dp[0][0].pairs) {
    const d = detected[i], r = reference[j], da = d.landingSeconds - d.takeoffSeconds, ra = r.landingSeconds - r.takeoffSeconds;
    errors.push({ takeoffSeconds: d.takeoffSeconds - r.takeoffSeconds, landingSeconds: d.landingSeconds - r.landingSeconds, airtimeSeconds: da - ra, heightMeters: 9.80665 * (da * da - ra * ra) / 8 });
  }
  return { matched: errors.length, missed: reference.length - errors.length, falseDetections: detected.length - errors.length, errors };
}
export function aggregate(rows) {
  const errors = rows.flatMap(r => r.match.errors);
  return { clips: rows.length, referenceEvents: rows.reduce((s, r) => s + r.referenceEvents, 0),
    matchedEvents: errors.length, missed: rows.reduce((s, r) => s + r.match.missed, 0), falseDetections: rows.reduce((s, r) => s + r.match.falseDetections, 0),
    rejectionRate: rows.length ? rows.filter(r => r.outcome === 'reject').length / rows.length : null,
    unexpectedRejections: rows.filter(r => r.outcome === 'reject' && r.expected === 'accept').length,
    errors: Object.fromEntries(['takeoffSeconds', 'landingSeconds', 'airtimeSeconds', 'heightMeters'].map(k => [k, errors.length ? { meanAbsolute: errors.reduce((s, e) => s + Math.abs(e[k]), 0) / errors.length, maxAbsolute: Math.max(...errors.map(e => Math.abs(e[k]))) } : null])) };
}
