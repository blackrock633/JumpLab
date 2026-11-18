import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedMeasurements, GRAVITY, METHOD, captureTime, compatible, displayHeight, heightMeters, measurement, summary, validateTiming, type Timing } from '../src/core/measurement.ts';
const timing = (fps = 60, origin = 10): Timing => ({ originalFPS: fps, playbackFPS: fps, kind: 'original', confirmedOriginal: true, mappings: [], timestamps: Array.from({ length: fps * 2 }, (_, i) => origin + i / fps) });
test('flight-time SI equation and rejection boundaries', () => {
  assert.equal(heightMeters(0.4), GRAVITY * 0.16 / 8);
  assert.equal(heightMeters(1.5), GRAVITY * 2.25 / 8);
  for (const t of [0, -1, NaN, Infinity, 1.50001]) assert.throws(() => heightMeters(t));
});
test('CFR uses timestamp differences with a nonzero origin', () => {
  const t = timing(); validateTiming(t);
  assert.equal(captureTime(10.5, t), 0.5);
  const r = measurement('r', 'standing', { takeoff: [t.timestamps[10]!, t.timestamps[11]!], landing: [t.timestamps[34]!, t.timestamps[35]!] }, t, '2026-01-01');
  assert.ok(Math.abs(r.airtime - 0.4) < 1e-12); assert.ok(r.airtimeRange[0] < 0.4 && r.airtimeRange[1] > 0.4);
  assert.equal(r.trainingEligible, false); assert.equal(r.confidence, 'experimental');
  assert.match(displayHeight(r), /cm.*timing range/);
  const { timestamps, ...provenance } = t;
  assert.deepEqual(JSON.parse(JSON.stringify(r)).timing, {
    ...provenance, presentationStart: timestamps[0], presentationEnd: timestamps.at(-1), frameCount: timestamps.length,
  });
});
test('VFR retains individual presentation intervals', () => {
  const t = timing(30); t.timestamps = [2, 2.02, 2.06, 2.09, 2.13, 2.16]; validateTiming(t);
  assert.ok(Math.abs(captureTime(2.13, t) - 0.13) < 1e-12);
});
test('mapped slow-motion uses capture time, including segment boundaries', () => {
  const t: Timing = { originalFPS: 120, playbackFPS: 30, kind: 'mapped', confirmedOriginal: true,
    timestamps: Array.from({ length: 241 }, (_, i) => 5 + i / 30),
    mappings: [{ playbackStart: 5, playbackEnd: 9, captureStart: 0, captureEnd: 1 }, { playbackStart: 9, playbackEnd: 13, captureStart: 1, captureEnd: 2 }] };
  validateTiming(t); assert.equal(captureTime(7, t), 0.5); assert.equal(captureTime(11, t), 1.5);
  const gap = structuredClone(t); gap.mappings[1]!.captureStart = 2; assert.throws(() => validateTiming(gap), /discontinuous/);
  const backward = structuredClone(t); backward.mappings[0]!.captureEnd = -1; assert.throws(() => validateTiming(backward));
  const uncovered = structuredClone(t); uncovered.mappings.pop(); assert.throws(() => validateTiming(uncovered), /cover/);
});
test('missing metadata, conflicting FPS, baked exports and invalid timestamps reject', () => {
  for (const change of [ { originalFPS: 0 }, { originalFPS: 240 }, { confirmedOriginal: false }, { playbackFPS: NaN }, { timestamps: [] }, { timestamps: [0, 0.03, 0.02, 0.06] }, { timestamps: [0, 0.03, 0.06, 1] } ]) assert.throws(() => validateTiming({ ...timing(), ...change }));
  assert.throws(() => validateTiming({ ...timing(), kind: 'mapped', mappings: [] }), /mapping/);
  assert.throws(() => measurement('x', 'running', { takeoff: [10, 11], landing: [11, 12] }, timing(), 'now'), /evidence/);
});
test('low FPS broadens uncertainty, summaries and comparisons keep types/methods separate', () => {
  const make = (fps: number) => { const t = timing(fps, 0); return measurement(String(fps), 'repeated', { takeoff: [t.timestamps[0]!, t.timestamps[1]!], landing: [t.timestamps[Math.round(fps * 0.4)]!, t.timestamps[Math.round(fps * 0.4) + 1]!] }, t, '2026-01-01'); };
  const low = make(24), high = make(120);
  assert.ok(low.airtimeRange[1] - low.airtimeRange[0] > high.airtimeRange[1] - high.airtimeRange[0]);
  assert.equal(compatible([low, { ...high, type: 'running' }], 'repeated').length, 1);
  assert.equal(compatible([low], 'repeated', 'other' as typeof METHOD).length, 0);
  assert.equal(summary([]), null); assert.equal(summary([low, high])?.count, 2);
});
test('wide transition evidence cannot become a saved estimate', () => {
  const t = timing(24, 0);
  assert.throws(() => measurement('wide', 'standing', { takeoff: [t.timestamps[0]!, t.timestamps[3]!], landing: [t.timestamps[10]!, t.timestamps[11]!] }, t, '2026-01-01'), /uncertain/);
});

test('mapped capture cadence rejects compression and conflicting segment rates', () => {
  const timestamps = Array.from({ length: 31 }, (_, i) => i / 30);
  const mapped: Timing = { originalFPS: 60, playbackFPS: 30, kind: 'mapped', confirmedOriginal: true, timestamps,
    mappings: [{ playbackStart: 0, playbackEnd: 1, captureStart: 0, captureEnd: 0.0001 }] };
  assert.throws(() => validateTiming(mapped), /intervals/);
  mapped.mappings = [
    { playbackStart: 0, playbackEnd: 0.5, captureStart: 0, captureEnd: 0.2 },
    { playbackStart: 0.5, playbackEnd: 1, captureStart: 0.2, captureEnd: 0.5 },
  ];
  assert.throws(() => validateTiming(mapped), /FPS conflicts/);
});

test('production acceptance rejects a native event whose minimum plausible airtime is too short', () => {
  const t = timing();
  const events: Parameters<typeof acceptedMeasurements>[0]['events'] = [
    { takeoff: [t.timestamps[29]!, t.timestamps[30]!], landing: [t.timestamps[37]!, t.timestamps[41]!] },
  ];
  assert.throws(() => acceptedMeasurements({ timestamps: t.timestamps, playbackFPS: 60, events }, ['id'], 'standing', 60, true, '2026-11-17T00:00:00Z'), /Insufficient temporal evidence/);
});
