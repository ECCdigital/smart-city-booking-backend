# Production Deployment

For production environments, plan your setup around secure secrets, stable process management, and observability.

## Requirements

- A reachable MongoDB instance (`DB_URL`, `DB_NAME`)
- Strong secrets for `CRYPTO_SECRET`, `JWT_SECRET`, `JWT_REFRESH_SECRET`
- Public URLs for `FRONTEND_URL` and `BACKEND_URL` (used for redirects and callbacks)
- SMTP or Microsoft Graph mail settings if email-based flows are used
- **Nextcloud** (`NEXTCLOUD_URL`, `NEXTCLOUD_USERNAME`, `NEXTCLOUD_PASSWORD`) if you use file uploads, attachments, or payment PDFs (receipts, invoices, cancellations) — see [nextcloud.md](nextcloud.md)
- A reverse proxy with TLS termination (e.g. Nginx, Traefik, cloud load balancer)

When deploying v4 with separate frontends, configure each client application to point at `BACKEND_URL`. The Storefront and Admin UI are separate deployments — see [architecture.md](architecture.md).

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

## Run with Docker

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

## Database migrations

Database migration scripts live in `migrations/scripts/`. Run them according to your deployment process when upgrading between versions. See [CHANGELOG.md](CHANGELOG.md) and [migrations/](migrations/) for breaking changes.

## Operations checklist

- Keep MongoDB data on persistent storage
- Rotate secrets regularly
- Change default admin credentials after first login (`INIT_ADMIN`, `INIT_ADMIN_SECRET`)
- Back up the database before major version upgrades
