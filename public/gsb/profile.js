// Shared nickname rules keep first-login suggestions and account validation consistent.
export const NICKNAME_MAX = 48;

/** Normalize a public display name without changing its case. @param {unknown} raw */
export function normalizeNickname(raw) {
  return String(raw ?? "").normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim();
}

/** Return a form/API validation message, or an empty string. @param {unknown} raw */
export function nicknameError(raw) {
  const length = [...normalizeNickname(raw)].length;
  return length < 2 || length > NICKNAME_MAX
    ? `Choose a nickname between 2 and ${NICKNAME_MAX} characters.` : "";
}

/** Suggest only the verified email's username; never infer a person's full name. @param {string} email */
export function defaultNickname(email) {
  const name = [...normalizeNickname(email.split("@")[0])].slice(0, NICKNAME_MAX).join("");
  return nicknameError(name) ? "Classmate" : name;
}
