/**
 * lib/unity-version.ts — Parse Unity version strings and detect Unity 6+.
 *
 * Ported from fork-unity-setup/src/lib/unity-version.ts — no changes needed.
 */

export interface UnityVersionParsed {
  major: number;
  minor: number;
  patch: string;
}

export function parseUnityVersion(name: string): UnityVersionParsed | null {
  const m = /^(\d+)\.(\d+)\.(.+)$/.exec(name);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: m[3] };
}

export function isUnity6OrNewer(v: UnityVersionParsed | null): boolean {
  return v !== null && v.major >= 6000;
}
