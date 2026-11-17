export type WriteKind = 'profile' | 'plan' | 'workout' | 'jump';
export type Pending = { id: string; owner: string; kind: WriteKind; revision: number; payload: unknown; state: 'pending' | 'retry' | 'conflict' | 'error'; attempts: number; message?: string };
export type Outcome = 'ok' | 'unauthorized' | 'conflict' | 'invalid' | 'transient' | 'rate-limited';
export function settle(write: Pending, outcome: Outcome): Pending | null {
  if (outcome === 'ok') return null;
  return { ...write, attempts: write.attempts + 1, state: outcome === 'conflict' ? 'conflict' : outcome === 'invalid' ? 'error' : 'retry',
    message: outcome === 'unauthorized' ? 'Sign in again to sync this account.' : outcome === 'conflict' ? 'A newer version exists. Review before replacing.' : outcome === 'invalid' ? 'Server rejected this record. Keep local data and review.' : outcome === 'rate-limited' ? 'Write limit reached. Wait for the next quota window, then retry. Local work is preserved.' : 'Connection or server unavailable. Retry when ready.' };
}
export async function drain(owner: string, writes: Pending[], send: (w: Pending) => Promise<Outcome>, save: (id: string, next: Pending | null) => Promise<void>) {
  for (const w of writes) {
    if (w.owner !== owner) throw Error('Account mismatch.');
    if (w.state === 'conflict' || w.state === 'error') continue;
    let outcome: Outcome;
    try { outcome = await send(w); } catch { outcome = 'transient'; }
    await save(w.id, settle(w, outcome));
    if (outcome === 'unauthorized' || outcome === 'transient' || outcome === 'rate-limited') break;
  }
}
