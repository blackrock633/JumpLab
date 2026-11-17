export function recoveryCode(link: string): string {
  const u = new URL(link);
  if (u.protocol !== 'jumplab:' || u.hostname !== 'auth' || u.pathname !== '/callback' ||
    u.username || u.password || u.port || u.hash || [...u.searchParams.keys()].some(k => k !== 'code') ||
    u.searchParams.getAll('code').length !== 1) throw Error('Untrusted authentication link. Request a new recovery email from JumpLab.');
  const code = u.searchParams.get('code');
  if (!code || !/^[A-Za-z0-9_-]{16,256}$/.test(code)) throw Error('Invalid authentication code.');
  return code;
}
