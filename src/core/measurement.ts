export type JumpType = 'standing' | 'running' | 'repeated';
export const METHOD = 'vision-feet-flight/0.1-unvalidated';
export const GRAVITY = 9.80665;
export type Mapping = { playbackStart: number; playbackEnd: number; captureStart: number; captureEnd: number };
export type Timing = {
  originalFPS: number; playbackFPS: number; kind: 'original' | 'mapped';
  confirmedOriginal: boolean; mappings: Mapping[]; timestamps: number[];
};
const finite = (n: number) => Number.isFinite(n);
export function validateTiming(t: Timing): void {
  if (!finite(t.originalFPS) || t.originalFPS < 24 || t.originalFPS > 240 ||
      !finite(t.playbackFPS) || t.playbackFPS <= 0 || !t.confirmedOriginal || !['original', 'mapped'].includes(t.kind)) throw Error('Confirm original, unaltered recording timing. Retimed exports need verified capture mappings.');
  if (t.timestamps.length < 4 || t.timestamps.some((v, i, a) => !finite(v) || (i > 0 && v <= a[i - 1]!))) throw Error('Missing or irregular presentation timestamps.');
  if (t.kind === 'original') {
    if (t.mappings.length || Math.abs(t.originalFPS / t.playbackFPS - 1) > 0.03) throw Error('Capture FPS conflicts with playback timing. Use the original clip.');
    const intervals = t.timestamps.slice(1).map((v, i) => v - t.timestamps[i]!).sort((a, b) => a - b);
    if (Math.abs(intervals[Math.floor(intervals.length / 2)]! * t.originalFPS - 1) > 0.15) throw Error('Capture FPS conflicts with decoded timestamps.');
  } else {
    if (!t.mappings.length) throw Error('Missing capture mapping.');
    t.mappings.forEach((m, i, a) => {
      if (![m.playbackStart, m.playbackEnd, m.captureStart, m.captureEnd].every(finite) ||
          m.playbackEnd <= m.playbackStart || m.captureEnd <= m.captureStart ||
          (i && (Math.abs(m.playbackStart - a[i - 1]!.playbackEnd) > 1e-6 || Math.abs(m.captureStart - a[i - 1]!.captureEnd) > 1e-6))) throw Error('Invalid or discontinuous slow-motion mapping.');
    });
    if (t.timestamps[0]! < t.mappings[0]!.playbackStart || t.timestamps.at(-1)! > t.mappings.at(-1)!.playbackEnd) throw Error('Mapping does not cover the clip.');
  }
  const capture = t.timestamps.map(v => captureTime(v, t));
  if (capture.some((v, i, a) => i > 0 && (v <= a[i - 1]! || v - a[i - 1]! > 3 / t.originalFPS))) throw Error('Frame gaps are too large for contact timing.');
}
export function captureTime(pts: number, t: Timing): number {
  if (t.kind === 'original') return pts - t.timestamps[0]!;
  const m = t.mappings.find(m => pts >= m.playbackStart && pts <= m.playbackEnd);
  if (!m) throw Error('Timestamp outside verified mapping.');
  return m.captureStart + (pts - m.playbackStart) * (m.captureEnd - m.captureStart) / (m.playbackEnd - m.playbackStart);
}
export function heightMeters(seconds: number): number {
  if (!finite(seconds) || seconds <= 0 || seconds > 1.5) throw Error('Unsupported airtime.');
  return GRAVITY * seconds * seconds / 8;
}
export type Evidence = { takeoff: [number, number]; landing: [number, number] };
export type JumpResult = {
  id: string; type: JumpType; method: typeof METHOD; createdAt: string; airtime: number; heightM: number;
  heightRangeM: [number, number]; airtimeRange: [number, number]; timing: Timing;
  evidence: Evidence; confidence: 'experimental'; trainingEligible: false;
};
export function measurement(id: string, type: JumpType, evidence: Evidence, timing: Timing, createdAt: string): JumpResult {
  validateTiming(timing);
  const [a, b, c, d] = [...evidence.takeoff, ...evidence.landing];
  if (![a, b, c, d].every(v => timing.timestamps.includes(v!)) || !(a! < b! && b! < c! && c! < d!)) throw Error('Invalid transition evidence.');
  const times = [a!, b!, c!, d!].map(v => captureTime(v, timing));
  if (times[1]! - times[0]! > 0.10 || times[3]! - times[2]! > 0.10) throw Error('Transition timing is too uncertain. Use a clearer higher-FPS original clip.');
  const low = times[2]! - times[1]!, high = times[3]! - times[0]!;
  const airtime = (low + high) / 2;
  if (low < 0.12 || high > 1.5) throw Error('Insufficient temporal evidence.');
  return { id, type, method: METHOD, createdAt, airtime, heightM: heightMeters(airtime),
    airtimeRange: [low, high], heightRangeM: [heightMeters(low), heightMeters(high)], timing, evidence,
    confidence: 'experimental', trainingEligible: false };
}
export function compatible(results: JumpResult[], type: JumpType, method = METHOD): JumpResult[] {
  return results.filter(r => r.type === type && r.method === method).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export function summary(results: JumpResult[]) {
  if (!results.length) return null;
  return { count: results.length, meanM: results.reduce((s, r) => s + r.heightM, 0) / results.length, bestM: Math.max(...results.map(r => r.heightM)) };
}
export const displayHeight = (r: JumpResult) => `${Math.round(r.heightM * 100)} cm (${Math.floor(r.heightRangeM[0] * 100)}–${Math.ceil(r.heightRangeM[1] * 100)} cm timing range)`;
