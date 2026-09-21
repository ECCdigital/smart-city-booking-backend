/**
 * The return target of a signup (`nextUrl`): where the client sends the user
 * once the account is verified and signed in. Kept only where the client can
 * safely be sent — a relative path, or an absolute address on the origin of
 * the client's own verify URL or of the frontend — so a signup cannot plant
 * a foreign address in the verification mail.
 */

function originOf(url) {
  try {
    return new URL(url).origin;
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
  const origin = originOf(target);
  if (!origin || !/^https?:$/.test(new URL(target).protocol)) {
    return null;
  }
  const allowed = [verifyUrl, process.env.FRONTEND_URL]
    .map(originOf)
    .filter(Boolean);
  return allowed.includes(origin) ? target : null;
}

module.exports = { normalizeReturnTarget };
