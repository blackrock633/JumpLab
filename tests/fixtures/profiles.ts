import type { Feedback, Profile } from '../../src/core/training.ts';

export const profile: Profile = { goal: 'standing', experience: 'new', days: [1, 3, 5], practiceDays: [], startHour: 17, weeklyMinutes: 90, sessionMinutes: 40, equipment: 'none', weightKg: 70, displayUnits: 'kg', knownSquatKg: null, limitation: 'none', pain: false, startDate: '2026-11-16' };

export const feasibleProfiles = {
  base: profile,
  reorderedDays: { ...profile, days: [5, 1, 3] },
  oneSession: { ...profile, weeklyMinutes: 25 },
  dumbbells: { ...profile, equipment: 'dumbbells' },
  barbell: { ...profile, equipment: 'barbell', knownSquatKg: 80 },
  noImpact: { ...profile, limitation: 'no-impact' },
  noLoadedSquats: { ...profile, equipment: 'barbell', limitation: 'no-loaded-squats' },
  running: { ...profile, goal: 'running' },
  repeated: { ...profile, goal: 'repeated' },
  trained: { ...profile, experience: 'trained' },
  practice: { ...profile, practiceDays: [1] },
  progression: { ...profile, equipment: 'barbell', knownSquatKg: 100 },
  maximumKnownSquat: { ...profile, equipment: 'barbell', knownSquatKg: 500 },
  overdue: { ...profile, startDate: '2026-10-05' },
} satisfies Record<string, Profile>;

export const infeasibleProfiles: Profile[] = [
  { ...profile, days: [] }, { ...profile, practiceDays: [0, 1, 2, 3, 4, 5, 6] },
  { ...profile, sessionMinutes: 10 }, { ...profile, weeklyMinutes: 20 }, { ...profile, pain: true },
];

export const good: Feedback = { completed: true, effort: 5, recovery: 'good', pain: false };
export const comfortableWorkouts = [1, 2, 3].map(index => ({ ...good, id: `a09a1b00-25d8-4ef8-96b0-400b846238e${index}` }));
