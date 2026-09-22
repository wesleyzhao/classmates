// Invitations survive email confirmation, including in a different browser. They never authorize access.
/** Accept only the two internal game invitation routes, never an arbitrary redirect.
 * @param {unknown} value
 * @returns {string | null}
 */
export function invitePath(value) {
  return typeof value === "string" && /^\/(?:speed|r)\/[a-z]{4}$/i.test(value)
    ? value.replace(/[^/]+$/, code => code.toUpperCase()) : null;
}
