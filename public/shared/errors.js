// Errors that carry a machine-readable code and an HTTP status.
// Kits throw KitError for illegal actions ("not_your_turn"); the platform throws
// PlatformError for everything else (room not found, bad request). The router maps
// both to `{ error, code }` JSON and the client shows `message` to the player.

export class KitError extends Error {
  /**
   * @param {string} code  short snake_case identifier, e.g. 'not_your_turn'
   * @param {string} [message]  what the player should read; defaults to a plain version of the code
   */
  constructor(code, message) {
    super(message || code.replace(/_/g, ' '));
    this.name = 'KitError';
    this.code = code;
    this.status = 400;
  }
}

export class PlatformError extends Error {
  /**
   * @param {number} status  HTTP status
   * @param {string} code
   * @param {string} message
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'PlatformError';
    this.status = status;
    this.code = code;
  }
}

/** Errors whose code means "someone else got there first"; clients resync quietly instead of toasting. */
export const QUIET_CODES = new Set(['not_your_turn', 'stale', 'already_done', 'wrong_phase']);
