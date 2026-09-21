// Fork configuration is server-owned; only display-safe labels reach the browser.
import { PlatformError } from '../../public/shared/errors.js';

/** Exact email domains, with Stanford retained for existing deployments.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function emailDomains(env = process.env) {
  const domains = (env.CLASSMATES_EMAIL_DOMAINS ?? 'stanford.edu').split(',').map(s => s.trim().toLowerCase());
  if (!domains.length || domains.length > 20 || domains.some(domain => domain.length > 253 ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)))
    throw new PlatformError(503,'configuration','Sign-in eligibility is not configured correctly.');
  return [...new Set(domains)];
}

/** Labels and policy only, never credentials or a roster.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function publicSiteConfig(env = process.env) {
  const domains = emailDomains(env), stanford = domains.length === 1 && domains[0] === 'stanford.edu';
  const cohortLabel = (env.CLASSMATES_COHORT_LABEL ?? (stanford ? 'Stanford GSB · MBA 2027' : 'Classmates')).trim();
  if (!cohortLabel || cohortLabel.length > 100 || /[\x00-\x1f\x7f]/.test(cohortLabel))
    throw new PlatformError(503,'configuration','The class label is not configured correctly.');
  return {
    cohortLabel,
    emailLabel: stanford ? 'Your Stanford email' : 'Your email address',
    emailPlaceholder: `you@${domains[0]}`,
    emailHint: `No password. Any verified ${domains.join(' or ')} address can play.`,
  };
}
