import React from 'react';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react-native';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import App from '../App';
import { supabase } from '../src/data/auth';
import * as store from '../src/data/store';
import { generate, type Profile } from '../src/core/training';
jest.mock('../modules/jump-analysis/src', () => ({ __esModule: true, default: { cancel: jest.fn(), discard: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native'); return { SafeAreaProvider: View, SafeAreaView: View };
});
jest.mock('../src/data/auth', () => ({ configured: true, AUTH_REDIRECT: 'jumplab://auth/callback', supabase: { auth: { getSession: jest.fn(), onAuthStateChange: jest.fn(), startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn() } } }));
jest.mock('../src/data/store', () => ({ records: jest.fn(), pending: jest.fn().mockResolvedValue([]), switchAccount: jest.fn().mockResolvedValue(undefined), cachedAccount: jest.fn().mockResolvedValue('A') }));
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
