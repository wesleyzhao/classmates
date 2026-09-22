// Campus networks share public IPs. These are network abuse ceilings, not player quotas.
import { PlatformError } from '../../public/shared/errors.js';

export const CAMPUS_LIMITS = Object.freeze({
  emailIp: 1800,            // Per 15 minutes; the daily send budget remains the tighter bound.
  verifyIp: 1800,           // Per 15 minutes, including retries and another-browser confirmation.
  guestStartIp: 1000,       // Per hour; one existing guest cookie still gets only its original run.
  guestStartDay: 2000,      // Per 24-hour window, globally; no full-roster access is added.
  guestFinishIp: 3000,      // Per hour, including idempotent result retries.
});

/** Operator-owned send budget. Reject invalid configuration instead of silently removing the cap.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
export function loginEmailDailyLimit(env = process.env) {
  const raw = env.CLASSMATES_LOGIN_EMAILS_PER_DAY ?? '900';
  const value = Number(raw);
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(value))
    throw new PlatformError(503, 'configuration', 'The sign-in email limit is not configured correctly.');
  return value;
}
