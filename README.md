# Smart City Booking — Backend API

![Node.js](https://img.shields.io/badge/Node.js-blue)
![npm](https://img.shields.io/badge/npm-blue)
![Docker](https://img.shields.io/badge/Docker-blue)
![MongoDB](https://img.shields.io/badge/MongoDB-blue)

**[Smart City Booking](https://smart-city-booking.de/)** makes your administration's offerings bookable online — from rooms and sports facilities to makerspaces. Operated and developed by the Biletado core team. Open source, GDPR-compliant, and ready to deploy.

This repository contains the **backend API** and business logic. Frontends are maintained in separate repositories (see [Ecosystem](#ecosystem)).

---

## Ecosystem

| Component       | Repository                                                                                     | Role                                                              |
| --------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Backend API** | [smart-city-booking-backend](https://github.com/ECCdigital/smart-city-booking-backend)         | REST API, auth, bookings, tenants                                 |
| **Storefront**  | [smart-city-booking-store-front](https://github.com/ECCdigital/smart-city-booking-store-front) | Public booking UI — connects to this API (v4)                     |
| **Admin UI**    | [smart-city-booking-vue-app](https://github.com/ECCdigital/smart-city-booking-vue-app)         | Administration, configuration, and JS web interface for embedding |

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   Storefront    │────▶│    Backend API       │◀────│    Admin UI     │
│  (public UI)    │     │   (this repository)  │     │   (vue-app)     │
└─────────────────┘     └──────────┬───────────┘     └─────────────────┘
                                   │
                                   ▼
                              ┌─────────┐
                              │ MongoDB │
                              └─────────┘
```

> **v3 users:** Continue on branch `version/3.x`. v3 typically uses the vue-app for both admin and public flows. v4 introduces the separate Storefront for public booking.

More details: [docs/architecture.md](docs/architecture.md)

---

## Versions & Branches

| Branch        | Version line      | Purpose                                            |
| ------------- | ----------------- | -------------------------------------------------- |
| `develop`     | **v4.x** (latest) | Active development and integration                 |
| `version/4.x` | **v4.x** (stable) | Maintenance, security fixes, production tag source |
| `version/3.x` | **v3.x** (LTS)    | Maintenance and security fixes                     |

- v4 releases: tags `v4.x.x` from `version/4.x`
- v3 maintenance: tags `v3.x.x` from `version/3.x`

Breaking changes: [docs/CHANGELOG.md](docs/CHANGELOG.md)

---

## Full stack setup (API + Admin UI + Storefront)

To run all three components together (local npm or Docker Compose), see **[docs/getting-started.md](docs/getting-started.md)**.

That guide covers version alignment, environment wiring (`FRONTEND_URL` = Admin UI, Storefront via `NUXT_*`), bootstrap steps, and a full-stack Compose example.

---

## Quick Start (API only)

### Prerequisites

- [Node.js](https://nodejs.org/) v20+ (recommended: v22 LTS)
- [npm](https://www.npmjs.com/) v10+
- [MongoDB](https://www.mongodb.com/) v6+

### Installation

```bash
git clone https://github.com/ECCdigital/smart-city-booking-backend.git
cd smart-city-booking-backend
npm install
cp .env-example .env
```

Configure your database in `.env`:

```bash
DB_URL=mongodb://localhost:27017/booking-manager
DB_NAME=booking-manager
```

Set secure values for `CRYPTO_SECRET`, `JWT_SECRET`, and `JWT_REFRESH_SECRET`.

`FRONTEND_URL` is the **Admin UI** base URL (default local: `http://localhost:8080`). The Storefront is configured separately — see [getting-started.md](docs/getting-started.md).

For file uploads and payment documents (receipts, invoices), configure [Nextcloud](docs/nextcloud.md) in `.env`.

Start in development mode (MongoDB must be running):

```bash
npm run dev
```

The API listens on the port configured in `.env` (default: `8081`).

---

## Initial Admin User

On first start, a default admin user is created:

- **Email:** `admin`
- **Password:** `admin`

Override via `INIT_ADMIN` and `INIT_ADMIN_SECRET` in `.env`. Change these credentials immediately in production.

---

## Authentication

The API uses JWT authentication. After sign-in, clients receive an `accessToken` and `refreshToken`. Send the access token on protected routes:

```http
Authorization: Bearer <accessToken>
```

Full route reference: [docs/api/authentication.md](docs/api/authentication.md)

---

## Data Model

Core entities: **Instance**, **Tenant**, **Membership**, **User**, **Role**, **Bookable**, **Booking**, **Event**, **Coupon**, **Catalog**, **Workflow**, **Challenge**, **Invitation**

Schema reference with examples: [docs/entities.md](docs/entities.md)

---

## Documentation

| Topic                                                      | Description                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| [Getting started (full stack)](docs/getting-started.md)    | Run API + Admin UI + Storefront (npm or Docker Compose)          |
| [Architecture](docs/architecture.md)                       | System components, data flow, version lines                      |
| [Entities](docs/entities.md)                               | Data model and JSON examples                                     |
| [API Reference](docs/api/README.md)                        | Endpoints, permissions, examples                                 |
| [Authentication](docs/api/authentication.md)               | Auth routes and JWT configuration                                |
| [Deployment](docs/deployment.md)                           | Production setup, Docker, full-stack Compose, operations         |
| [Nextcloud](docs/nextcloud.md)                             | File storage for uploads, attachments, and PDF documents         |
| [Changelog](docs/CHANGELOG.md)                             | Version history and breaking changes                             |
| [Web Integration](docs/web-integration.md)                 | Embed bookables & events in existing websites (JS web interface) |
| [Block Periods (frontend)](docs/block-periods-frontend.md) | Frontend notes for block periods                                 |

---

## Production

For production deployment (Docker, secrets, process management, GHCR images), see [docs/deployment.md](docs/deployment.md).

**Full stack (API + Admin UI + Storefront + MongoDB):** see [docs/getting-started.md](docs/getting-started.md#path-b--docker-compose) and `docker-compose.full-stack.example.yml`.

Quick backend-only Docker example:

```bash
docker build -t smart-city-booking-backend .
docker run -d --name smart-city-booking-backend --restart unless-stopped --env-file .env -p 8081:8081 smart-city-booking-backend
```

---

## License

GPL-3.0 — see [LICENSE.md](LICENSE.md)
