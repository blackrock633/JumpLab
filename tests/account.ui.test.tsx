import type { Session } from '@supabase/supabase-js';
import { accountClient, supabase } from '../src/data/auth';

jest.mock('@supabase/supabase-js', () => {
  let session: Session | null;
  let listener: (event: string, value: Session | null) => void;
  return { createClient: jest.fn((_url, _key, options) => options.accessToken ? {
    bearerAtDispatch: options.accessToken,
  } : {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: (callback: typeof listener) => { listener = callback; },
    },
    switchIdentity: (value: Session | null) => { session = value; listener('SIGNED_IN', value); },
  }) };
});

const switchIdentity = (id: string, accessToken: string) => {
  (supabase as unknown as { switchIdentity(value: Session): void }).switchIdentity({ user: { id }, access_token: accessToken } as Session);
};

test('queued dispatch keeps the checked owner credential across refresh and rejects an account switch', async () => {
  switchIdentity('A', 'synthetic-owner-a');
  const a = await accountClient('A');
  const bearerAtDispatch = (a.client as unknown as { bearerAtDispatch(): Promise<string> }).bearerAtDispatch;
  switchIdentity('A', 'synthetic-refreshed-a');
  expect(await bearerAtDispatch()).toBe('synthetic-owner-a');
  expect(a.isCurrent()).toBe(true);
  switchIdentity('B', 'synthetic-owner-b');
  expect(a.isCurrent()).toBe(false);
  await expect(bearerAtDispatch()).rejects.toThrow('Account changed before dispatch');
  await expect(accountClient('A')).rejects.toThrow('Sign in to this account');
  switchIdentity('A', 'synthetic-owner-a-again');
  expect(a.isCurrent()).toBe(false);
});
