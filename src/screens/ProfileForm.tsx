import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Choices, Copy, Field, styles } from './components';
import { generate, kg, localDate, validateProfile, type Profile } from '../core/training';
const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function ProfileForm({ initial, onSave }: { initial?: Profile; onSave: (p: Profile) => Promise<void> }) {
  const [p, set] = useState<Profile>(initial ?? { goal: 'standing', experience: 'new', days: [], practiceDays: [], startHour: 17, weeklyMinutes: 60, sessionMinutes: 30, equipment: 'none', weightKg: 70, displayUnits: 'kg', knownSquatKg: null, limitation: 'none', pain: false, startDate: localDate() });
  const [weight, setWeight] = useState(initial ? String(Math.round(initial.weightKg / (initial.displayUnits === 'lb' ? 0.45359237 : 1) * 10) / 10) : '70');
  const [strength, setStrength] = useState(initial?.knownSquatKg ? String(initial.knownSquatKg / (initial.displayUnits === 'lb' ? 0.45359237 : 1)) : '');
  const [hour, setHour] = useState(String(p.startHour)), [weekly, setWeekly] = useState(String(p.weeklyMinutes)), [session, setSession] = useState(String(p.sessionMinutes));
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const update = <K extends keyof Profile>(k: K, v: Profile[K]) => set({ ...p, [k]: v });
  const toggle = (key: 'days' | 'practiceDays', d: number) => update(key, p[key].includes(d) ? p[key].filter(x => x !== d) : [...p[key], d]);
  return <View>
    <Copy heading>{initial ? 'Your training profile' : 'Make room to jump'}</Copy>
    <Copy>Choose a realistic schedule. You never need to test a maximal lift.</Copy>
    <Choices label="Primary jump goal" values={['standing', 'running', 'repeated']} value={p.goal} onChange={v => update('goal', v)} />
    <Choices label="Experience" values={['new', 'trained']} value={p.experience} onChange={v => update('experience', v)} />
    <Copy>Available training days</Copy>{names.map((name, d) => <Button key={name} title={name} selected={p.days.includes(d)} onPress={() => toggle('days', d)} />)}
    <Field label="Plan starts on (YYYY-MM-DD)" value={p.startDate} onChange={v => update('startDate', v)} />
    <Field label="Training start hour (0–23, local time)" numeric value={hour} onChange={setHour} />
    <Field label="Maximum minutes per week" numeric value={weekly} onChange={setWeekly} />
    <Field label="Maximum minutes per session" numeric value={session} onChange={setSession} />
    <Copy>Hard sports or practice days (optional). We leave a day between these and jump sessions.</Copy>
    {names.map((name, d) => <Button key={name} title={`Practice: ${name}`} selected={p.practiceDays.includes(d)} onPress={() => toggle('practiceDays', d)} />)}
    <Choices label="Equipment" values={['none', 'dumbbells', 'barbell']} value={p.equipment} onChange={v => update('equipment', v)} />
    <Choices label="Weight units" values={['kg', 'lb']} value={p.displayUnits} onChange={v => {
      const divisor = v === 'lb' ? 0.45359237 : 1;
      setWeight(String(Math.round(kg(Number(weight), p.displayUnits) / divisor * 10) / 10));
      if (strength) setStrength(String(Math.round(kg(Number(strength), p.displayUnits) / divisor * 10) / 10));
      update('displayUnits', v);
    }} />
    <Field label={`Body weight (${p.displayUnits})`} numeric value={weight} onChange={setWeight} />
    <Field label={`Optional known squat working load (${p.displayUnits}); leave blank if unknown`} numeric value={strength} onChange={setStrength} />
    <Button title="I don’t know my strength" onPress={() => setStrength('')} selected={!strength} />
    <Choices label="Training limitations" values={['none', 'no-impact', 'no-loaded-squats']} value={p.limitation} onChange={v => update('limitation', v)} />
    <Copy>For other limitations, get individual guidance before using these templates.</Copy>
    <Button title={p.pain ? 'Current pain: yes — pause training' : 'Current pain: no'} selected={p.pain} onPress={() => update('pain', !p.pain)} />
    <Copy>Saving changes replaces future prescriptions. Completed workouts stay in history and count toward this week’s time budget. Your new schedule may start next week to fit your budget or allow recovery. Pain pauses automatic training.</Copy>
    {error ? <Copy>{error}</Copy> : null}
    <View style={styles.block}><Button title={busy ? 'Saving…' : 'Save profile and future plan'} disabled={busy} onPress={() => {
      const profile = { ...p, weightKg: kg(Number(weight), p.displayUnits), knownSquatKg: strength ? kg(Number(strength), p.displayUnits) : null, startHour: Number(hour), weeklyMinutes: Number(weekly), sessionMinutes: Number(session) };
      setError(''); setBusy(true);
      Promise.resolve().then(() => { if (!weight.trim() || !hour.trim() || !weekly.trim() || !session.trim()) throw Error('Complete the required numeric fields.'); validateProfile(profile); if (!profile.pain) generate(profile); return onSave(profile); }).catch(e => setError(e.message)).finally(() => setBusy(false));
    }} /></View>
  </View>;
}
