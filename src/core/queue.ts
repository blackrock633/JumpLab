export type WriteKind = 'profile' | 'plan' | 'workout' | 'jump';
export type Pending = { id: string; owner: string; kind: WriteKind; revision: number; payload: unknown; replacement?: { id: string; payload: unknown }; state: 'pending' | 'retry' | 'conflict' | 'error'; attempts: number; message?: string };
export type Outcome = 'deferred' | 'unpublished-plan' | 'ok' | 'unauthorized' | 'conflict' | 'invalid' | 'transient' | 'rate-limited';
type WriteStatus = Pick<Pending, 'id' | 'kind' | 'state'> & { replacement?: { id: string } };

export function selectActivePlan<T extends { id: string; revision: number; payload: { profileRevision?: number } }>(
  plans: readonly T[],
  profile: { revision: number; payload: { planBinding?: boolean } } | undefined,
  queue: readonly WriteStatus[],
) {
  const profileWrite = queue.find(write => write.kind === 'profile');
  return plans.find(row => {
    if (profileWrite) return row.id === profileWrite.replacement?.id &&
      (profileWrite.state === 'pending' || profileWrite.state === 'retry');
    const proposal = queue.find(write => write.id === row.id);
    if (proposal?.state === 'conflict' || proposal?.state === 'error') return false;
    if (row.payload.profileRevision === undefined) return row.revision > 0 && !profile?.payload.planBinding;
    return (row.revision > 0 || proposal?.kind === 'plan') && row.payload.profileRevision === profile?.revision;
  });
}

export function settle(write: Pending, outcome: Exclude<Outcome, 'deferred'>): Pending | null {
  if (outcome === 'ok') return null;
  return { ...write, attempts: write.attempts + 1, state: outcome === 'conflict' ? 'conflict' : outcome === 'invalid' || outcome === 'unpublished-plan' ? 'error' : 'retry',
    message: outcome === 'unauthorized' ? 'Sign in again to sync this account.' : outcome === 'conflict' ? 'A newer version exists. Review before replacing.' : outcome === 'unpublished-plan' ? 'Its prescription was never published. This workout is preserved in local history.' : outcome === 'invalid' ? 'Server rejected this record. Keep local data and review.' : outcome === 'rate-limited' ? 'Write limit reached. Wait for the next quota window, then retry. Local work is preserved.' : 'Connection or server unavailable. Retry when ready.' };
}
export async function drain(owner: string, writes: Pending[], send: (w: Pending) => Promise<Outcome>, save: (id: string, next: Pending | null, sent: Pending) => Promise<void>) {
  for (const w of writes) {
    if (w.owner !== owner) throw Error('Account mismatch.');
    if (w.state === 'conflict' || w.state === 'error') continue;
    let outcome: Outcome;
    try { outcome = await send(w); } catch { outcome = 'transient'; }
    if (outcome === 'deferred') continue;
    await save(w.id, settle(w, outcome), w);
    if (outcome === 'unauthorized' || outcome === 'transient' || outcome === 'rate-limited') break;
  }
}
