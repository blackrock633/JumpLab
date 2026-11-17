import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import Native, { type ImportedClip } from '../../modules/jump-analysis/src';
import { displayHeight, measurement, summary, type JumpResult, type JumpType } from '../core/measurement';
import { Button, Choices, Copy, Field } from './components';
import { saveBatch } from '../data/store';
export function Analyze({ owner, onSaved }: { owner: string; onSaved: () => void }) {
  const [clip, setClip] = useState<ImportedClip | null>(null), [type, setType] = useState<JumpType>('standing');
  const [fps, setFPS] = useState(''), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const [results, setResults] = useState<JumpResult[]>([]);
  const [unsaved, setUnsaved] = useState<JumpResult[]>([]);
  const mounted = useRef(true), imported = useRef<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; Native.cancel(); if (imported.current) void Native.discard(imported.current).catch(() => {}); }; }, []);
  async function pick() {
    setBusy(true); setStatus('Opening your video library…'); setResults([]);
    try {
      if (clip) await Native.discard(clip.id);
      const next = await Native.pick();
      if (!mounted.current) { if (next) await Native.discard(next.id); return; }
      setClip(next); imported.current = next?.id ?? null; setConfirmed(false);
      setFPS(next ? String(Math.round(next.playbackFPS * 100) / 100) : '');
      setStatus(next ? next.hasRetiming ? 'Slow-motion mapping detected. Import an original unretimed recording.' : 'Playback FPS prefilled. Confirm it matches your camera’s original recording FPS.' : 'Import cancelled. You can choose another clip.');
    } catch { if (mounted.current) { setClip(null); setStatus('Video unavailable or unsupported. Use a local 1–30 second original video under 250 MB, up to 4K. If Photos access is restricted, review Settings and try again.'); } }
    finally { if (mounted.current) setBusy(false); }
  }
  async function analyze() {
    if (!clip) return;
    setBusy(true); setStatus('Analyzing on this iPhone. Keep JumpLab open.'); setResults([]);
    try {
      const native = await Native.analyze(clip.id, Number(fps), type, confirmed);
      const found = native.events.map(e => measurement(randomUUID(), type, e, { originalFPS: Number(fps), playbackFPS: clip.playbackFPS, kind: 'original', confirmedOriginal: confirmed, mappings: [], timestamps: native.timestamps }, new Date().toISOString()));
      // Save locally before presenting success. Each result has a stable id for retries.
      if (!found.length) throw Error('No complete jump detected. Import a clearer recording.');
      if (mounted.current) setUnsaved(found);
      await commit(found);
    } catch (e) { if (mounted.current) setStatus(e instanceof Error ? e.message : 'Analysis failed. Import a clearer original recording and try again.'); }
    finally { if (mounted.current) { setClip(null); imported.current = null; setBusy(false); } }
  }
  async function commit(found: JumpResult[]) {
    try {
      await saveBatch(owner, found.map(result => ({ kind: 'jump', payload: result, id: result.id })));
      if (mounted.current) { setUnsaved([]); setResults(found); setStatus('Saved on this iPhone. Experimental estimates; real-video accuracy has not been validated.'); onSaved(); }
    } catch { throw Error('Could not save the estimates. Keep this screen open and retry saving; they have not been reported as saved.'); }
  }
  const totals = summary(results);
  return <View><Copy heading>Analyze a jump</Copy>
    <Copy>Film one athlete from the side with a fixed camera, full body and both feet visible, bright light and a level landing area. Begin with a quiet stance for half a second and include the complete landing.</Copy>
    <Copy>Use an original unretimed 24–240 FPS clip, 1–30 seconds, up to 4K / 250 MB. No frame selection or calibration required. Slow-motion edits and exports are currently unsupported.</Copy>
    <Choices label="Jump type" values={['standing', 'running', 'repeated']} value={type} onChange={setType} />
    <Button title="Choose video" testID="choose-video" disabled={busy || unsaved.length > 0} onPress={() => void pick()} />
    {clip ? <View><Field label="Original recording FPS" numeric value={fps} onChange={v => { setFPS(v); setConfirmed(false); }} />
      <Button title="I confirm this is the original, unretimed recording and the FPS matches my camera" selected={confirmed} onPress={() => setConfirmed(!confirmed)} />
      <Button title="Analyze on iPhone" disabled={busy || !confirmed || clip.hasRetiming} onPress={() => void analyze()} /></View> : null}
    {busy ? <Button title="Cancel analysis" onPress={() => Native.cancel()} /> : null}
    {status ? <Copy>{status}</Copy> : null}
    {unsaved.length > 0 && !busy ? <Button title="Retry saving estimates" onPress={() => { setBusy(true); void commit(unsaved).catch(e => { if (mounted.current) setStatus(e.message); }).finally(() => { if (mounted.current) setBusy(false); }); }} /> : null}
    {results.map((r, i) => <View key={r.id}><Copy heading>Jump {i + 1}</Copy><Copy>Estimated jump height: {displayHeight(r)}</Copy><Copy>Airtime: about {r.airtime.toFixed(2)} s ({(Math.floor(r.airtimeRange[0] * 100) / 100).toFixed(2)}–{(Math.ceil(r.airtimeRange[1] * 100) / 100).toFixed(2)} s timing range)</Copy><Copy muted>Experimental flight-time method. Timing range excludes posture and detector error.</Copy></View>)}
    {totals && totals.count > 1 ? <Copy>{totals.count} jumps · mean {Math.round(totals.meanM * 100)} cm · best {Math.round(totals.bestM * 100)} cm</Copy> : null}
    <Copy>Flight-time estimates assume comparable center-of-mass height at takeoff and landing. Running and repeated jumps are especially sensitive to posture and foot contact. These estimates are not reach height or force-plate measurements, and do not guide automatic progression.</Copy>
  </View>;
}
