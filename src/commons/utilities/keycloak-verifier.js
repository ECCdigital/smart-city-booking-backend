const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");
const axios = require("axios");
const bunyan = require("bunyan");
const InstanceManager = require("../data-managers/instance-manager");

const logger = bunyan.createLogger({
  name: "keycloak-verifier",
  level: process.env.LOG_LEVEL || "info",
});

class KeycloakVerifier {
  static _clients = new Map();
  static _introspectionCache = new Map();
  static _keycloakConfig = null;
  static _configLoadedAt = null;

  static INTROSPECTION_CACHE_TTL = parseInt(
    process.env.KEYCLOAK_INTROSPECTION_CACHE_TTL || "30000",
  );

  static CONFIG_CACHE_TTL = 60000; // 1 Minute

  static async getKeycloakConfig() {
    const now = Date.now();

    if (
      this._keycloakConfig &&
      this._configLoadedAt &&
      now - this._configLoadedAt < this.CONFIG_CACHE_TTL
    ) {
      return this._keycloakConfig;
    }

    const instance = await InstanceManager.getInstance();

    if (!instance || !instance.applications) {
      throw new Error("Instance not found or has no applications");
    }

    const keycloakApp = instance.applications.find(
      (app) => app.id === "keycloak" && app.active,
    );

    if (!keycloakApp) {
      throw new Error("Keycloak application not configured or inactive");
    }

    this._keycloakConfig = {
      serverUrl: keycloakApp.serverUrl.replace(/\/+$/, ""),
      realm: keycloakApp.realm,
      publicClient: keycloakApp.publicClient,
      privateClient: keycloakApp.privateClient,
      privateClientSecret: keycloakApp.privateClientSecret,
      roleMapping: keycloakApp.roleMapping,
    };

    this._configLoadedAt = now;

    logger.debug(
      `Keycloak config loaded: ${this._keycloakConfig.serverUrl}/realms/${this._keycloakConfig.realm}`,
    );

    return this._keycloakConfig;
  }

  static async getRealmUrl() {
    const config = await this.getKeycloakConfig();
    return `${config.serverUrl}/realms/${config.realm}`;
  }


  static getClient(issuerUrl) {
    if (!this._clients.has(issuerUrl)) {
      this._clients.set(
        issuerUrl,
        jwksClient({
          jwksUri: `${issuerUrl}/protocol/openid-connect/certs`,
          cache: true,
          cacheMaxAge: 600000,
          rateLimit: true,
          jwksRequestsPerMinute: 10,
        }),
      );
    }
    return this._clients.get(issuerUrl);
  }

  static getSigningKey(issuerUrl, kid) {
    return new Promise((resolve, reject) => {
      const client = this.getClient(issuerUrl);
      client.getSigningKey(kid, (err, key) => {
        if (err) reject(err);
        else resolve(key.getPublicKey());
      });
    });
  }

  static async introspectToken(token, issuerUrl) {
    const config = await this.getKeycloakConfig();

    if (!config.privateClient || !config.privateClientSecret) {
      logger.warn(
        "Keycloak private client not configured, skipping introspection",
      );
      return null;
    }

    const introspectionUrl = `${issuerUrl}/protocol/openid-connect/token/introspect`;

    try {
      const response = await axios.post(
        introspectionUrl,
        new URLSearchParams({
          token: token,
          token_type_hint: "access_token",
        }).toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          auth: {
            username: config.privateClient,
            password: config.privateClientSecret,
          },
          timeout: 5000,
        },
      );

      return response.data;
    } catch (error) {
      logger.error("Keycloak introspection request failed:", error.message);
      throw error;
    }
  }

  static async checkTokenActive(token, decoded) {
    const cacheKey = decoded.sid || decoded.jti || decoded.sub;

    const cached = this._introspectionCache.get(cacheKey);
    if (cached) {
      const age = Date.now() - cached.checkedAt;
      if (age < this.INTROSPECTION_CACHE_TTL) {
        logger.debug(
          `Introspection cache hit for ${cacheKey}: active=${cached.active}`,
        );
        return cached.active;
      }
      this._introspectionCache.delete(cacheKey);
    }

    try {
      const result = await this.introspectToken(token, decoded.iss);

      if (!result) {
        return true;
      }

      const active = result.active === true;

      this._introspectionCache.set(cacheKey, {
        active,
        checkedAt: Date.now(),
      });

      if (!active) {
        logger.info(
          `Keycloak token inactive for ${decoded.email || decoded.sub}`,
        );
      }

      return active;
    } catch (error) {
      logger.warn(
        "Introspection failed, falling back to JWKS-only:",
        error.message,
      );
      return true;
    }
  }

  static async verifyToken(token) {
    const decodedHeader = jwt.decode(token, { complete: true });
    if (!decodedHeader) {
      throw new Error("Keycloak token decode failed");
    }

    const { kid } = decodedHeader.header;
    const { iss } = decodedHeader.payload;

    if (!iss || !iss.includes("/realms/")) {
      throw new Error("Invalid Keycloak issuer");
    }

    const expectedRealmUrl = await this.getRealmUrl();
    if (iss !== expectedRealmUrl) {
      throw new Error(
        `Keycloak issuer mismatch: expected ${expectedRealmUrl}, got ${iss}`,
      );
    }

    const publicKey = await this.getSigningKey(iss, kid);

    const decoded = jwt.verify(token, publicKey, {
      algorithms: ["RS256"],
      issuer: iss,
    });

    const config = await this.getKeycloakConfig();
    const expectedClientId = config.publicClient;

    if (expectedClientId) {
      const audience = Array.isArray(decoded.aud)
        ? decoded.aud
        : [decoded.aud];
      const hasValidAudience =
        audience.includes(expectedClientId) ||
        decoded.azp === expectedClientId;

      if (!hasValidAudience) {
        throw new Error("Keycloak token audience mismatch");
      }
    }

    const isActive = await this.checkTokenActive(token, decoded);

    if (!isActive) {
      throw new Error("Keycloak session has been revoked");
    }

    logger.debug(
      `Keycloak token verified for ${decoded.email || decoded.sub}`,
    );

    return decoded;
  }

  static clearCache() {
    this._introspectionCache.clear();
    this._keycloakConfig = null;
    this._configLoadedAt = null;
    logger.info("Keycloak verifier caches cleared");
  }

  static pruneCache() {
    const now = Date.now();
    let pruned = 0;

    for (const [key, value] of this._introspectionCache) {
      if (now - value.checkedAt > this.INTROSPECTION_CACHE_TTL * 2) {
        this._introspectionCache.delete(key);
        pruned++;
      }
    }

    if (pruned > 0) {
      logger.debug(`Pruned ${pruned} entries from introspection cache`);
    }
  }
}

setInterval(
  () => {
    KeycloakVerifier.pruneCache();
  },
  5 * 60 * 1000,
);

module.exports = KeycloakVerifier;