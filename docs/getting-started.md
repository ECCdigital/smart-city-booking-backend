# Getting Started — Full Stack (v4)

This guide explains how to run **Smart City Booking v4** end to end: Backend API (this repository), [Admin UI](https://github.com/ECCdigital/smart-city-booking-vue-app), and [Storefront](https://github.com/ECCdigital/smart-city-booking-store-front).

For API-only setup, see the [README Quick Start](../README.md#quick-start). For production hardening, see [deployment.md](deployment.md).

---

## What you need

| Component   | Repository                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------- |
| Backend API | [smart-city-booking-backend](https://github.com/ECCdigital/smart-city-booking-backend) (this repo) |
| Admin UI    | [smart-city-booking-vue-app](https://github.com/ECCdigital/smart-city-booking-vue-app)             |
| Storefront  | [smart-city-booking-store-front](https://github.com/ECCdigital/smart-city-booking-store-front)     |

**Prerequisites (local npm path):**

- [Node.js](https://nodejs.org/) v20+ (recommended: v22 LTS)
- [npm](https://www.npmjs.com/) v10+
- [MongoDB](https://www.mongodb.com/) v6+

**Prerequisites (Docker Compose path):**

- [Docker](https://www.docker.com/) v20+ with Compose v2

**Optional but required for many features:** [Nextcloud](nextcloud.md) for file uploads and PDF documents (receipts, invoices, cancellations).

---

## Version alignment

| Component  | Branch / line              | Notes                                |
| ---------- | -------------------------- | ------------------------------------ |
| Backend    | `develop` or `version/4.x` | v4 API                               |
| Admin UI   | `develop` or `version/4.x` | Must match backend major line        |
| Storefront | `develop` or `version/1.x` | Storefront v1.x ↔ backend v4.x only |

v3 uses the vue-app for both admin and public flows (`version/3.x`). This guide is for **v4** with a separate Storefront.

---

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   Storefront    │────▶│    Backend API       │◀────│    Admin UI     │
│  :3000 (public) │     │       :8081          │     │     :8080       │
└─────────────────┘     └──────────┬───────────┘     └─────────────────┘
                                   │
                                   ▼
                              ┌─────────┐
                              │ MongoDB │
                              └─────────┘
```

- **Admin UI** calls the API **from the browser** (`VUE_APP_SERVER_BASE_URL`).
- **Storefront** uses a **BFF**: the browser talks to Storefront `/api/*`; the Storefront server proxies to the backend (`NUXT_API_BASE_URL`).

---

## Ports (local defaults)

| Service     | Host port |
| ----------- | --------- |
| Backend API | `8081`    |
| Admin UI    | `8080`    |
| Storefront  | `3000`    |
| MongoDB     | `27017`   |

---

## Environment wiring

`FRONTEND_URL` on the backend is the **Admin UI** base URL. Do **not** set it to the Storefront. The Storefront identity is configured with Storefront `NUXT_*` variables.

| Variable                                             | Where      | Points to                                                |
| ---------------------------------------------------- | ---------- | -------------------------------------------------------- |
| `BACKEND_URL`                                        | Backend    | Public API URL (e.g. `http://localhost:8081`)            |
| `FRONTEND_URL`                                       | Backend    | **Admin UI** URL (e.g. `http://localhost:8080`)          |
| `VUE_APP_SERVER_BASE_URL`                            | Admin UI   | API URL reachable from the browser                       |
| `NUXT_API_BASE_URL`                                  | Storefront | API URL for the **server-side** (**`8081`**, not `8080`) |
| `NUXT_USER_BASE_URL` / `NUXT_PUBLIC_USER_BASE_URL`   | Storefront | Public Storefront URL                                    |
| `NUXT_ADMIN_BASE_URL` / `NUXT_PUBLIC_ADMIN_BASE_URL` | Storefront | Admin UI URL (optional nav link)                         |

### Copy-paste examples (local npm)

**Backend** (`.env`):

```bash
PORT=8081
FRONTEND_URL=http://localhost:8080
BACKEND_URL=http://localhost:8081
DB_URL=mongodb://localhost:27017/booking-manager
DB_NAME=booking-manager
# Set CRYPTO_SECRET, JWT_SECRET, JWT_REFRESH_SECRET — see .env-example
```

**Admin UI** (`.env`):

```bash
VUE_APP_SERVER_BASE_URL=http://localhost:8081
```

**Storefront** (`.env`):

```bash
NUXT_API_BASE_URL=http://localhost:8081
NUXT_USER_BASE_URL=http://localhost:3000
NUXT_PUBLIC_USER_BASE_URL=http://localhost:3000
NUXT_ADMIN_BASE_URL=http://localhost:8080
NUXT_PUBLIC_ADMIN_BASE_URL=http://localhost:8080
NUXT_CACHE_ENABLED=false
```

Inside Docker Compose, browser-facing URLs still use `localhost` host ports, but the Storefront BFF must reach the API on the Docker network (e.g. `http://backend:8081`). See [Path B](#path-b--docker-compose).

---

## Path A — local npm

Start order: **MongoDB → Backend → Admin UI → Storefront**.

### 1. MongoDB

Ensure MongoDB is running and reachable at the `DB_URL` you configure.

### 2. Backend API

```bash
git clone https://github.com/ECCdigital/smart-city-booking-backend.git
cd smart-city-booking-backend
git checkout develop   # or version/4.x
npm install
cp .env-example .env
# Edit secrets, DB_URL, FRONTEND_URL, BACKEND_URL
npm run dev
```

API: [http://localhost:8081](http://localhost:8081) — live check: [http://localhost:8081/healthz/live](http://localhost:8081/healthz/live)

### 3. Admin UI

```bash
git clone https://github.com/ECCdigital/smart-city-booking-vue-app.git
cd smart-city-booking-vue-app
git checkout develop   # or version/4.x
npm install
cp .env-example .env
# Set VUE_APP_SERVER_BASE_URL=http://localhost:8081
npm run serve
```

Admin UI: [http://localhost:8080](http://localhost:8080)

### 4. Storefront

```bash
git clone https://github.com/ECCdigital/smart-city-booking-store-front.git
cd smart-city-booking-store-front
git checkout develop   # or version/1.x
npm install
cp .env.example .env
# Set NUXT_API_BASE_URL=http://localhost:8081 and Storefront/Admin URLs (see matrix above)
npm run dev
```

Storefront: [http://localhost:3000](http://localhost:3000)

---

## Path B — Docker Compose

This repository ships an example Compose stack that builds **MongoDB + Backend + Admin UI + Storefront**.

From the backend repo root:

```bash
cp docker-compose.full-stack.example.yml docker-compose.yml
cp .env.full-stack.example .env
# Edit secrets in .env (CRYPTO_SECRET, JWT_*, INIT_ADMIN_SECRET, optional Nextcloud)
docker compose up -d --build
```

| Service     | URL                   |
| ----------- | --------------------- |
| Backend API | http://localhost:8081 |
| Admin UI    | http://localhost:8080 |
| Storefront  | http://localhost:3000 |
| MongoDB     | localhost:27017       |

**Compose URL rules:**

- `FRONTEND_URL=http://localhost:8080` — Admin UI (browser / redirects)
- `BACKEND_URL=http://localhost:8081` — API as seen by browsers and callbacks
- Admin `VUE_APP_SERVER_BASE_URL=http://localhost:8081` — browser → API
- Storefront `NUXT_API_BASE_URL=http://backend:8081` — **container → container** (BFF), not `localhost:8080`
- Storefront public URLs remain `http://localhost:3000`

The example builds the backend from the current directory (`.`) and the frontends from their public GitHub `develop` branches. For a more stable deploy, pin branches in `docker-compose.yml` (e.g. `version/4.x` for backend/admin, `version/1.x` for storefront) or switch `build:` to published GHCR images.

Nextcloud is **not** included in the Compose file. Set `NEXTCLOUD_*` in `.env` if you need uploads/PDFs — see [nextcloud.md](nextcloud.md).

Stop the stack:

```bash
docker compose down
```

---

## First login and bootstrap

On first backend start, an instance owner is created from `INIT_ADMIN` / `INIT_ADMIN_SECRET` (defaults: `admin` / `admin` if unset). Change these credentials in any non-local environment.

1. Open the **Admin UI** and sign in with the init admin.
2. Create a **tenant** (organization) and note its ID / slug.
3. Create at least one **bookable** (and opening hours / pricing as needed).
4. Ensure the offer is visible to the public portal:
   - Enable public offers / portal settings on the **instance** where applicable (`publicOffersEnabled` / portal URL — see [entities.md](entities.md)).
   - Configure **catalog** participation so the tenant appears in the Storefront catalog.
5. Open the **Storefront** and browse the catalog or tenant route (e.g. `/t/<tenantId>/...`).

Without a tenant and public bookables, the Storefront will look empty even if all services are healthy.

---

## Verify

| Check        | How                                                                   |
| ------------ | --------------------------------------------------------------------- |
| API alive    | `GET http://localhost:8081/healthz/live` → `200`                      |
| API ready    | `GET http://localhost:8081/healthz/ready` → `200` (MongoDB connected) |
| Admin login  | Sign in at http://localhost:8080                                      |
| Storefront   | http://localhost:3000 shows catalog / tenant content after bootstrap  |
| Booking path | Create a test booking in the Storefront against a public bookable     |

---

## Troubleshooting

| Symptom                                                                  | Likely cause                                                                                                          |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Storefront cannot load catalog / auth fails                              | `NUXT_API_BASE_URL` points at `8080` (Admin) instead of the API (`8081` locally, or `http://backend:8081` in Compose) |
| Email / redirect links open Admin instead of Storefront (or the reverse) | Confusing `FRONTEND_URL` with Storefront URLs — `FRONTEND_URL` must be Admin; Storefront uses `NUXT_USER_*`           |
| Storefront empty                                                         | No tenant, no public bookables, or portal/catalog not enabled                                                         |
| Uploads / PDF receipts fail                                              | Nextcloud not configured — see [nextcloud.md](nextcloud.md)                                                           |
| Admin cannot reach API                                                   | Wrong `VUE_APP_SERVER_BASE_URL`; CORS reflects the request origin (Admin talks to the API from the browser)           |
| Compose: Storefront cannot reach API                                     | BFF still using `localhost` inside the container — use the Docker service name (`backend`)                            |
| Compose / Docker: `npm ci` fails with `sizeCalculation` / `maxSize`      | Backend Dockerfile must use Node 22 LTS (not Node 25); pull latest Dockerfile and rebuild                             |
| Auth cookies in production Storefront                                    | In `NODE_ENV=production`, cookies require HTTPS behind a reverse proxy                                                |

---

## Next steps

- [Architecture](architecture.md) — components and version lines
- [Deployment](deployment.md) — production, Docker, operations
- [Authentication](api/authentication.md) — JWT routes
- [Web integration](web-integration.md) — embed bookables via the JS web interface
- [Entities](entities.md) — data model
