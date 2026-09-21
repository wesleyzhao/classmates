// Room codes: four letters, no I or O (they read as 1 and 0 on a phone screen).
// 22^4 = 234,256 codes, plenty for rooms that live a month.

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_LENGTH = 4;

/** A fresh random code. Uses rejection sampling so every letter is equally likely. */
export function randomCode() {
  let out = '';
  while (out.length < CODE_LENGTH) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
    for (const b of bytes) {
      if (out.length === CODE_LENGTH) break;
      if (b >= 240) continue;
      out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return out;
}

/** Forgive what people type: lowercase, spaces, dashes. Returns null when it cannot be a code. */
export function normalizeCode(raw) {
  const cleaned = String(raw ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const ch of cleaned) if (!CODE_ALPHABET.includes(ch)) return null;
  return cleaned;
}
