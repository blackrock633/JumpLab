import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import type { Database } from './database.types';

// Atomic Keychain head publication prevents a partially written session from being read.
// Two bounded slots also permit logout to remove staging remnants after an interrupted write.
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const storage = {
  async getItem(key: string) {
    const head = await SecureStore.getItemAsync(key, options);
    if (!head) return null;
    const { generation, count } = JSON.parse(head) as { generation: number; count: number };
    if (![0, 1].includes(generation) || !Number.isInteger(count) || count < 1 || count > 64) return null;
    const chunks = await Promise.all(Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(`${key}.${generation}.${i}`, options)));
    return chunks.some(c => c === null) ? null : chunks.join('');
  },
  async setItem(key: string, value: string) {
    const old = await SecureStore.getItemAsync(key, options);
    const generation = old ? 1 - JSON.parse(old).generation : 0, count = Math.ceil(value.length / 1000);
    if (count > 64) throw Error('Session is too large for secure storage.');
    for (let i = 0; i < count; i++) await SecureStore.setItemAsync(`${key}.${generation}.${i}`, value.slice(i * 1000, (i + 1) * 1000), options);
    await SecureStore.setItemAsync(key, JSON.stringify({ generation, count }), options);
    if (old) { const prior = JSON.parse(old); for (let i = 0; i < prior.count; i++) await SecureStore.deleteItemAsync(`${key}.${prior.generation}.${i}`, options); }
  },
  async removeItem(key: string) {
    await SecureStore.deleteItemAsync(key, options);
    for (const generation of [0, 1]) for (let i = 0; i < 64; i++) await SecureStore.deleteItemAsync(`${key}.${generation}.${i}`, options);
  },
};
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publicKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(url && publicKey && !url.includes('YOUR_PROJECT'));
export const supabase = createClient<Database>(url || 'https://unconfigured.invalid', publicKey || 'unconfigured-public-key', {
  auth: { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, flowType: 'pkce' },
});
export const AUTH_REDIRECT = 'jumplab://auth/callback';
