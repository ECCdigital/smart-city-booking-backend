/**
 * The return target of a signup (`nextUrl`, glossary „Rückkehrziel“): where
 * the client sends the user once the account is verified and signed in.
 * Kept only where the client can be sent — a relative path, or an absolute
 * address on the origin of the client's own verify URL or of the frontend.
 * The verify URL is the client's and already the address the mail links, so a
 * target on its origin is trusted exactly as far as the verify URL itself;
 * what the check refuses is a target on a third host planted next to it.
 */

function parseHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {*} nextUrl the target the client named
 * @param {Object} [context]
 * @param {string} [context.verifyUrl] the client's verify page, whose origin
 *   the target may share
 * @returns {string|null} the target as given, or `null` when there is none
 *   to keep
 */
function normalizeReturnTarget(nextUrl, { verifyUrl } = {}) {
  if (typeof nextUrl !== "string") {
    return null;
  }
  const target = nextUrl.trim();
  if (!target) {
    return null;
  }
  if (target.startsWith("/")) {
    return target.startsWith("//") ? null : target;
  }
  const parsed = parseHttpUrl(target);
  if (!parsed) {
    return null;
  }
  const allowed = [verifyUrl, process.env.FRONTEND_URL]
    .map(parseHttpUrl)
    .filter(Boolean)
    .map((url) => url.origin);
  return allowed.includes(parsed.origin) ? target : null;
}

module.exports = { normalizeReturnTarget };
