// Small id helpers that work in the browser and in Node without imports.

/** A random id safe for URLs and object keys; 21 characters. */
export function newId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(21));
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/** Turn a title into a URL slug: "Flags of Europe" -> "flags-of-europe". */
export function slugify(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'game';
}
