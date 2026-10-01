# Production Deployment

For production environments, plan your setup around secure secrets, stable process management, and observability.

For a local or evaluation full stack (API + Admin UI + Storefront), see [getting-started.md](getting-started.md).

## Requirements

- A reachable MongoDB instance (`DB_URL`, `DB_NAME`)
- Strong secrets for `CRYPTO_SECRET`, `JWT_SECRET`, `JWT_REFRESH_SECRET`
- Public URLs for `FRONTEND_URL` (Admin UI) and `BACKEND_URL` (API) — used for redirects and callbacks
- SMTP or Microsoft Graph mail settings if email-based flows are used
- **Nextcloud** (`NEXTCLOUD_URL`, `NEXTCLOUD_USERNAME`, `NEXTCLOUD_PASSWORD`) if you use file uploads, attachments, or payment PDFs (receipts, invoices, cancellations) — see [nextcloud.md](nextcloud.md)
- A reverse proxy with TLS termination (e.g. Nginx, Traefik, cloud load balancer)

## Client applications (v4)

The Storefront and Admin UI are separate deployments — see [architecture.md](architecture.md).

| Client     | Env var(s)                                           | Value                                              |
| ---------- | ---------------------------------------------------- | -------------------------------------------------- |
| Admin UI   | `VUE_APP_SERVER_BASE_URL`                            | Public API URL (`BACKEND_URL`)                     |
| Storefront | `NUXT_API_BASE_URL`                                  | API URL reachable from the Storefront server (BFF) |
| Storefront | `NUXT_USER_BASE_URL` / `NUXT_PUBLIC_USER_BASE_URL`   | Public Storefront URL                              |
| Storefront | `NUXT_ADMIN_BASE_URL` / `NUXT_PUBLIC_ADMIN_BASE_URL` | Public Admin UI URL (optional)                     |
| Backend    | `FRONTEND_URL`                                       | Public **Admin UI** URL (not the Storefront)       |
| Backend    | `BACKEND_URL`                                        | Public API URL                                     |

Full wiring matrix and Compose notes: [getting-started.md](getting-started.md).

## Keycloak (SSO)

SSO is set per instance in the Admin UI (Management → Instances → Auth), not in the environment. The backend expects the realm `{Keycloak-URL}/realms/{Realm}` and two clients:

| Admin UI field                           | Keycloak client                                                  | What the backend does with it                                                               |
| ---------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Client-ID für Web-Anwendung              | Public client of Admin UI and Storefront (e.g. `booking-client`) | Accepts a token whose `aud` or `azp` names it                                               |
| Client-ID für Api-Zugriff, Client Secret | Confidential client of the backend                               | Introspects the token on SSO sign-in and signup and on every API call with a Keycloak token |

The token's issuer must be exactly `{Keycloak-URL}/realms/{Realm}`. When Keycloak moves from `start-dev` to `start`, set `KC_HOSTNAME` to the full URL.

**Keycloak 26.6.2 and later** answer an introspection `active: false` when the asking client is not in the token's `aud` ([upgrade note](https://github.com/keycloak/keycloak/blob/release/26.7/docs/documentation/upgrading/topics/changes/changes-26_6_2.adoc)). Every SSO sign-in then fails with `403 User not active`. Put the backend's client into the token's `aud`:

1. On the public client, add a mapper of type _Audience_, in its dedicated client scope or a default scope of the client.
2. Set _Included Client Audience_ to the backend's confidential client.
3. Turn on _Add to access token_.

Users sign in again afterwards, so their new token carries the `aud`. The cause shows in Keycloak's events as `INTROSPECT_TOKEN_ERROR` with "Client '…' is not in the token audience", and in the backend's log as a warning naming the Audience mapper. A deprecated stopgap is _Allow token introspection without audience check_ on the confidential client (Advanced, OpenID Connect Compatibility Modes).

Redirect URIs, web origins and post-logout URIs belong to the client applications: see [Keycloak setup](https://github.com/ECCdigital/smart-city-booking-vue-app/blob/develop/bff/README.md#keycloak-setup) of the Admin UI.

## Recommended environment settings

```bash
NODE_ENV=production
LOG_LEVEL=info
DISABLE_EMAIL_CHECK=false
PORT=8081
```

See `.env-example` for the full list of configuration options.

## Run with Node.js

1. Install production dependencies:

   ```bash
   npm ci --omit=dev
   ```

2. Start the backend:

   ```bash
   npm start
   ```

3. Use a process manager (e.g. `systemd` or PM2) so the service restarts automatically.

## Run with Docker (backend only)

Build and run with your environment file:

```bash
docker build -t smart-city-booking-backend .
docker run -d \
  --name smart-city-booking-backend \
  --restart unless-stopped \
  --env-file .env \
  -p 8081:8081 \
  smart-city-booking-backend
```

## Full stack with Docker Compose

An example Compose file runs MongoDB, this backend, the Admin UI, and the Storefront together:

```bash
cp docker-compose.full-stack.example.yml docker-compose.yml
cp .env.full-stack.example .env
# Edit secrets, then:
docker compose up -d --build
```

Details (ports, BFF networking, branch pins): [getting-started.md](getting-started.md#path-b--docker-compose).

For production, prefer pinned release tags or GHCR images behind a TLS reverse proxy. Nextcloud is not part of the example Compose stack — configure it separately when needed.

## Database migrations

Database migration scripts live in `migrations/scripts/`. Run them according to your deployment process when upgrading between versions. See [CHANGELOG.md](CHANGELOG.md) and [migrations/](migrations/) for breaking changes.

Pending migrations run at start-up under a MongoDB lock, so parallel processes run them once, and `GET /healthz/ready` answers `503` until they have succeeded in that process — route traffic by that probe. The cutover to the tenant supervision is described in [tenant-supervision-cutover.md](tenant-supervision-cutover.md).

## Operations checklist

- Keep MongoDB data on persistent storage
- Rotate secrets regularly
- Change default admin credentials after first login (`INIT_ADMIN`, `INIT_ADMIN_SECRET`)
- Back up the database before major version upgrades
