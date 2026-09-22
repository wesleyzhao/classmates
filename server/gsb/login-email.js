// Provider-independent login copy for custom delivery and the local onboarding inbox.
const escapeHtml = value => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Render both email formats without a template dependency. Descope's System sender owns its own copy.
 * @param {string} url
 * @param {string} [gameName]
 */
export function loginEmail(url, gameName = process.env.CLASSMATES_EMAIL_NAME || "GSB faces game") {
  const target = new URL(url);
  if (target.protocol !== "https:" && !(target.protocol === "http:" && ["localhost", "127.0.0.1"].includes(target.hostname)))
    throw new Error("Login emails require a secure app link.");
  const subject = `Log in to the ${gameName}`, greeting = "Hi there,",
    intro = `Click on the button below to log-in to the ${gameName}`,
    button = "Log In Now",
    note = "This link expires in 15 minutes and works once. If you did not request it, you can ignore this email.";
  return { subject, greeting, intro, button, note,
    text: `${greeting}\n\n${intro}\n\n${button}: ${url}\n\n${note}`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;max-width:520px;margin:32px auto;padding:24px"><p>${escapeHtml(greeting)}</p><p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(url)}" style="display:inline-block;background:#8c1515;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">${button}</a></p><p style="font-size:13px;color:#666">${note}</p></div>`,
  };
}
