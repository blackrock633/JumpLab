import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, ScrollView, StatusBar, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { Session as AuthSession } from '@supabase/supabase-js';
import { randomUUID } from 'expo-crypto';
import { Appearance, Button, Choices, Copy, Field, styles, useTheme } from './src/screens/components';
import { ProfileForm } from './src/screens/ProfileForm';
import { Analyze } from './src/screens/Analyze';
import { Workout, type WorkoutRecord, type SavedSession } from './src/screens/Workout';
import { AUTH_REDIRECT, configured, eraseDeletedSession, supabase } from './src/data/auth';
import * as store from './src/data/store';
import { adapt, completedPrescription, futureProfile, generate, localDate, type Plan, type Profile } from './src/core/training';
import { compatible, displayHeight, LEGACY_METHOD, METHOD, type JumpResult, type JumpType } from './src/core/measurement';
import { recoveryCode } from './src/core/auth-link';

type SavedPlan = Omit<Plan, 'sessions'> & { sessions: SavedSession[]; changeReason?: string; programId?: string };
type Tab = 'Today' | 'Analyze' | 'Progress' | 'Settings';
function saveable(plan: Plan, reason: string, programId = randomUUID()): SavedPlan { return { ...plan, programId, changeReason: reason, sessions: plan.sessions.map(s => ({ ...s, prescriptionId: randomUUID(), workoutId: randomUUID() })) }; }
function Application() {
  const theme = useTheme();
  const [session, setSession] = useState<AuthSession | null>(null), [loaded, setLoaded] = useState(false), [ready, setReady] = useState(false);
  const [deletion, setDeletion] = useState<store.Deletion | null>(null);
  const [profileUnknown, setProfileUnknown] = useState(false);
  const [readyOwner, setReadyOwner] = useState<string | null>();
  const [offlineOwner, setOfflineOwner] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('Today'), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [recovering, setRecovering] = useState(false);
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [profiles, setProfiles] = useState<store.LocalRecord<Profile>[]>([]), [plans, setPlans] = useState<store.LocalRecord<SavedPlan>[]>([]);
  const [jumps, setJumps] = useState<store.LocalRecord<JumpResult>[]>([]), [workouts, setWorkouts] = useState<store.LocalRecord<WorkoutRecord>[]>([]), [queue, setQueue] = useState<store.PendingStatus[]>([]);
  const [selectedSession, setSelectedSession] = useState<SavedSession | null>(null), [editProfile, setEditProfile] = useState(false), [progressType, setProgressType] = useState<JumpType>('standing');
  const [progressMethod, setProgressMethod] = useState('Current'), [chartLimit, setChartLimit] = useState(30);
  const owner = session?.user.id ?? offlineOwner ?? undefined;
  const currentOwner = useRef(owner); currentOwner.current = owner;
  const profile = profiles[0]?.payload, plan = plans[0]?.payload;
  const paused = profile?.pain || plan?.sessions.every(s => s.exercises.every(e => e.sets === 0));
  async function read(account: string) {
    const [p, pl, j, w, q] = await Promise.all([store.records<Profile>(account, 'profile'), store.records<SavedPlan>(account, 'plan'), store.records<JumpResult>(account, 'jump'), store.records<WorkoutRecord>(account, 'workout'), store.pending(account)]);
    if (currentOwner.current !== account) return;
    setProfiles(p); setPlans(pl); setJumps(j); setWorkouts(w); setQueue(q);
  }
  async function action(fn: () => Promise<void>) { setBusy(true); setMessage(''); try { await fn(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Something went wrong. Your saved work is preserved. Try again.'); } finally { setBusy(false); } }
  async function restoreSession() {
    const pendingDeletion = await store.deletionStatus();
    const { data, error } = await supabase.auth.getSession();
    const cached = error?.name === 'AuthRetryableFetchError' ? await store.cachedAccount() : null;
    setDeletion(pendingDeletion); setSession(data.session); setOfflineOwner(cached); setLoaded(true);
    if (error) setMessage('Session could not refresh. Cached work is available offline; reconnect to sync.');
  }
  async function openAccount(account: string | null, active = () => true) {
    await store.switchAccount(account);
    if (!active() || !account) return;
    try { await store.recoverAnalysis(account); }
    catch (error) { if (active()) setMessage(error instanceof Error ? error.message : 'Previous analysis could not be recovered.'); }
    const cachedProfiles = await store.records<Profile>(account, 'profile');
    let unknown = false;
    if (cachedProfiles.length === 0) {
      try { await store.hydrate(account); }
      catch { unknown = true; }
    }
    if (active()) {
      setProfileUnknown(unknown);
      await read(account);
    }
  }
  useEffect(() => {
    void restoreSession().catch(() => setMessage('Session storage could not open. Unlock this iPhone and retry. Your saved work has not been erased.'));
    const { data } = supabase.auth.onAuthStateChange((event, next) => { setSession(next); if (next || event === 'SIGNED_OUT') setOfflineOwner(null); if (event === 'PASSWORD_RECOVERY') setRecovering(true); });
    const state = AppState.addEventListener('change', value => { if (value === 'active') supabase.auth.startAutoRefresh(); else supabase.auth.stopAutoRefresh(); });
    async function link(url: string) { await action(async () => { const code = recoveryCode(url); const { error } = await supabase.auth.exchangeCodeForSession(code); if (error) throw Error('This link is expired or belongs to another sign-in. Request a new link on this iPhone.'); }); }
    void Linking.getInitialURL().then(url => { if (url) void link(url); });
    const links = Linking.addEventListener('url', ({ url }) => { void link(url); });
    return () => { data.subscription.unsubscribe(); state.remove(); links.remove(); supabase.auth.stopAutoRefresh(); };
  }, []);
  useEffect(() => {
    if (!loaded || deletion) return;
    let active = true; setReady(false); setSelectedSession(null); setProfiles([]); setPlans([]); setJumps([]); setWorkouts([]); setQueue([]);
    void openAccount(owner ?? null, () => active).then(() => { if (active) { setReadyOwner(owner ?? null); setReady(true); } }).catch(() => setMessage('Private storage could not open. Restart and retry; work has not been reported as saved.'));
    return () => { active = false; };
  }, [loaded, owner, deletion]);

  async function refresh() {
    if (!owner) return;
    await action(async () => {
      await store.hydrate(owner, true);
      if (currentOwner.current !== owner) return;
      setProfileUnknown(false);
      try {
        await store.sync(owner);
        await store.hydrate(owner);
        const remaining = await store.pending(owner);
        setMessage(remaining.length ? 'Some changes still need attention. Check their status in Settings.' : 'Refreshed.');
      } finally { await read(owner); }
    });
  }
  async function saveProfile(p: Profile) {
    if (!owner) return;
    p = futureProfile(p, workouts.filter(w => w.payload.completed).map(w => w.payload.completedAt));
    const values: Parameters<typeof store.saveBatch>[1] = [{ kind: 'profile', payload: p, id: profiles[0]?.id ?? owner }];
    if (!p.pain) values.push({ kind: 'plan', payload: saveable(generate(p), 'Profile changed: regenerate future prescriptions; completed history retained.'), id: randomUUID() });
    await store.saveBatch(owner, values);
    await read(owner); setEditProfile(false); setTab('Today');
  }
  function logout() {
    if (!owner) return;
    void action(async () => {
      const unsynced = await store.pending(owner);
      if (currentOwner.current !== owner) return;
      Alert.alert('Sign out?', unsynced.length ? 'Unsynced work will be erased from this iPhone. Cancel to sync first.' : 'Private cached data will be erased from this iPhone.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Sign out and erase local data', style: 'destructive', onPress: () => void action(async () => {
          if (currentOwner.current !== owner) return;
          const { error } = await supabase.auth.signOut({ scope: 'local' }); if (error) throw Error('Sign out failed. Reconnect and try again.');
          await store.switchAccount(null); setSession(null);
        }) },
      ]);
    });
  }
  async function eraseAfterDeletion(pending: store.Deletion) {
    if (session && session.user.id !== pending.owner) throw Error('Sign out of the other account to resume deletion.');
    await store.switchAccount(null);
    await eraseDeletedSession(session, pending.owner);
    await store.clearDeletion(pending.owner);
    setOfflineOwner(null); setSession(null); setDeletion(null);
    setMessage(pending.confirmed ? 'Account and private local data were erased.' : 'Private data on this iPhone was erased. Cloud deletion could not be confirmed.');
  }
  async function finishDeletion(pending: store.Deletion) {
    if (!pending.confirmed) {
      if (!session || session.user.id !== pending.owner) throw Error('Sign in to the account being deleted to retry.');
      await store.confirmDeletion(pending.owner);
      pending = { ...pending, confirmed: 1 };
      setDeletion(pending);
    }
    await eraseAfterDeletion(pending);
  }
  function deleteAccount() {
    if (!owner) return;
    Alert.alert('Permanently delete your account?', 'This removes cloud records and your Auth account. Unsynced local work will also be erased. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Delete my account', style: 'destructive', onPress: () => void action(async () => {
        await store.markDeletion(owner);
        const pending = { owner, confirmed: 0 };
        setDeletion(pending);
        await finishDeletion(pending);
      }) },
    ]);
  }
  const completionDates = workouts.filter(w => w.payload.completed).map(w => w.payload.completedAt);
  const startWithoutCatchup = profile ? futureProfile({ ...profile, startDate: localDate() }, completionDates).startDate : localDate();
  const byWorkout = new Map(plans.flatMap(p => p.payload.sessions.map(s => [s.workoutId, s] as const)));
  const recent = tab === 'Progress' ? compatible(jumps.map(j => j.payload), progressType, progressMethod === 'Current' ? METHOD : LEGACY_METHOD).reverse() : [];
  return <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}><StatusBar barStyle={theme.bg === '#101D1A' ? 'light-content' : 'dark-content'} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Copy heading>JumpLab</Copy>
      {deletion ? <View><Copy heading>Account deletion pending</Copy>
        <Copy>{deletion.confirmed ? 'Finish erasing private data from this iPhone.' : 'Retry to confirm deletion with the account service.'}</Copy>
        {!session && !deletion.confirmed ? <View><Field label="Email" value={email} onChange={setEmail} /><Field label="Password" secret value={password} onChange={setPassword} />
          <Button title="Sign in to resume deletion" disabled={busy} onPress={() => void action(async () => {
            const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
            if (error) throw Error('Could not sign in. Retry with the account being deleted.');
            if (data.user?.id !== deletion.owner) {
              await supabase.auth.signOut({ scope: 'local' });
              throw Error('Use the account being deleted.');
            }
            setPassword('');
          })} /></View> : null}
        <Button title="Retry account deletion" disabled={busy} onPress={() => void action(() => finishDeletion(deletion))} />
        {!session && !deletion.confirmed ? <Button title="Erase private data on this iPhone" disabled={busy} onPress={() => Alert.alert(
          'Erase private data on this iPhone?', 'Cloud deletion remains unconfirmed. Unsynced local data will be erased.',
          [{ text: 'Cancel', style: 'cancel' }, { text: 'Erase local data', style: 'destructive', onPress: () => void action(() => eraseAfterDeletion(deletion)) }],
        )} /> : null}
      </View> : !loaded || !ready || readyOwner !== (owner ?? null) ? <View><Copy>Opening your saved work…</Copy><Button title="Retry" disabled={busy} onPress={() => void action(async () => { if (!loaded) { await restoreSession(); return; } await openAccount(owner ?? null); setReadyOwner(owner ?? null); setReady(true); })} /></View> : !owner ? <View>
        <Copy heading>Build your next jump</Copy><Copy>Individual training and experimental on-device jump estimates. Videos stay on your iPhone.</Copy>
        {!configured ? <Copy>Account service is not configured in this build. Setup is required before signing in.</Copy> : null}
        <Field label="Email" value={email} onChange={setEmail} /><Field label="Password (at least 12 characters)" secret value={password} onChange={setPassword} />
        <Button title="Log in" disabled={busy || !configured} onPress={() => void action(async () => { const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password }); if (error) throw Error('Login failed. Check your email and password and try again.'); setPassword(''); })} />
        <Button title="Create account" disabled={busy || !configured} onPress={() => void action(async () => { if (password.length < 12) throw Error('Use at least 12 characters.'); const { error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: AUTH_REDIRECT } }); if (error) throw Error('Signup could not finish. Check your email or try again later.'); setPassword(''); setMessage('Check your email to confirm your account on this iPhone.'); })} />
        <Button title="Recover password" disabled={busy || !configured} onPress={() => void action(async () => { const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: AUTH_REDIRECT }); if (error) throw Error('Recovery could not be sent. Try again later.'); setMessage('If that account exists, a recovery email has been sent. Open it on this iPhone.'); })} />
      </View> : recovering ? <View><Field label="New password (at least 12 characters)" secret value={password} onChange={setPassword} /><Button title="Update password" disabled={busy} onPress={() => void action(async () => { if (password.length < 12) throw Error('Use at least 12 characters.'); const { error } = await supabase.auth.updateUser({ password }); if (error) throw Error('Password update failed. Request a new recovery link.'); setPassword(''); setRecovering(false); })} /></View> : <View>
        <View style={styles.row}>{(['Today', 'Analyze', 'Progress', 'Settings'] as const).map(t => <Button key={t} title={t} selected={t === tab} onPress={() => { setTab(t); setSelectedSession(null); }} />)}</View>
        {queue.length ? <Copy>{queue.length} local changes pending. Offline work stays on this iPhone. Use Settings to retry sync.</Copy> : null}
        {tab === 'Analyze' ? <Analyze key={owner} owner={owner!} onSaved={() => void read(owner!)} /> : null}
        {tab === 'Today' ? !profile && profileUnknown ? <View><Copy>Reconnect to check for your existing training profile.</Copy><Button title="Retry loading profile" disabled={busy} onPress={() => void refresh()} /></View> : !profile || editProfile ? <ProfileForm key={owner} initial={profile} onSave={saveProfile} /> : selectedSession ? <View>
          <Button title="Back to plan" onPress={() => setSelectedSession(null)} />
          <Workout key={selectedSession.workoutId} session={selectedSession} paused={Boolean(paused)} initial={workouts.find(w => w.id === selectedSession.workoutId)?.payload}
            onSave={async w => {
              const id = await store.save(owner, 'workout', w, selectedSession.workoutId);
              if (currentOwner.current !== owner) return;
              setWorkouts(previous => {
                const prior = previous.find(record => record.id === id);
                return [{ id, owner, kind: 'workout', payload: w, revision: prior?.revision ?? 0 }, ...previous.filter(record => record.id !== id)];
              });
              const pending = await store.pending(owner);
              if (currentOwner.current === owner) setQueue(pending);
            }} />
        </View> : <View><Copy heading>Your week</Copy>
          {profile.pain || paused ? <Copy>Training paused. Stop or modify for pain or unusual fatigue. Review your profile and seek qualified guidance when needed.</Copy> : plan ? <View><Copy>Week {plan.week} · {plan.explanation}</Copy>
            {plan.sessions.map(s => <Button key={s.id} title={`${s.scheduledOn} ${s.startHour}:00 · ${s.minutes} min${workouts.find(w => w.id === s.workoutId)?.payload.completed ? ' · completed' : ''}`} disabled={!workouts.find(w => w.id === s.workoutId)?.payload.completed && (s.scheduledOn !== localDate() || s.scheduledOn < startWithoutCatchup)} onPress={() => setSelectedSession(s)} />)}
            <Button title="Prepare next week" onPress={() => void action(async () => {
              if (plan.sessions.some(s => s.scheduledOn > localDate())) throw Error('Keep this week’s schedule. Prepare the next week after its final scheduled day. Missed work will not be moved.');
              const currentIds = plan.sessions.map(s => s.workoutId);
              const programId = plan.programId ?? plans[0]!.id;
              const programWorkouts = new Map(plans.filter(p => (p.payload.programId ?? p.id) === programId)
                .flatMap(p => p.payload.sessions.map(s => [s.workoutId, s] as const)));
              const cutoff = Date.now() - 21 * 86400000;
              const recentWorkouts = workouts.filter(w => programWorkouts.has(w.id) && Date.parse(w.payload.completedAt ?? w.payload.updatedAt) >= cutoff);
              const hasCurrent = recentWorkouts.some(w => currentIds.includes(w.id));
              const observations = (hasCurrent ? recentWorkouts : []).sort((a, b) => a.payload.updatedAt.localeCompare(b.payload.updatedAt)).map(w => {
                const prescribed = programWorkouts.get(w.id);
                return { ...w.payload, id: w.id, effort: w.payload.explicitFeedback ? w.payload.effort : null,
                  recovery: w.payload.explicitFeedback || w.payload.recovery === 'fatigued' ? w.payload.recovery : null,
                  completed: Boolean(w.payload.completed && prescribed && completedPrescription(prescribed, w.payload.sets)) };
              });
              const change = adapt(plan, observations, null, { notBefore: startWithoutCatchup, deloadIds: currentIds });
              await store.save(owner!, 'plan', saveable(change.plan, change.reason, programId)); await read(owner!); setMessage(change.reason);
            })} />
          </View> : <Copy>No current plan. Edit your profile to build one.</Copy>}
          <Button title="Edit training profile" onPress={() => setEditProfile(true)} />
        </View> : null}
        {tab === 'Progress' ? <View><Copy heading>Your progress</Copy>
          <Choices label="Compare jump type" values={['standing', 'running', 'repeated']} value={progressType} onChange={type => { setProgressType(type); setChartLimit(30); }} />
          {jumps.some(j => j.payload.method === LEGACY_METHOD) ? <Choices label="Measurement version" values={['Current', 'Earlier']} value={progressMethod} onChange={method => { setProgressMethod(method); setChartLimit(30); }} /> : null}
          <Copy>Last 90 days on this iPhone · estimated height in cm · same jump type and flight-time method only. Experimental results are excluded from training progression.</Copy>
          {!recent.length ? <Copy>No compatible results in this date range. Analyze a jump to begin.</Copy> : recent.slice(0, chartLimit).map(r => <View key={r.id} accessible accessibilityLabel={`${new Date(r.createdAt).toLocaleDateString()}: estimated height ${displayHeight(r)}`}>
            <Copy>{new Date(r.createdAt).toLocaleDateString()} · {displayHeight(r)}</Copy>
            <View style={{ height: 12, maxWidth: '100%', width: `${Math.min(100, r.heightM / 1.5 * 100)}%`, backgroundColor: theme.accent }} />
            <Copy muted>Capture {r.timing.originalFPS} FPS · experimental · flight-time {r.method === METHOD ? "0.2" : "0.1"}</Copy>
          </View>)}
          {chartLimit < recent.length ? <Button title="Show more estimates" onPress={() => setChartLimit(chartLimit + 30)} /> : null}
          <Copy heading>Workout history</Copy>
          {!workouts.length ? <Copy>No workouts yet. Start a prescribed session in Today.</Copy> : workouts.map(w => {
            const s = byWorkout.get(w.id);
            return <Button key={w.id} title={`${w.payload.completed ? 'Completed' : 'In progress'} · ${new Date(w.payload.updatedAt).toLocaleDateString()} · ${w.payload.sets.filter(s => s.done).length} sets done`} onPress={() => void action(async () => {
              const prescription = s ?? await store.prescription<SavedSession>(owner, w.payload.prescriptionId);
              if (!w.payload.completed && (prescription.scheduledOn !== localDate() || prescription.scheduledOn < startWithoutCatchup)) {
                throw Error('This session is outside its scheduled day or recovery window. Resume with the next eligible workout.');
              }
              if (currentOwner.current === owner) { setSelectedSession(prescription); setTab('Today'); }
            })} />;
          })}
        </View> : null}
        {tab === 'Settings' ? <View><Copy heading>Settings</Copy><Copy>Videos are analyzed locally and disposable imports are removed. Saved estimates and training records sync as metadata only. No video or frames are uploaded.</Copy>
          <Button title="Refresh and retry pending changes" disabled={busy} onPress={() => void refresh()} />
          {queue.map(q => <View key={q.id}><Copy>{q.kind}: {q.state} · {q.message ?? 'Saved locally; ready to sync.'}</Copy>
            {q.state === 'conflict' ? <View>
              <Button title="Keep saved version" onPress={() => Alert.alert('Replace this local change?', 'Your local edit will be replaced by the version saved on the server.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Keep saved version', onPress: () => void action(async () => { await store.resolveConflict(owner!, q.id, 'remote'); await read(owner!); }) }])} />
              {q.kind === 'profile' || q.kind === 'workout' ? <Button title="Use my local changes" onPress={() => Alert.alert('Replace saved version?', 'Your local changes will be retried against the latest saved version. Another edit can still create a new conflict.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Use my changes', onPress: () => void action(async () => { await store.resolveConflict(owner!, q.id, 'local'); await read(owner!); }) }])} /> : null}
            </View> : null}
          </View>)}
          <Copy>Conflicts preserve local work until you choose a version. Rejected changes remain on this iPhone for review; retries never silently replace newer work.</Copy>
          <Button title="Edit profile" onPress={() => { setTab('Today'); setEditProfile(true); }} />
          <Button title="Sign out" disabled={busy} onPress={logout} />
          <Button title="Delete account and data" danger disabled={busy} onPress={deleteAccount} />
        </View> : null}
      </View>}
      {message ? <View accessibilityLiveRegion="polite"><Copy>{message}</Copy></View> : null}
    </ScrollView>
  </SafeAreaView>;
}
export default function App() { return <SafeAreaProvider><Appearance><Application /></Appearance></SafeAreaProvider>; }
