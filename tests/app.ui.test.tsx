import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react-native';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import App from '../App';
import { eraseDeletedSession, supabase } from '../src/data/auth';
import * as store from '../src/data/store';
import { generate, type Profile } from '../src/core/training';
jest.mock('../modules/jump-analysis/src', () => ({ __esModule: true, default: { cancel: jest.fn(), discard: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native'); return { SafeAreaProvider: View, SafeAreaView: View };
});
jest.mock('../src/data/auth', () => ({ configured: true, eraseDeletedSession: jest.fn().mockResolvedValue(undefined), AUTH_REDIRECT: 'jumplab://auth/callback', supabase: { auth: { getSession: jest.fn(), onAuthStateChange: jest.fn(), exchangeCodeForSession: jest.fn().mockResolvedValue({ error: null }), startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn() } } }));
jest.mock('../src/data/store', () => ({ records: jest.fn(), deletionStatus: jest.fn().mockResolvedValue(null), clearDeletion: jest.fn().mockResolvedValue(undefined), confirmDeletion: jest.fn().mockResolvedValue(undefined), recoverAnalysis: jest.fn().mockResolvedValue(null), hydrate: jest.fn().mockResolvedValue(undefined), pending: jest.fn().mockResolvedValue([]), switchAccount: jest.fn().mockResolvedValue(undefined), cachedAccount: jest.fn().mockResolvedValue('A') }));
const p: Profile = { goal: 'standing', experience: 'new', days: [1, 3], practiceDays: [], startHour: 17, weeklyMinutes: 60, sessionMinutes: 30, equipment: 'none', weightKg: 70, displayUnits: 'kg', knownSquatKg: null, limitation: 'none', pain: false, startDate: '2026-11-16' };
const a = { user: { id: 'A' } } as Session;
let listener: (event: AuthChangeEvent, next: Session | null) => void;
beforeEach(() => {
  jest.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: a }, error: null });
  jest.mocked(supabase.auth.onAuthStateChange).mockImplementation(callback => {
    listener = callback; return { data: { subscription: { unsubscribe: jest.fn() } } } as never;
  });
  jest.mocked(store.records).mockImplementation(async (owner, kind) => {
    const payload = owner === 'A' ? kind === 'profile' ? p : kind === 'plan' ? { ...generate(p), explanation: 'PRIVATE_A_PROGRAM' } : null : null;
    return payload ? [{ id: 'local', owner, kind, payload, revision: 1 }] as never : [];
  });
});
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
  const initial = jest.spyOn(Linking, 'getInitialURL').mockResolvedValueOnce('jumplab://auth/callback?code=abcdefghijklmnop123');
  try {
    await render(<App />);
    await waitFor(() => expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('abcdefghijklmnop123'));
  } finally {
    initial.mockRestore();
  }
});
