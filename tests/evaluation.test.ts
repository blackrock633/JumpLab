import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, matchEvents, validateFixtures } from '../scripts/evaluation.mjs';
test('fixtures validate reference identity/uncertainty and complete events', () => {
  validateFixtures({ version: 1, clips: [] });
  assert.throws(() => validateFixtures({ clips: [] }));
  assert.throws(() => validateFixtures({ version: 1, clips: [{ id: 'missing-evidence' }] }));
  const clip = { id: 'clip', file: 'clip.mov', sha256: 'a'.repeat(64), jumpType: 'standing',
    category: 'failure', originalFPS: 60, reference: { method: 'frame annotation', annotator: 'reviewer', uncertaintySeconds: 0.02 },
    expected: { outcome: 'reject', reason: 'occlusion', events: [] } };
  validateFixtures({ version: 1, clips: [clip] });
  for (const invalid of [{ id: 123 }, { reference: { ...clip.reference, method: 42 } }, { reference: { ...clip.reference, annotator: true } },
    { sha256: ['a'.repeat(64)] }, { expected: { ...clip.expected, reason: true } }, { expected: { outcome: 'accept', events: [null] } }]) {
    assert.throws(() => validateFixtures({ version: 1, clips: [{ ...clip, ...invalid }] }), /Invalid/);
  }
});
test('matching is one-to-one; missed/false events and signed errors are reported', () => {
  const result = matchEvents([{ takeoffSeconds: 1.02, landingSeconds: 1.43 }, { takeoffSeconds: 1.03, landingSeconds: 1.44 }], [{ takeoffSeconds: 1, landingSeconds: 1.4 }, { takeoffSeconds: 3, landingSeconds: 3.4 }]);
  assert.equal(result.matched, 1); assert.equal(result.falseDetections, 1); assert.equal(result.missed, 1);
  assert.ok(Math.abs(result.errors[0].airtimeSeconds - 0.01) < 1e-12);
  assert.equal(aggregate([]).errors.heightMeters, null);
});
test('matching preserves event order and does not lose neighbors to a greedy nearest choice', () => {
  const make = (takeoffSeconds: number) => ({ takeoffSeconds, landingSeconds: takeoffSeconds + 0.3 });
  const result = matchEvents([make(1.19), make(1.4)], [make(1), make(1.2)]);
  assert.equal(result.matched, 2); assert.equal(result.missed, 0); assert.equal(result.falseDetections, 0);
});
