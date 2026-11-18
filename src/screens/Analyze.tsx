import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Native, { type AnalysisReceipt, type ImportedClip } from '../../modules/jump-analysis/src';
import { displayHeight, summary, type JumpResult, type JumpType } from '../core/measurement';
import { Button, Choices, Copy, Field } from './components';
import { commitAnalysis, RejectedAnalysis, recoverAnalysis } from '../data/store';
export function Analyze({ owner, onSaved }: { owner: string; onSaved: () => void }) {
  const [clip, setClip] = useState<ImportedClip | null>(null), [type, setType] = useState<JumpType>('standing');
  const [fps, setFPS] = useState(''), [confirmed, setConfirmed] = useState(false), [phase, setPhase] = useState<'idle' | 'picker' | 'analysis' | 'saving'>('idle'), [status, setStatus] = useState('');
  const [results, setResults] = useState<JumpResult[]>([]);
  const [unsaved, setUnsaved] = useState<AnalysisReceipt | null>(null);
  const [recoverable, setRecoverable] = useState(false);
  const mounted = useRef(true), imported = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    setPhase('saving');
    void recoverAnalysis(owner).then(found => {
      if (mounted.current && found) {
        setResults(found);
        setStatus('Recovered and saved the previous analysis on this iPhone.');
        onSaved();
      }
    }).catch(error => {
      if (mounted.current) { setRecoverable(!(error instanceof RejectedAnalysis)); setStatus(error.message); }
    }).finally(() => { if (mounted.current) setPhase('idle'); });
    return () => {
      mounted.current = false;
      Native.cancel();
      if (imported.current) void Native.discard(imported.current).catch(() => {});
    };
  // The component is keyed by owner so the receipt is checked once per visit.
  }, [owner]);
  async function pick() {
    setPhase('picker'); setStatus('Opening your video library…'); setResults([]);
    try {
      if (clip) await Native.discard(clip.id);
      const next = await Native.pick();
      if (!mounted.current) { if (next) await Native.discard(next.id); return; }
      setClip(next); imported.current = next?.id ?? null; setConfirmed(false);
      setFPS(next ? String(Math.round(next.playbackFPS * 100) / 100) : '');
      setStatus(next ? next.hasRetiming ? 'Slow-motion mapping detected. Import an original unretimed recording.' : 'Playback FPS prefilled. Confirm it matches your camera’s original recording FPS.' : 'Import cancelled. You can choose another clip.');
    } catch { if (mounted.current) { setClip(null); setStatus('Video unavailable or unsupported. Use a local 1–30 second original video under 250 MB, up to 4K. If Photos access is restricted, review Settings and try again.'); } }
    finally { if (mounted.current) setPhase('idle'); }
  }
  async function analyze() {
    if (!clip) return;
    setRecoverable(false);
    setPhase('analysis'); setStatus('Analyzing on this iPhone. Keep JumpLab open.'); setResults([]);
    try {
      const receipt = await Native.analyze(clip.id, Number(fps), type, confirmed, owner);
      if (mounted.current) { setPhase('saving'); setUnsaved(receipt); }
      await commit(receipt);
    } catch (error) {
      if (mounted.current) {
        if (error instanceof RejectedAnalysis) setUnsaved(null);
        setStatus(error instanceof Error ? error.message : 'Analysis failed. Import a clearer original recording and try again.');
      }
    }
    finally { if (mounted.current) { setClip(null); imported.current = null; setPhase('idle'); } }
  }
  async function commit(receipt: AnalysisReceipt | null) {
    const found = receipt ? await commitAnalysis(owner, receipt) : await recoverAnalysis(owner);
    if (mounted.current) {
      setUnsaved(null); setRecoverable(false);
      if (!found) setStatus('No estimates are waiting to be saved. You can import another video.');
      if (found) { setResults(found); setStatus('Saved on this iPhone. Experimental estimates; real-video accuracy has not been validated.'); onSaved(); }
    }
  }
  const totals = summary(results);
  return <View><Copy heading>Analyze a jump</Copy>
    <Copy>Film one athlete from the side with a fixed camera, full body and both feet visible, bright light and a level landing area. Begin with a quiet stance for half a second and include the complete landing.</Copy>
    <Copy>Use an original unretimed 24–240 FPS clip, 1–30 seconds, up to 4K / 250 MB. No frame selection or calibration required. Slow-motion edits and exports are currently unsupported.</Copy>
    <Choices label="Jump type" values={['standing', 'running', 'repeated']} value={type} onChange={setType} />
    <Button title="Choose video" testID="choose-video" disabled={phase !== 'idle' || unsaved !== null} onPress={() => void pick()} />
    {clip ? <View><Field label="Original recording FPS" numeric value={fps} onChange={v => { setFPS(v); setConfirmed(false); }} />
      <Button title="I confirm this is the original, unretimed recording and the FPS matches my camera" selected={confirmed} onPress={() => setConfirmed(!confirmed)} />
      <Button title="Analyze on iPhone" disabled={phase !== 'idle' || !confirmed || clip.hasRetiming} onPress={() => void analyze()} /></View> : null}
    {phase === 'analysis' ? <Button title="Cancel analysis" onPress={() => Native.cancel()} /> : null}
    {status ? <Copy>{status}</Copy> : null}
    {phase === 'idle' && (unsaved || recoverable) ? <Button title="Retry saving estimates" onPress={() => {
      setPhase('saving');
      void commit(unsaved).catch(e => {
        if (mounted.current) { setStatus(e.message); if (e instanceof RejectedAnalysis) { setUnsaved(null); setRecoverable(false); } }
      }).finally(() => { if (mounted.current) setPhase('idle'); });
    }} /> : null}
    {results.map((r, i) => <View key={r.id}><Copy heading>Jump {i + 1}</Copy><Copy>Estimated jump height: {displayHeight(r)}</Copy><Copy>Airtime: about {r.airtime.toFixed(2)} s ({(Math.floor(r.airtimeRange[0] * 100) / 100).toFixed(2)}–{(Math.ceil(r.airtimeRange[1] * 100) / 100).toFixed(2)} s timing range)</Copy><Copy muted>Experimental flight-time method. Timing range excludes posture and detector error.</Copy></View>)}
    {totals && totals.count > 1 ? <Copy>{totals.count} jumps · mean {Math.round(totals.meanM * 100)} cm · best {Math.round(totals.bestM * 100)} cm</Copy> : null}
    <Copy>Flight-time estimates assume comparable center-of-mass height at takeoff and landing. Running and repeated jumps are especially sensitive to posture and foot contact. These estimates are not reach height or force-plate measurements, and do not guide automatic progression.</Copy>
  </View>;
}
