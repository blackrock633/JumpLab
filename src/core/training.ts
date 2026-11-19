export const RULES = 'conservative/2';
const MAX_LOAD_KG = 500;
export type Profile = {
  goal: 'standing' | 'running' | 'repeated'; experience: 'new' | 'trained';
  days: number[]; practiceDays: number[]; startHour: number; weeklyMinutes: number; sessionMinutes: number;
  equipment: 'none' | 'dumbbells' | 'barbell'; weightKg: number; displayUnits: 'kg' | 'lb';
  knownSquatKg: number | null; limitation: 'none' | 'no-impact' | 'no-loaded-squats'; pain: boolean;
  startDate: string;
};
export type Exercise = { id: string; name: string; instructions: string; sets: number; baseSets: number; reps: number; loadKg: number | null; effort: string; restSeconds: number };
export type Session = { id: string; day: number; scheduledOn: string; startHour: number; minutes: number; exercises: Exercise[] };
export type Plan = { version: typeof RULES | 'conservative/1'; week: number; sessions: Session[]; explanation: string; usedObservationIds?: string[] };
export function kg(value: number, unit: 'kg' | 'lb') { return unit === 'lb' ? value * 0.45359237 : value; }
export function validateProfile(p: Profile) {
  if (!validDate(p.startDate) || !['standing', 'running', 'repeated'].includes(p.goal) || !['new', 'trained'].includes(p.experience) ||
    !['none', 'dumbbells', 'barbell'].includes(p.equipment) || !['kg', 'lb'].includes(p.displayUnits) ||
    !['none', 'no-impact', 'no-loaded-squats'].includes(p.limitation) || typeof p.pain !== 'boolean' ||
    !Array.isArray(p.days) || !Array.isArray(p.practiceDays) ||
    [...p.days, ...p.practiceDays].some(d => !Number.isInteger(d) || d < 0 || d > 6) ||
    new Set(p.days).size !== p.days.length || new Set(p.practiceDays).size !== p.practiceDays.length ||
    !Number.isFinite(p.weightKg) || p.weightKg < 25 || p.weightKg > 300 ||
    !Number.isInteger(p.startHour) || p.startHour < 0 || p.startHour > 23 ||
    !Number.isFinite(p.weeklyMinutes) || p.weeklyMinutes < 0 || p.weeklyMinutes > 600 ||
    !Number.isFinite(p.sessionMinutes) || p.sessionMinutes < 0 || p.sessionMinutes > 120 ||
    (p.knownSquatKg !== null && (!Number.isFinite(p.knownSquatKg) || p.knownSquatKg < 0 || p.knownSquatKg > MAX_LOAD_KG))) throw Error('Check profile values, units and schedule.');
}
export function validDate(value: string) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function localDate(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function trainingWeekStart(date: string, weeksAhead = 0) {
  const monday = new Date(`${date}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7 + weeksAhead * 7);
  return monday.toISOString().slice(0, 10);
}
export function canPrepareNextWeek<T extends Pick<Session, 'scheduledOn'>>(
  sessions: readonly T[], completed: (session: T) => boolean, now = new Date(),
) {
  const today = localDate(now);
  return sessions.every(session => session.scheduledOn < today ||
    (session.scheduledOn === today && completed(session)));
}
export function canOpenWorkout(session: Session, completed: boolean, now = new Date()) {
  return completed || session.scheduledOn === localDate(now);
}
export function canResumeWorkout(session: Session, profile: Profile) {
  return !profile.pain && !profile.practiceDays.some(day => circularDistance(day, session.day) < 2) &&
    session.exercises.every(exercise => {
      if (exercise.id === 'jump') return profile.limitation !== 'no-impact';
      if (exercise.id !== 'squat' || exercise.name === 'Chair squat') return true;
      if (profile.limitation === 'no-loaded-squats' || profile.equipment === 'none') return false;
      return exercise.name === (profile.equipment === 'dumbbells' ? 'Goblet squat' : 'Squat');
    });
}
export function futureProfile(p: Profile, completions: (string | null)[], now = new Date()): Profile {
  const dates = completions.filter((t): t is string => t !== null).map(Date.parse).filter(Number.isFinite);
  // Three calendar dates after a completion conservatively leaves >=48 hours at any scheduled hour.
  const last = dates.length ? new Date(Math.max(...dates)) : null;
  if (last) last.setDate(last.getDate() + 3);
  const startDate = [p.startDate, localDate(now), ...(last ? [localDate(last)] : [])].sort().at(-1)!;
  return { ...p, startDate };
}
function scheduledDate(p: Profile, day: number, week: number) {
  const date = new Date(`${p.startDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + (day - date.getUTCDay() + 7) % 7 + (week - 1) * 7);
  return date.toISOString().slice(0, 10);
}
const circularDistance = (a: number, b: number) => Math.min(Math.abs(a - b), 7 - Math.abs(a - b));
export function generate(p: Profile, week = 1): Plan {
  validateProfile(p);
  if (!Number.isInteger(week) || week < 1) throw Error('Invalid week.');
  if (p.pain) throw Error('Pause jump training while in pain. Stop or modify activity and seek qualified guidance if needed.');
  const minutes = p.experience === 'new' ? 25 : 35;
  if (p.sessionMinutes < minutes || p.weeklyMinutes < minutes) throw Error(`This template needs at least ${minutes} minutes per session and week. Change your time budget.`);
  const days: number[] = [];
  const cap = Math.min(p.experience === 'new' ? 2 : 3, Math.floor(p.weeklyMinutes / minutes));
  for (const d of [...p.days].sort((a, b) => a - b)) {
    if (days.length < cap && !p.practiceDays.some(b => circularDistance(d, b) < 2) && !days.some(b => circularDistance(d, b) < 2)) days.push(d);
  }
  if (!days.length) throw Error('No recovery-safe training day. Allow a day between hard practice and jump sessions.');
  const deload = week % 4 === 0;
  const baseSets = p.experience === 'new' ? 2 : 3;
  const sets = deload ? 1 : baseSets;
  const strength: Exercise = {
    id: 'squat', name: p.equipment === 'none' || p.limitation === 'no-loaded-squats' ? 'Chair squat' : p.equipment === 'dumbbells' ? 'Goblet squat' : 'Squat',
    instructions: 'Lower under control to a comfortable depth; stand tall. Stop for pain. Start light; never test a maximum.',
    sets, baseSets, reps: 6, loadKg: p.equipment === 'none' || p.limitation === 'no-loaded-squats' ? null : p.knownSquatKg ? Math.floor(p.knownSquatKg * 0.4) : null,
    effort: 'Comfortable technique; leave at least 3 repetitions in reserve', restSeconds: 120,
  };
  const jump: Exercise = {
    id: 'jump', name: p.goal === 'running' ? 'Controlled two-step jump' : p.goal === 'repeated' ? 'Low repeated jumps' : 'Submaximal vertical jump',
    instructions: 'Warm up first. Use a clear level surface, land quietly with control, and reset. Stop if landings deteriorate.',
    sets, baseSets, reps: p.goal === 'repeated' ? 5 : 3, loadKg: null, effort: 'Easy to moderate; quality before height', restSeconds: 120,
  };
  const calf: Exercise = { id: 'calf', name: 'Calf raise', instructions: 'Rise slowly, pause, and lower with control using support for balance.', sets, baseSets, reps: 8, loadKg: null, effort: 'Leave 3 repetitions in reserve', restSeconds: 60 };
  return { version: RULES, week, sessions: days.map(d => ({ id: `w${week}-d${d}`, day: d, scheduledOn: scheduledDate(p, d, week), startHour: p.startHour, minutes,
    exercises: [strength, ...(p.limitation === 'no-impact' ? [] : [jump]), calf].map(e => ({ ...e })) })).sort((a, b) => a.scheduledOn.localeCompare(b.scheduledOn)),
    explanation: `${deload ? 'Deload: fewer sets. ' : ''}Includes 5-minute easy warmup and 3-minute cooldown. At least one rest day between hard sessions. ${p.limitation === 'no-impact' ? 'Impact work omitted.' : ''}` };
}
export type Feedback = { id?: string; completed: boolean; effort: number | null; recovery: 'good' | 'fatigued' | null; pain: boolean };
export type Change = { version: typeof RULES; reason: string; plan: Plan };
export function adapt(plan: Plan, observations: Feedback[], reliableTrends: { typeCompatible: boolean; validated: boolean; count: number; changeFraction: number } | null, schedule?: { notBefore: string; deloadIds: string[] }): Change {
  if (observations.some(o => (o.effort !== null && (!Number.isInteger(o.effort) || o.effort < 1 || o.effort > 10)) ||
    (o.recovery !== null && !['good', 'fatigued'].includes(o.recovery)))) throw Error('Check effort and recovery feedback.');
  if (schedule && !validDate(schedule.notBefore)) throw Error('Invalid next-week start date.');
  const usedIds = new Set(plan.usedObservationIds?.map(id => id.toLowerCase()));
  const fresh = new Map<string, Feedback>();
  for (const observation of observations) {
    const id = observation.id?.toLowerCase();
    if (id && !usedIds.has(id) && !fresh.has(id)) fresh.set(id, observation);
  }
  const comfortable = (o: Feedback) => o.completed && o.effort !== null && o.effort <= 6 && o.recovery === 'good';
  const deloadFeedback = (schedule?.deloadIds ?? []).flatMap(id => {
    const observation = fresh.get(id.toLowerCase());
    return observation ? [observation] : [];
  });
  const restoreVolume = plan.week % 4 === 0 && deloadFeedback.length > 0 && deloadFeedback.every(comfortable);
  let factor = 1, reason = 'Hold: insufficient evidence; missing sessions are not failures.';
  if (observations.some(o => o.pain || o.recovery === 'fatigued')) { factor = 0; reason = 'Stop/modify: pain or unusual fatigue. No automatic escalation; review before resuming.'; }
  else if (plan.week % 4 === 3) { factor = 0.5; reason = 'Planned deload: reduce future sets; no catch-up sessions.'; }
  else if (restoreVolume) { reason = 'Return to baseline volume after deload; hold loads.'; }
  else if (plan.week % 4 !== 0 && fresh.size >= 3 && [...fresh.values()].slice(-3).every(comfortable)) {
    // Experimental measurements are deliberately excluded. Trends can hold/reduce, never accelerate progression.
    if (reliableTrends?.validated && reliableTrends.typeCompatible && reliableTrends.count >= 3 && reliableTrends.changeFraction < -0.05) {
      factor = 0.8; reason = 'Reduce future volume: repeated compatible validated decline.';
    } else { factor = 1.025; reason = 'Three comfortable completed sessions: at most 2.5% load increase; no added contacts.'; }
  } else if (observations.length && observations.slice(-2).filter(o => o.effort !== null && o.effort >= 9).length >= 2) { factor = 0.8; reason = 'Reduce future volume after two high-effort sessions.'; }
  const oneWeek = 7 * 86400000;
  const earliest = Math.min(...plan.sessions.map(s => Date.parse(s.scheduledOn)));
  const weeksToMove = Math.max(1, schedule ? Math.ceil((Date.parse(schedule.notBefore) - earliest) / oneWeek) : 1);
  const next: Plan = { ...plan, version: RULES, usedObservationIds: factor !== 1 || restoreVolume ? [...usedIds, ...fresh.keys()].slice(-1000) : plan.usedObservationIds,
    week: plan.week + 1, sessions: plan.sessions.map(s => ({ ...s, id: `w${plan.week + 1}-d${s.day}`, scheduledOn: new Date(Date.parse(s.scheduledOn) + weeksToMove * oneWeek).toISOString().slice(0, 10), exercises: s.exercises.map(e => ({ ...e,
    sets: factor === 0 ? 0 : factor < 1 ? e.sets === 0 ? 0 : Math.max(1, Math.floor(e.sets * factor)) : restoreVolume ? e.baseSets : e.sets,
    reps: factor > 1 && e.loadKg === null && e.id !== 'jump' ? Math.min(e.reps + 1, 8) : e.reps,
    loadKg: e.loadKg !== null && factor > 1 ? Math.min(MAX_LOAD_KG, Math.floor(e.loadKg * factor * 100) / 100) : e.loadKg,
  })) })), explanation: reason };
  return { version: RULES, reason, plan: next };
}
export type SetLog = { exerciseId: string; index: number; reps: number; loadKg: number | null; done: boolean };
export function validateLog(session: Session, logs: SetLog[]) {
  const seen = new Set<string>();
  for (const l of logs) {
    const e = session.exercises.find(e => e.id === l.exerciseId), key = `${l.exerciseId}/${l.index}`;
    if (!e || !Number.isInteger(l.index) || l.index < 0 || l.index >= e.sets || seen.has(key) ||
      !Number.isInteger(l.reps) || l.reps < 0 || l.reps > 100 || typeof l.done !== 'boolean' ||
      (l.loadKg !== null && (!Number.isFinite(l.loadKg) || l.loadKg < 0 || l.loadKg > MAX_LOAD_KG || e.id !== 'squat' || e.name === 'Chair squat'))) throw Error('Only valid prescribed sets can be logged.');
    seen.add(key);
  }
}
export function completedPrescription(session: Session, logs: SetLog[]): boolean {
  validateLog(session, logs);
  if (!session.exercises.some(e => e.sets > 0)) return false;
  return session.exercises.every(e => Array.from({ length: e.sets }, (_, index) => {
    const done = logs.find(s => s.exerciseId === e.id && s.index === index);
    return done?.done && done.reps >= e.reps && (e.loadKg === null || (done.loadKg !== null && done.loadKg >= e.loadKg));
  }).every(Boolean));
}
