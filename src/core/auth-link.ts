export function recoveryCode(link: string): string {
  // React Native's built-in URL host/path accessors are limited to HTTP(S).
  const match = /^jumplab:\/\/auth\/callback\?code=([A-Za-z0-9_-]{16,256})$/.exec(link);
  if (!match || match[0] !== link) throw Error('Untrusted authentication link. Request a new recovery email from JumpLab.');
  return match[1]!;
}
