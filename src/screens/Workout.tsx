import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Choices, Copy, Field } from './components';
import { validateLog, type Feedback, type Session, type SetLog } from '../core/training';
export type WorkoutRecord = Feedback & { prescriptionId: string; sets: SetLog[]; completedAt: string | null; updatedAt: string };
export type SavedSession = Session & { prescriptionId: string; workoutId: string };
export function Workout({ session, initial, onSave, paused }: { session: SavedSession; initial?: WorkoutRecord; onSave: (w: WorkoutRecord) => Promise<void>; paused: boolean }) {
  const [work, setWork] = useState<WorkoutRecord>(initial ?? { prescriptionId: session.prescriptionId, sets: session.exercises.flatMap(e => Array.from({ length: e.sets }, (_, index) => ({ exerciseId: e.id, index, reps: e.reps, loadKg: e.loadKg, done: false }))), completed: false, completedAt: null, effort: 5, recovery: 'good', pain: false, updatedAt: new Date().toISOString() });
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  function persist(next: WorkoutRecord) {
    setError(''); validateLog(session, next.sets); setWork(next); setSaving(true);
    void onSave({ ...next, updatedAt: new Date().toISOString() }).catch(() => setError('Could not save this change. Keep the screen open and retry.')).finally(() => setSaving(false));
  }
  function setValue(i: number, change: Partial<SetLog>) { persist({ ...work, sets: work.sets.map((s, j) => i === j ? { ...s, ...change } : s) }); }
  return <View><Copy heading>{work.completed ? 'Completed workout' : 'Your prescribed workout'}</Copy>
    <Copy>{session.minutes} minutes including warmup and cooldown. Scheduled {session.scheduledOn} at {session.startHour}:00.</Copy>
    {paused || work.pain || work.recovery === 'fatigued' ? <Copy>Stop or modify today. No automatic escalation. Rest and review your profile; seek qualified guidance for ongoing pain.</Copy> : null}
    {session.exercises.map(e => <View key={e.id}><Copy heading>{e.name}</Copy><Copy>{e.instructions}</Copy><Copy>{e.sets} × {e.reps} · {e.restSeconds} seconds rest · {e.effort}</Copy>
      {work.sets.map((s, i) => s.exerciseId !== e.id ? null : <View key={`${s.exerciseId}-${s.index}`}>
        <Field label={`${e.name}, set ${s.index + 1}, reps`} numeric value={String(s.reps)} onChange={v => { if (/^\d{1,3}$/.test(v) && Number(v) <= 100) setValue(i, { reps: Number(v) }); }} />
        {e.id === 'squat' && e.name !== 'Chair squat' ? <Field label={`Set ${s.index + 1}, load kg (blank = bodyweight or unknown)`} numeric value={s.loadKg === null ? '' : String(s.loadKg)} onChange={v => { if (!v || (/^\d+(\.\d{0,2})?$/.test(v) && Number(v) <= 500)) setValue(i, { loadKg: v ? Number(v) : null }); }} /> : null}
        <Button title={`Set ${s.index + 1}: ${s.done ? 'done' : 'mark done'}`} selected={s.done} onPress={() => setValue(i, { done: !s.done })} />
      </View>)}
    </View>)}
    <Choices label="Session effort (1 easy, 10 maximal)" values={['3', '5', '6', '8', '9', '10']} value={String(work.effort)} onChange={v => persist({ ...work, effort: Number(v) })} />
    <Choices label="Recovery" values={['good', 'fatigued']} value={work.recovery} onChange={v => persist({ ...work, recovery: v })} />
    <Button title={work.pain ? 'Pain: yes — stop/modify' : 'Pain: no'} selected={work.pain} onPress={() => persist({ ...work, pain: !work.pain })} />
    <Copy>{saving ? 'Saving on this iPhone…' : error || 'Saved changes stay on this iPhone, including offline.'}</Copy>
    {error ? <Button title="Retry saving" onPress={() => persist(work)} /> : null}
    <Button title={work.completed ? 'Save corrections' : 'Finish workout'} disabled={saving} onPress={() => persist({ ...work, completed: true, completedAt: work.completedAt ?? new Date().toISOString() })} />
  </View>;
}
