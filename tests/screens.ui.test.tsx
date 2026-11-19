import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ProfileForm } from '../src/screens/ProfileForm';
import { Analyze } from '../src/screens/Analyze';
import { Workout } from '../src/screens/Workout';
import { generate, type Profile } from '../src/core/training';
import Native, { type AnalysisReceipt } from '../modules/jump-analysis/src';
import { commitAnalysis, CorruptAnalysis, recoverAnalysis } from '../src/data/store';
jest.mock('../modules/jump-analysis/src', () => ({ __esModule: true, default: { pick: jest.fn(), analyze: jest.fn(), cancel: jest.fn(), discard: jest.fn().mockResolvedValue(undefined), discardCorruptAnalysis: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('../src/data/store', () => ({
  CorruptAnalysis: class extends Error {},
  RejectedAnalysis: class extends Error {},
  recoverAnalysis: jest.fn().mockResolvedValue(null),
  commitAnalysis: jest.fn(async (_owner, r) => {
    const { acceptedMeasurements } = require('../src/core/measurement');
    return acceptedMeasurements(r.analysis, r.ids, r.type, r.fps, r.confirmed, r.createdAt);
  }),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'e03beac7-ff3d-4407-9943-e45143c04d0c' }));
const profile: Profile = { goal: 'standing', experience: 'new', days: [1, 3], practiceDays: [], startHour: 17, weeklyMinutes: 60, sessionMinutes: 30, equipment: 'none', weightKg: 70, displayUnits: 'kg', knownSquatKg: null, limitation: 'none', pain: false, startDate: '2026-11-16' };
test('onboarding allows unknown strength, canonical units and schedule validation', async () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  await render(<ProfileForm initial={profile} onSave={onSave} />);
  await fireEvent.press(screen.getByRole('button', { name: 'I don’t know my strength' }));
  await fireEvent.press(screen.getByRole('button', { name: 'lb' }));
  await fireEvent.changeText(screen.getByLabelText('Body weight (lb)'), '154.32358');
  await fireEvent.press(screen.getByRole('button', { name: 'Save profile and future plan' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0][0].knownSquatKg).toBeNull(); expect(onSave.mock.calls[0][0].weightKg).toBeCloseTo(70, 3);
});

test('damaged receipt can be discarded for this account and a new analysis can be saved', async () => {
  jest.mocked(recoverAnalysis).mockRejectedValueOnce(new CorruptAnalysis());
  jest.mocked(Native.pick).mockResolvedValue({ id: 'clip', playbackFPS: 60, duration: 2, bytes: 1000, hasRetiming: false });
  jest.mocked(Native.analyze).mockResolvedValue(testReceipt(Array.from({ length: 120 }, (_, i) => i / 60)));
  await render(<Analyze owner="A" onSaved={jest.fn()} />);
  await screen.findByText(/Saved estimates remain in Progress/);
  expect(screen.getByRole('button', { name: 'Choose video' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Discard damaged analysis' }));
  expect(Native.discardCorruptAnalysis).toHaveBeenCalledWith('A');
  await screen.findByText(/No estimates are waiting/);
  await fireEvent.press(screen.getByRole('button', { name: 'Choose video' }));
  await screen.findByLabelText('Original recording FPS');
  await fireEvent.press(screen.getByRole('button', { name: /I confirm/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Analyze on iPhone' }));
  await screen.findByText(/Estimated jump height:/);
});

test('temporary receipt read failure offers retry and cannot authorize discard', async () => {
  jest.mocked(recoverAnalysis).mockRejectedValueOnce(Error('Unlock this iPhone and retry saving.'));
  await render(<Analyze owner="A" onSaved={jest.fn()} />);
  await screen.findByText(/Unlock this iPhone/);
  expect(screen.queryByRole('button', { name: 'Discard damaged analysis' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Choose video' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Retry saving estimates' }));
  await screen.findByText(/No estimates are waiting/);
  expect(screen.getByRole('button', { name: 'Choose video' })).toBeEnabled();
  expect(Native.discardCorruptAnalysis).not.toHaveBeenCalled();
});
test('infeasible onboarding explains a retry without saving an invalid plan', async () => {
  const onSave = jest.fn(); await render(<ProfileForm initial={{ ...profile, days: [] }} onSave={onSave} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Save profile and future plan' }));
  await screen.findByText(/No recovery-safe training day/); expect(onSave).not.toHaveBeenCalled();
});
test('picker cancellation and each jump type remain usable', async () => {
  jest.mocked(Native.pick).mockResolvedValue(null);
  await render(<Analyze owner="A" onSaved={jest.fn()} />);
  expect(screen.getByText(/fixed camera/)).toBeTruthy();
  for (const name of ['standing', 'running', 'repeated']) await fireEvent.press(screen.getByRole('button', { name }));
  await fireEvent.press(screen.getByRole('button', { name: 'Choose video' }));
  await screen.findByText(/Import cancelled/);
  expect(Native.analyze).not.toHaveBeenCalled(); expect(commitAnalysis).not.toHaveBeenCalled();
});
function testReceipt(timestamps: number[]): AnalysisReceipt {
  return { id: 'clip', ids: ['jump'], type: 'standing', fps: 60, confirmed: true, createdAt: '2026-11-17T00:00:00Z',
    analysis: { timestamps, playbackFPS: 60, events: [{ takeoff: [timestamps[30]!, timestamps[31]!], landing: [timestamps[54]!, timestamps[55]!] }], elapsedSeconds: 1, decodedFrames: 120, peakResidentBytes: 1000 } };
}
test('metadata FPS prefill, confirmation and automatic result flow (UI mock only)', async () => {
  jest.mocked(Native.pick).mockResolvedValue({ id: 'clip', playbackFPS: 60, duration: 2, bytes: 1000, hasRetiming: false });
  const timestamps = Array.from({ length: 120 }, (_, i) => i / 60);
  jest.mocked(Native.analyze).mockResolvedValue(testReceipt(timestamps));
  await render(<Analyze owner="A" onSaved={jest.fn()} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Choose video' }));
  await waitFor(() => expect(screen.getByLabelText('Original recording FPS').props.value).toBe('60'));
  await fireEvent.press(screen.getByRole('button', { name: /I confirm/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Analyze on iPhone' }));
  await screen.findByText(/Estimated jump height:/); expect(commitAnalysis).toHaveBeenCalledTimes(1);
  expect(Native.analyze).toHaveBeenCalledWith('clip', 60, 'standing', true, 'A');
  expect(jest.mocked(commitAnalysis).mock.calls[0]![1].ids).toEqual(['jump']);
});
test('analysis rejection saves no fabricated result and offers another import', async () => {
  jest.mocked(Native.pick).mockResolvedValue({ id: 'clip', playbackFPS: 30, duration: 2, bytes: 1000, hasRetiming: false });
  jest.mocked(Native.analyze).mockRejectedValue(Error('Feet hidden. Import a clearer clip.'));
  await render(<Analyze owner="A" onSaved={jest.fn()} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Choose video' }));
  await screen.findByLabelText('Original recording FPS'); await fireEvent.press(screen.getByRole('button', { name: /I confirm/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Analyze on iPhone' }));
  await screen.findByText(/Feet hidden/); expect(commitAnalysis).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Choose video' })).toBeEnabled();
});
test('prescribed set logging persists progress and pain stop/modify feedback', async () => {
  const onSave = jest.fn().mockResolvedValue(undefined), session = { ...generate(profile).sessions[0]!, prescriptionId: 'p', workoutId: 'w' };
  await render(<Workout session={session} onSave={onSave} paused={false} />);
  await fireEvent.press(screen.getAllByRole('button', { name: 'Set 1: mark done' })[0]!);
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave.mock.calls[0][0].sets[0].done).toBe(true);
  await fireEvent.press(screen.getByRole('button', { name: 'Pain: no' }));
  await screen.findByText(/Stop or modify today/);
  expect(onSave.mock.calls.at(-1)[0].pain).toBe(true);
});
test('failed estimate save remains unavailable until a stable-id retry succeeds (UI mock only)', async () => {
  jest.mocked(Native.pick).mockResolvedValue({ id: 'clip', playbackFPS: 60, duration: 2, bytes: 1000, hasRetiming: false });
  const timestamps = Array.from({ length: 120 }, (_, i) => i / 60);
  jest.mocked(Native.analyze).mockResolvedValue(testReceipt(timestamps));
  jest.mocked(commitAnalysis).mockRejectedValueOnce(Error('Could not save the estimates'));
  await render(<Analyze owner="A" onSaved={jest.fn()} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Choose video' }));
  await screen.findByLabelText('Original recording FPS');
  await fireEvent.press(screen.getByRole('button', { name: /I confirm/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Analyze on iPhone' }));
  await screen.findByText(/Could not save the estimates/);
  expect(screen.queryByText(/Estimated jump height:/)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Retry saving estimates' }));
  await screen.findByText(/Estimated jump height:/);
  expect(jest.mocked(commitAnalysis).mock.calls[0]).toEqual(jest.mocked(commitAnalysis).mock.calls[1]);
  expect(Native.analyze).toHaveBeenCalledTimes(1);
});

test('fractional load entry preserves the decimal and missing feedback through save', async () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const session = { ...generate({ ...profile, equipment: 'dumbbells' }).sessions[0]!, prescriptionId: 'p', workoutId: 'w' };
  await render(<Workout session={session} onSave={onSave} paused={false} />);
  const label = 'Set 1, load kg (blank = bodyweight or unknown)';
  await fireEvent.changeText(screen.getByLabelText(label), '20.');
  expect(screen.getByLabelText(label).props.value).toBe('20.');
  await fireEvent.changeText(screen.getByLabelText(label), '20.5');
  await fireEvent.press(screen.getByRole('button', { name: 'Finish workout' }));
  expect(onSave.mock.calls.at(-1)[0]).toMatchObject({ effort: null, recovery: null, completed: true });
  expect(onSave.mock.calls.at(-1)[0].sets[0].loadKg).toBe(20.5);
});
