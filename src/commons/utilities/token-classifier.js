/**
 * Bestimmt anhand des Token-Payloads, ob es ein Keycloak-
 * oder ein lokales Token ist.
 */
function classifyToken(decoded) {
  // Keycloak-Tokens haben typischerweise "realm_access",
  // "azp" (authorized party) und der Issuer enthält "/realms/"
  if (
    decoded.azp ||
    decoded.realm_access ||
    (decoded.iss && decoded.iss.includes("/realms/"))
  ) {
    return "keycloak";
  }
  return "local";
}

module.exports = { classifyToken };
