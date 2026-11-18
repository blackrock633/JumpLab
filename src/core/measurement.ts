export type JumpType = 'standing' | 'running' | 'repeated';
export const METHOD = 'vision-feet-flight/0.3-unvalidated';
export const PREVIOUS_METHOD = 'vision-feet-flight/0.2-unvalidated';
export const LEGACY_METHOD = 'vision-feet-flight/0.1-unvalidated';
export type MeasurementMethod = typeof METHOD | typeof PREVIOUS_METHOD | typeof LEGACY_METHOD;
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
  const intervals = capture.slice(1).map((v, i) => (v - capture[i]!) * t.originalFPS);
  if (intervals.some(v => !finite(v) || v < 0.25 - 1e-8 || v > 3 + 1e-8)) throw Error('Frame gaps or intervals conflict with capture timing.');
  function checkCadence(values: number[]) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median = (sorted[middle]! + sorted[Math.floor((sorted.length - 1) / 2)]!) / 2;
    if (Math.abs(median - 1) > 0.15) throw Error('Capture FPS conflicts with decoded timestamps or mapping.');
  }
  checkCadence(intervals);
  for (const segment of t.mappings) {
    const within = intervals.filter((_, i) => t.timestamps[i]! >= segment.playbackStart && t.timestamps[i + 1]! <= segment.playbackEnd);
    if (!within.length) throw Error('Insufficient samples to verify slow-motion segment cadence.');
    checkCadence(within);
  }
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
type SavedTiming = Omit<Timing, 'timestamps'> & { presentationStart?: number; presentationEnd?: number; frameCount?: number };
export type JumpResult = {
  id: string; type: JumpType; method: MeasurementMethod; createdAt: string; airtime: number; heightM: number;
  heightRangeM: [number, number]; airtimeRange: [number, number]; timing: SavedTiming;
  evidence: Evidence; confidence: 'experimental'; trainingEligible: false;
};
export function measurement(id: string, type: JumpType, evidence: Evidence, timing: Timing, createdAt: string): JumpResult {
  validateTiming(timing);
  return measuredEvent(id, type, evidence, timing, createdAt, new Set(timing.timestamps));
}
function measuredEvent(id: string, type: JumpType, evidence: Evidence, timing: Timing, createdAt: string, frames: Set<number>): JumpResult {
  const [a, b, c, d] = [...evidence.takeoff, ...evidence.landing];
  if (![a, b, c, d].every(v => frames.has(v!)) || !(a! < b! && b! < c! && c! < d!)) throw Error('Invalid transition evidence.');
  const times = [a!, b!, c!, d!].map(v => captureTime(v, timing));
  if (times[1]! - times[0]! > 0.10 || times[3]! - times[2]! > 0.10) throw Error('Transition timing is too uncertain. Use a clearer higher-FPS original clip.');
  const low = times[2]! - times[1]!, high = times[3]! - times[0]!;
  const airtime = (low + high) / 2;
  if (low < 0.12 || high > 1.5) throw Error('Insufficient temporal evidence.');
  const { timestamps, ...provenance } = timing;
  return { id: id.toLowerCase(), type, method: METHOD, createdAt, airtime, heightM: heightMeters(airtime),
    airtimeRange: [low, high], heightRangeM: [heightMeters(low), heightMeters(high)],
    timing: { ...provenance, presentationStart: timestamps[0], presentationEnd: timestamps.at(-1), frameCount: timestamps.length }, evidence,
    confidence: 'experimental', trainingEligible: false };
}
export type DecodedAnalysis = { timestamps: number[]; events: Evidence[]; playbackFPS: number; trailingPartial?: boolean; detectorVersion?: number };
export function acceptedMeasurements(analysis: DecodedAnalysis, ids: string[], type: JumpType, fps: number, confirmed: boolean, createdAt: string, legacyReceipt = false): JumpResult[] {
  if (!['standing', 'running', 'repeated'].includes(type) || !finite(Date.parse(createdAt)) ||
      !analysis.events.length || analysis.events.length !== ids.length || new Set(ids.map(id => id.toLowerCase())).size !== ids.length ||
      (type !== 'repeated' && ids.length !== 1) ||
      analysis.events.some((event, i) => i > 0 && event.takeoff[0] < analysis.events[i - 1]!.landing[1])) throw Error('Invalid or incomplete jump sequence.');
  const timing: Timing = { originalFPS: fps, playbackFPS: analysis.playbackFPS, kind: 'original', confirmedOriginal: confirmed, mappings: [], timestamps: analysis.timestamps };
  validateTiming(timing);
  const frames = new Set(timing.timestamps);
  return analysis.events.map((event, i) => {
    const result = measuredEvent(ids[i]!, type, event, timing, createdAt, frames);
    // Uncommitted receipts written by earlier builds predate the camera check.
    return legacyReceipt ? { ...result, method: PREVIOUS_METHOD } : result;
  });
}
export function compatible(results: JumpResult[], type: JumpType, method: MeasurementMethod = METHOD): JumpResult[] {
  return results.filter(r => r.type === type && r.method === method).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export function summary(results: JumpResult[]) {
  if (!results.length) return null;
  return { count: results.length, meanM: results.reduce((s, r) => s + r.heightM, 0) / results.length, bestM: Math.max(...results.map(r => r.heightM)) };
}
export const displayHeight = (r: JumpResult) => `${Math.round(r.heightM * 100)} cm (${Math.floor(r.heightRangeM[0] * 100)}–${Math.ceil(r.heightRangeM[1] * 100)} cm timing range)`;
