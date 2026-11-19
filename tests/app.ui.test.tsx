import React from 'react';
import { Alert, Linking } from 'react-native';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react-native';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import App from '../App';
import { eraseDeletedSession, offlineSessionOwner, supabase } from '../src/data/auth';
import * as store from '../src/data/store';
import { generate, type Profile } from '../src/core/training';
import type { WorkoutRecord } from '../src/screens/Workout';
import { measurement } from '../src/core/measurement';
import Native, { type AnalysisReceipt } from '../modules/jump-analysis/src';
jest.mock('../modules/jump-analysis/src', () => ({ __esModule: true, default: { pick: jest.fn(), analyze: jest.fn(), cancel: jest.fn(), discard: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native'); return { SafeAreaProvider: View, SafeAreaView: View };
});
jest.mock('../src/data/auth', () => ({ configured: true, eraseDeletedSession: jest.fn().mockResolvedValue(undefined), offlineSessionOwner: jest.fn().mockResolvedValue('A'), AUTH_REDIRECT: 'jumplab://auth/callback', supabase: { auth: { getSession: jest.fn(), signInWithPassword: jest.fn(), onAuthStateChange: jest.fn(), signOut: jest.fn().mockResolvedValue({ error: null }), exchangeCodeForSession: jest.fn().mockResolvedValue({ error: null }), startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn() } } }));
jest.mock('../src/data/store', () => ({ UnsyncedAccount: class extends Error {}, records: jest.fn(), save: jest.fn(), saveBatch: jest.fn().mockResolvedValue(undefined), sync: jest.fn().mockResolvedValue(undefined), commitAnalysis: jest.fn(), eraseLocalAccount: jest.fn().mockResolvedValue(undefined), signOutStatus: jest.fn().mockResolvedValue(null), beginSignOut: jest.fn().mockResolvedValue(undefined), clearSignOut: jest.fn().mockResolvedValue(undefined), deletionStatus: jest.fn().mockResolvedValue(null), clearDeletion: jest.fn().mockResolvedValue(undefined), confirmDeletion: jest.fn().mockResolvedValue(undefined), recoverAnalysis: jest.fn().mockResolvedValue(null), hydrate: jest.fn().mockResolvedValue([]), pending: jest.fn().mockResolvedValue([]), switchAccount: jest.fn().mockResolvedValue(undefined), cachedAccount: jest.fn().mockResolvedValue('A') }));
const p: Profile = { goal: 'standing', experience: 'new', days: [1, 3], practiceDays: [], startHour: 17, weeklyMinutes: 60, sessionMinutes: 30, equipment: 'none', weightKg: 70, displayUnits: 'kg', knownSquatKg: null, limitation: 'none', pain: false, startDate: '2026-11-16' };
const a = { user: { id: 'A' } } as Session;
let listener: (event: AuthChangeEvent, next: Session | null) => void;
beforeEach(() => {
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
  jest.mocked(store.pending).mockResolvedValue([]);
  jest.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: a }, error: null });
  jest.mocked(supabase.auth.onAuthStateChange).mockImplementation(callback => {
    listener = callback; return { data: { subscription: { unsubscribe: jest.fn() } } } as never;
  });
  jest.mocked(store.records).mockImplementation(async (owner, kind) => {
    const payload = owner === 'A' ? kind === 'profile' ? p : kind === 'plan' ? { ...generate(p), explanation: 'PRIVATE_A_PROGRAM' } : null : null;
    return payload ? [{ id: 'local', owner, kind, payload, revision: 1 }] as never : [];
  });
});
afterEach(() => jest.restoreAllMocks());
test('account switching gates rendering until that account cache loads (UI mocks only)', async () => {
  await render(<App />); await screen.findByText(/PRIVATE_A_PROGRAM/);
  await act(() => listener('SIGNED_IN', { user: { id: 'B' } } as Session));
  await screen.findByText('Make room to jump');
  expect(screen.queryByText(/PRIVATE_A_PROGRAM/)).toBeNull();
  expect(store.switchAccount).toHaveBeenCalledWith('B');
});
test('retryable session refresh exposes the already signed-in cached plan offline (UI mocks only)', async () => {
  jest.mocked(supabase.auth.getSession).mockResolvedValueOnce({ data: { session: null }, error: { name: 'AuthRetryableFetchError' } } as never);
  await render(<App />); await screen.findByText(/PRIVATE_A_PROGRAM/);
  expect(store.cachedAccount).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Cached work is available offline/)).toBeTruthy();
});
test('cold-start storage failure offers a working retry without clearing saved work (UI mocks only)', async () => {
  jest.mocked(supabase.auth.getSession).mockRejectedValueOnce(Error('Keychain unavailable'));
  await render(<App />); await screen.findByText(/Unlock this iPhone and retry/);
  expect(store.switchAccount).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.getByText(/PRIVATE_A_PROGRAM/)).toBeTruthy());
});

test('fresh-cache hydration failure prevents duplicate onboarding', async () => {
  jest.mocked(store.records).mockResolvedValue([]);
  jest.mocked(store.hydrate).mockRejectedValueOnce(Error('offline'));
  await render(<App />);
  await screen.findByText(/Reconnect to check for your existing training profile/);
  expect(screen.queryByText('Make room to jump')).toBeNull();
});

test('a confirmed deletion survives restart and retries failed secure cleanup', async () => {
  jest.mocked(store.deletionStatus).mockResolvedValueOnce({ owner: 'A', confirmed: 1 });
  jest.mocked(eraseDeletedSession).mockRejectedValueOnce(Error('Unlock and retry'));
  await render(<App />);
  await screen.findByText('Account deletion pending');
  expect(screen.queryByText(/PRIVATE_A_PROGRAM/)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Retry account deletion' }));
  await screen.findByText('Unlock and retry');
  expect(store.clearDeletion).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Retry account deletion' }));
  await screen.findByText('Account and private local data were erased.');
  expect(store.confirmDeletion).not.toHaveBeenCalled();
  expect(store.clearDeletion).toHaveBeenCalledWith('A');
});

test('cold-start custom-scheme callback reaches the PKCE exchange', async () => {
  jest.mocked(Linking.getInitialURL).mockResolvedValueOnce('jumplab://auth/callback?code=abcdefghijklmnop123');
  await render(<App />);
  await waitFor(() => expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('abcdefghijklmnop123'));
});

test('retryable refresh of B never opens the retained A cache', async () => {
  jest.mocked(supabase.auth.getSession).mockResolvedValueOnce({ data: { session: null }, error: { name: 'AuthRetryableFetchError' } } as never);
  jest.mocked(offlineSessionOwner).mockResolvedValueOnce('B');
  await render(<App />);
  await screen.findByRole('button', { name: 'Log in' });
  expect(store.switchAccount).not.toHaveBeenCalled();
  expect(screen.queryByText(/PRIVATE_A_PROGRAM/)).toBeNull();
});

test('failed password login protects private cached work and a successful retry reopens it', async () => {
  jest.mocked(supabase.auth.getSession).mockResolvedValueOnce({ data: { session: null }, error: null });
  jest.mocked(supabase.auth.signInWithPassword)
    .mockResolvedValueOnce({ data: { user: null, session: null }, error: { message: 'Invalid credentials' } } as never)
    .mockImplementationOnce(async () => {
      listener('SIGNED_IN', a);
      return { data: { user: a.user, session: a }, error: null };
    });
  await render(<App />);
  await screen.findByRole('button', { name: 'Log in' });
  await fireEvent.changeText(screen.getByLabelText('Email'), 'example@example.com');
  await fireEvent.changeText(screen.getByLabelText('Password (at least 12 characters)'), 'incorrect-password');
  await fireEvent.press(screen.getByRole('button', { name: 'Log in' }));
  await screen.findByText('Login failed. Check your email and password and try again.');
  expect(screen.queryByText(/PRIVATE_A_PROGRAM/)).toBeNull();
  expect(store.switchAccount).not.toHaveBeenCalled();
  expect(store.records).not.toHaveBeenCalled();
  expect(store.eraseLocalAccount).not.toHaveBeenCalled();

  await fireEvent.changeText(screen.getByLabelText('Password (at least 12 characters)'), 'corrected-password');
  await fireEvent.press(screen.getByRole('button', { name: 'Log in' }));
  await screen.findByText(/PRIVATE_A_PROGRAM/);
  expect(supabase.auth.signInWithPassword).toHaveBeenLastCalledWith({ email: 'example@example.com', password: 'corrected-password' });
  expect(store.switchAccount).toHaveBeenCalledWith('A');
  expect(store.eraseLocalAccount).not.toHaveBeenCalled();
});

test.each([[25, '2026-11-27', 'cached'], [50, '2026-11-20', 'cached'], [25, '2026-11-27', 'downloaded']])(
  'a %d-minute weekly budget schedules Friday on %s when Monday’s completion is %s',
  async (weeklyMinutes, scheduledOn, history) => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 10, 17, 12));
    try {
      const initial = { ...p, days: [1], weeklyMinutes };
      const plan = generate(initial);
      const monday = { ...plan.sessions[0]!, prescriptionId: 'monday-prescription', workoutId: 'monday-workout' };
      const completedAt = new Date(2026, 10, 16, 18).toISOString();
      const completed = { prescriptionId: monday.prescriptionId, completed: true, completedAt, updatedAt: completedAt, sets: [{ done: true }] };
      let cached = history === 'cached';
      if (!cached) jest.mocked(store.hydrate).mockImplementationOnce(async () => {
        cached = true;
        return [{ id: monday.workoutId, user_id: 'A', revision: 1, created_at: completedAt, data: completed }];
      });
      jest.mocked(store.records).mockImplementation(async (owner, kind) => {
        const payload = kind === 'profile' ? initial : kind === 'plan' ? { ...plan, sessions: [monday] } : kind === 'workout' && cached ? completed : null;
        return payload ? [{ id: kind === 'workout' ? monday.workoutId : kind, owner, kind, payload, revision: 1 }] as never : [];
      });
      await render(<App />);
      await fireEvent.press(await screen.findByRole('button', { name: 'Edit training profile' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Monday' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Friday' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Save profile and future plan' }));
      await waitFor(() => expect(store.saveBatch).toHaveBeenCalledWith('A', [
        expect.objectContaining({ kind: 'profile', payload: expect.objectContaining({ weeklyMinutes, days: [5] }) }),
        expect.objectContaining({ kind: 'plan', payload: expect.objectContaining({
          sessions: [expect.objectContaining({ scheduledOn, minutes: 25 })],
        }) }),
      ]));
      await fireEvent.press(await screen.findByRole('button', { name: 'Progress' }));
      await screen.findByRole('button', { name: /Completed.*1 sets done/ });
      expect(store.save).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
  },
);

test('interrupted initial workout history defers a Monday-to-Friday edit even after restart', async () => {
  jest.useFakeTimers({ now: new Date(2026, 10, 17, 12) });
  try {
    const initial = { ...p, days: [1], weeklyMinutes: 25 };
    const plan = generate(initial);
    let cached = false;
    jest.mocked(store.records).mockImplementation(async (owner, kind) => {
      const payload = !cached ? null : kind === 'profile' ? initial : kind === 'plan' ? plan : null;
      return payload ? [{ id: kind, owner, kind, payload, revision: 1 }] as never : [];
    });
    jest.mocked(store.hydrate).mockImplementationOnce(async () => {
      cached = true; // The profile and plan committed before the workout request failed.
      throw Error('Monday completion was not downloaded');
    }).mockRejectedValueOnce(Error('Still offline after restart'));

    const firstLaunch = await render(<App />);
    await screen.findByRole('button', { name: /^2026-11-16/ });
    await firstLaunch.unmount();
    await render(<App />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Edit training profile' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Monday' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Friday' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save profile and future plan' }));
    await waitFor(() => expect(store.saveBatch).toHaveBeenCalledWith('A', [
      expect.objectContaining({ kind: 'profile', payload: expect.objectContaining({ startDate: '2026-11-23', days: [5] }) }),
      expect.objectContaining({ kind: 'plan', payload: expect.objectContaining({
        changeReason: expect.stringMatching(/history could not be refreshed/),
        sessions: [expect.objectContaining({ scheduledOn: '2026-11-27', minutes: 25 })],
      }) }),
    ]));
    expect(store.hydrate).toHaveBeenNthCalledWith(2, 'A', 'workout', expect.any(String));
  } finally { jest.useRealTimers(); }
});

test.each(['error', 'conflict'] as const)('a plan in %s keeps the log in history and blocks resume in Today and Progress', async outcome => {
  jest.useFakeTimers({ now: new Date(2026, 10, 16, 17) });
  try {
    const plan = generate(p);
    const session = { ...plan.sessions[0]!, workoutId: 'draft-workout', prescriptionId: 'draft-prescription' };
    let log: WorkoutRecord | undefined;
    let state: store.PendingStatus['state'] = 'retry';
    jest.mocked(store.pending).mockImplementation(async () => [
      { id: 'A', owner: 'A', kind: 'profile', revision: 0, attempts: 1, state, replacement: { id: 'draft' } },
    ]);
    jest.mocked(store.records).mockImplementation(async (owner, kind) => {
      const row = (id: string, payload: unknown) => ({ id, owner, kind, payload, revision: 0 });
      if (kind === 'profile') return [row('A', p)] as never;
      if (kind === 'plan') return [row('draft', { ...plan, sessions: [session] })] as never;
      if (kind === 'workout' && log) return [row(session.workoutId, log)] as never;
      return [];
    });
    jest.mocked(store.save).mockImplementation(async (_owner, _kind, payload) => {
      log = payload as WorkoutRecord;
      return session.workoutId;
    });
    jest.mocked(store.sync).mockImplementationOnce(async () => { state = outcome; });
    await render(<App />);
    await fireEvent.press(await screen.findByRole('button', { name: /^2026-11-16/ }));
    await fireEvent.press(screen.getAllByRole('button', { name: 'Set 1: mark done' })[0]!);
    await screen.findByRole('button', { name: 'Set 1: done' });
    await fireEvent.press(screen.getByRole('button', { name: 'Progress' }));
    await fireEvent.press(screen.getByRole('button', { name: /In progress.*1 sets done/ }));
    await screen.findByRole('button', { name: 'Set 1: done' });
    await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Refresh and retry pending changes' }));
    await screen.findByText(new RegExp(`profile: ${outcome}`));
    await fireEvent.press(screen.getByRole('button', { name: 'Today' }));
    expect(screen.queryByRole('button', { name: /^Resume workout|^2026-11-16/ })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Progress' }));
    expect(screen.queryByRole('button', { name: /In progress.*1 sets done/ })).toBeNull();
    expect(screen.getByText(/In progress.*1 sets done.*Saved history only/)).toBeTruthy();
    expect(store.save).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

test.each(['routine edit', 'pain pause', 'no-impact restriction', 'edit of an unpublished plan'])(
  'a %s keeps the started workout log and applies the new profile immediately',
  async edit => {
    jest.useFakeTimers({ now: new Date(2026, 10, 16, 17) });
    try {
      const plan = generate(p);
      const original = { ...plan.sessions[0]!, workoutId: 'original-workout', prescriptionId: 'original-prescription' };
      const unpublished = edit === 'edit of an unpublished plan';
      if (unpublished) jest.mocked(store.pending).mockResolvedValue([
        { id: 'A', owner: 'A', kind: 'profile', state: 'pending', revision: 0, attempts: 0, replacement: { id: 'original' } },
      ]);
      let savedProfile = p;
      let savedWorkout: WorkoutRecord | undefined;
      let replacement: unknown;
      jest.mocked(store.records).mockImplementation(async (owner, kind) => {
        const row = (id: string, payload: unknown) => ({ id, owner, kind, payload, revision: 1 });
        if (kind === 'profile') return [row('A', savedProfile)] as never;
        if (kind === 'plan') return [
          ...(replacement ? [row('replacement', replacement)] : []),
          { ...row('original', { ...plan, sessions: [original] }), revision: unpublished ? 0 : 1 },
        ] as never;
        if (kind === 'workout' && savedWorkout) return [row(original.workoutId, savedWorkout)] as never;
        return [];
      });
      jest.mocked(store.save).mockImplementation(async (_owner, _kind, payload, id) => {
        savedWorkout = payload as WorkoutRecord;
        return id!;
      });
      jest.mocked(store.saveBatch).mockImplementationOnce(async (_owner, values) => {
        if (unpublished) throw Error('Sync this plan in Settings before replacing it so its saved workouts can still sync.');
        savedProfile = values[0]!.payload as Profile;
        replacement = values[1]?.payload;
      });
      await render(<App />);
      await fireEvent.press(await screen.findByRole('button', { name: /^2026-11-16/ }));
      await fireEvent.press(screen.getAllByRole('button', { name: 'Set 1: mark done' })[0]!);
      await screen.findByRole('button', { name: 'Set 1: done' });
      await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Edit profile' }));
      if (edit === 'routine edit' || unpublished) {
        await fireEvent.changeText(screen.getByLabelText('Body weight (kg)'), '72');
      } else if (edit === 'pain pause') {
        await fireEvent.press(screen.getByRole('button', { name: 'Current pain: no' }));
      } else {
        await fireEvent.press(screen.getByRole('button', { name: 'no-impact' }));
      }
      await fireEvent.press(screen.getByRole('button', { name: 'Save profile and future plan' }));
      if (unpublished) {
        await screen.findByText(/Sync this plan in Settings before replacing it/);
        expect(store.saveBatch).toHaveBeenCalledTimes(1);
        await fireEvent.press(screen.getByRole('button', { name: 'Cancel profile edit' }));
        await fireEvent.press(screen.getByRole('button', { name: /^2026-11-16/ }));
        expect(screen.getByRole('button', { name: 'Set 1: done' })).toBeTruthy();
        return;
      }
      await screen.findByText('Your week');
      if (edit === 'routine edit') {
        expect(savedProfile.weightKg).toBe(72);
        expect(savedProfile.startDate).toBe('2026-11-19');
        await fireEvent.press(await screen.findByRole('button', { name: /^Resume workout/ }));
        expect(screen.getByRole('button', { name: 'Set 1: done' })).toBeTruthy();
        await fireEvent.press(screen.getByRole('button', { name: 'Finish workout' }));
        await screen.findByText('Completed workout');
        expect(store.save).toHaveBeenLastCalledWith('A', 'workout', expect.objectContaining({
          completed: true, prescriptionId: original.prescriptionId, sets: expect.arrayContaining([expect.objectContaining({ done: true })]),
        }), original.workoutId);
      } else {
        expect(screen.queryByRole('button', { name: /^Resume workout/ })).toBeNull();
        await fireEvent.press(screen.getByRole('button', { name: 'Progress' }));
        await fireEvent.press(screen.getByRole('button', { name: /In progress.*1 sets done/ }));
        await screen.findByText(/current training profile pauses or restricts this workout/);
        expect(store.save).toHaveBeenCalledTimes(1);
        if (edit === 'pain pause') {
          expect(savedProfile.pain).toBe(true);
          expect(store.hydrate).not.toHaveBeenCalled();
        } else expect(savedProfile.limitation).toBe('no-impact');
      }
    } finally {
      jest.mocked(store.pending).mockResolvedValue([]);
      jest.useRealTimers();
    }
  },
);

test('terminal session loss hides A and a different login cannot discard A’s pending work implicitly', async () => {
  await render(<App />); await screen.findByText(/PRIVATE_A_PROGRAM/);
  await act(() => listener('SIGNED_OUT', null));
  await screen.findByRole('button', { name: 'Log in' });
  expect(screen.queryByText(/PRIVATE_A_PROGRAM/)).toBeNull();
  expect(store.switchAccount).not.toHaveBeenCalledWith(null);
  expect(store.eraseLocalAccount).not.toHaveBeenCalled();
  jest.mocked(store.switchAccount).mockRejectedValueOnce(new store.UnsyncedAccount());
  await act(() => listener('SIGNED_IN', { user: { id: 'B' } } as Session));
  await screen.findByRole('button', { name: 'Sign out to recover saved work' });
  expect(screen.queryByText(/PRIVATE_A_PROGRAM/)).toBeNull();
  expect(store.records).not.toHaveBeenCalledWith('B', expect.anything());
  await fireEvent.press(screen.getByRole('button', { name: 'Sign out to recover saved work' }));
  await screen.findByRole('button', { name: 'Log in' });
  await act(() => listener('SIGNED_IN', a));
  await screen.findByText(/PRIVATE_A_PROGRAM/);
});

test('pending deletion for A allows sign-out from B after cold start', async () => {
  jest.mocked(store.deletionStatus).mockResolvedValueOnce({ owner: 'A', confirmed: 0 });
  jest.mocked(supabase.auth.getSession).mockResolvedValueOnce({ data: { session: { user: { id: 'B' } } as Session }, error: null });
  await render(<App />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Sign out of this account' }));
  await screen.findByRole('button', { name: 'Sign in to resume deletion' });
  expect(store.eraseLocalAccount).not.toHaveBeenCalled();
  expect(store.confirmDeletion).not.toHaveBeenCalled();
});

test('the second scheduled day opens and saves a prescribed workout after the first completion', async () => {
  jest.useFakeTimers({ now: new Date(2026, 10, 18, 17) });
  const plan = { ...generate(p), sessions: generate(p).sessions.map((s, i) => ({ ...s, workoutId: 'w' + i, prescriptionId: 'p' + i })) };
  jest.mocked(store.records).mockImplementation(async (_owner, kind) => {
    if (kind === 'profile') return [{ id: 'a', payload: p, revision: 1 }] as never;
    if (kind === 'plan') return [{ id: 'plan', payload: plan, revision: 1 }] as never;
    if (kind === 'workout') return [{ id: 'w0', payload: { completed: true, completedAt: new Date(2026, 10, 16, 17).toISOString() } }] as never;
    return [];
  });
  jest.mocked(store.save).mockResolvedValue('w1');
  try {
    await render(<App />);
    await fireEvent.press(await screen.findByRole('button', { name: /^2026-11-18/ }));
    await screen.findByText('Your prescribed workout');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Set 1: mark done' })[0]!);
    await waitFor(() => expect(store.save).toHaveBeenCalledWith('A', 'workout', expect.objectContaining({ prescriptionId: 'p1' }), 'w1'));
  } finally { jest.useRealTimers(); }
});

test('restart keeps confirmed sign-out private and retries each interrupted erase step', async () => {
  jest.mocked(store.signOutStatus).mockResolvedValueOnce({ owner: 'A' });
  jest.mocked(store.eraseLocalAccount).mockRejectedValueOnce(Error('Receipt cleanup failed'));
  jest.mocked(eraseDeletedSession).mockRejectedValueOnce(Error('Keychain cleanup failed'));
  jest.mocked(offlineSessionOwner).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
  jest.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null });
  await render(<App />);
  await screen.findByText('Receipt cleanup failed');
  expect(screen.queryByRole('button', { name: 'Log in' })).toBeNull();
  expect(eraseDeletedSession).not.toHaveBeenCalled();
  expect(store.clearSignOut).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Retry sign out' }));
  await screen.findByText('Keychain cleanup failed');
  expect(store.clearSignOut).not.toHaveBeenCalled();
  expect(store.switchAccount).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Retry sign out' }));
  await screen.findByRole('button', { name: 'Log in' });
  expect(store.clearSignOut).toHaveBeenCalledWith('A');
  expect(store.eraseLocalAccount).toHaveBeenCalledTimes(3);
});

test('a confirmed erase from A does not sign out a newer B session after restart', async () => {
  jest.mocked(store.signOutStatus).mockResolvedValueOnce({ owner: 'A' });
  jest.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { user: { id: 'B' } } as Session }, error: null });
  await render(<App />);
  await screen.findByText('Make room to jump');
  expect(store.eraseLocalAccount).toHaveBeenCalledWith('A');
  expect(eraseDeletedSession).not.toHaveBeenCalled();
  expect(store.clearSignOut).toHaveBeenCalledWith('A');
  expect(store.switchAccount).toHaveBeenCalledWith('B');
});

test('an incoming account link cannot exchange a code during a pending sign-out erase', async () => {
  jest.mocked(store.signOutStatus).mockResolvedValueOnce({ owner: 'A' }).mockResolvedValueOnce({ owner: 'A' });
  jest.mocked(Linking.getInitialURL).mockResolvedValueOnce('jumplab://auth/callback?code=disposable-test-code');
  jest.mocked(store.eraseLocalAccount).mockRejectedValueOnce(Error('Receipt cleanup failed'));
  await render(<App />);
  await screen.findByRole('button', { name: 'Retry sign out' });
  expect(store.signOutStatus).toHaveBeenCalledTimes(2);
  expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  expect(store.switchAccount).not.toHaveBeenCalled();
});

test('Today keeps the unstarted final-day workout available after a rollover attempt', async () => {
  jest.useFakeTimers({ now: new Date(2026, 10, 18, 17) });
  const plan = { ...generate(p), sessions: generate(p).sessions.map((s, i) => ({ ...s, workoutId: 'w' + i, prescriptionId: 'p' + i })) };
  jest.mocked(store.records).mockImplementation(async (_owner, kind) => {
    if (kind === 'profile') return [{ id: 'a', payload: p, revision: 1 }] as never;
    if (kind === 'plan') return [{ id: 'plan', payload: plan, revision: 1 }] as never;
    return [];
  });
  try {
    await render(<App />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Prepare next week' }));
    await screen.findByText(/Complete today’s final workout/);
    expect(store.save).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: /^2026-11-18/ }));
    await screen.findByText('Your prescribed workout');
  } finally { jest.useRealTimers(); }
});

test('explicit sign-out records the erase intent before touching Auth or private files', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(store.beginSignOut).mockRejectedValueOnce(Error('Could not record erasure'));
  await render(<App />);
  await screen.findByText(/PRIVATE_A_PROGRAM/);
  await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
  await act(() => alert.mock.calls.at(-1)?.[2]?.find(button => button.style === 'destructive')?.onPress?.());
  await screen.findByText('Could not record erasure');
  expect(store.eraseLocalAccount).not.toHaveBeenCalled();
  expect(eraseDeletedSession).not.toHaveBeenCalled();
  expect(store.clearSignOut).not.toHaveBeenCalled();
});

test('Today selects a plan from the current profile revision even if an older incompatible draft sorts first', async () => {
  const profile = { ...p, limitation: 'no-impact' as const, planBinding: true };
  const retained = { ...generate(profile), explanation: 'Accepted no-impact plan', profileRevision: 2 };
  const incompatible = { ...generate({ ...p, equipment: 'barbell' }), explanation: 'Obsolete barbell plan', profileRevision: 1 };
  jest.mocked(store.records).mockImplementation(async (owner, kind) => {
    if (kind === 'profile') return [{ id: owner, owner, kind, revision: 2, payload: profile }] as never;
    if (kind === 'plan') return [
      { id: 'older', owner, kind, revision: 1, payload: incompatible },
      { id: 'current', owner, kind, revision: 1, payload: retained },
    ] as never;
    return [];
  });
  await render(<App />);
  await screen.findByText(/Accepted no-impact plan/);
  expect(screen.queryByText(/Obsolete barbell plan/)).toBeNull();
});

function seedSavedJump() {
  const timestamps = Array.from({ length: 90 }, (_, i) => i / 60);
  const result = measurement('jump', 'standing', { takeoff: [timestamps[24]!, timestamps[25]!], landing: [timestamps[48]!, timestamps[49]!] },
    { originalFPS: 60, playbackFPS: 60, confirmedOriginal: true, kind: 'original', mappings: [], timestamps }, new Date().toISOString());
  const records = jest.mocked(store.records).getMockImplementation()!;
  jest.mocked(store.records).mockImplementation(async (owner, kind) => kind === 'jump' ?
    [{ id: result.id, owner, kind, revision: 1, payload: result }] as never : records(owner, kind));
}

test('Progress chart shows stored compatible measurements and labels the date range and units', async () => {
  seedSavedJump();
  await render(<App />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Progress' }));
  expect(screen.getByText(/last 90 days.*height in cm/)).toBeTruthy();
  expect(screen.getByText(/20 cm.*timing range/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'running' }));
  expect(screen.getByText(/No compatible results/)).toBeTruthy();
});

test('leaving Analyze cancels pending analysis and allows a new import without losing saved estimates', async () => {
  seedSavedJump();
  const clip = { id: 'first-clip', playbackFPS: 60, duration: 2, bytes: 1000, hasRetiming: false };
  jest.mocked(Native.pick).mockResolvedValueOnce(clip)
    .mockResolvedValueOnce({ ...clip, id: 'second-clip', playbackFPS: 120 });
  let rejectAnalysis!: (reason: Error) => void;
  const pendingAnalysis = new Promise<AnalysisReceipt>((_resolve, reject) => { rejectAnalysis = reject; });
  jest.mocked(Native.analyze).mockReturnValueOnce(pendingAnalysis);

  await render(<App />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Analyze' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Choose video' }));
  await fireEvent.press(await screen.findByRole('button', { name: /I confirm/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Analyze on iPhone' }));
  await screen.findByRole('button', { name: 'Cancel analysis' });
  expect(Native.analyze).toHaveBeenCalledWith(clip.id, 60, 'standing', true, 'A');
  expect(Native.cancel).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole('button', { name: 'Progress' }));
  expect(Native.cancel).toHaveBeenCalledTimes(1);
  expect(Native.discard).toHaveBeenCalledWith(clip.id);
  await act(() => rejectAnalysis(Error('Analysis cancelled or interrupted. Import again when ready.')));
  expect(store.commitAnalysis).not.toHaveBeenCalled();
  expect(screen.getAllByText(/20 cm.*timing range/)).toHaveLength(1);

  await fireEvent.press(screen.getByRole('button', { name: 'Analyze' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Choose video' })).toBeEnabled());
  await fireEvent.press(screen.getByRole('button', { name: 'Choose video' }));
  expect((await screen.findByLabelText('Original recording FPS')).props.value).toBe('120');
  expect(screen.getByRole('button', { name: 'Analyze on iPhone' })).toBeDisabled();
  expect(screen.queryByText(/Analysis cancelled|Estimated jump height:/)).toBeNull();
});
