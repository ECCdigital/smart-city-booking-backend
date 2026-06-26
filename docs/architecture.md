# Architecture

[Smart City Booking](https://smart-city-booking.de/) makes administrative offerings bookable online — from rooms and sports facilities to makerspaces.

This repository contains the **backend API** of the platform.

## Components

| Component | Repository | Role |
|-----------|------------|------|
| **Backend API** | [smart-city-booking-backend](https://github.com/ECCdigital/smart-city-booking-backend) | REST API, authentication, bookings, tenants, business logic |
| **Storefront** | [smart-city-booking-store-front](https://github.com/ECCdigital/smart-city-booking-store-front) | Public booking UI for citizens and guests (v4) |
| **Admin UI** | [smart-city-booking-vue-app](https://github.com/ECCdigital/smart-city-booking-vue-app) | Administration, configuration, and [JS web interface](docs/web-integration.md) for website embedding |

## Data flow

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│    Storefront   │────▶│    Backend API       │◀────│    Admin UI     │
│  (public UI)    │     │   (this repository)  │     │   (vue-app)     │
└─────────────────┘     └──────────┬───────────┘     └─────────────────┘
                                   │
                                   ▼
                              ┌─────────┐
                              │ MongoDB │
                              └─────────┘
```

Both frontends communicate with the same backend API. They are deployed separately and configured with the backend's public URL.

The vue-app also ships `booking-manager.min.js` for [embedding components into existing websites](web-integration.md) — independent of the Storefront.

## Version lines

| Version | Public UI | Admin UI |
|---------|-----------|----------|
| **v4.x** | Storefront | vue-app |
| **v3.x** | vue-app (combined) | vue-app |

v3 maintenance continues on the `version/3.x` branch. Active v4 development is on `develop`; stable v4 releases are maintained on `version/4.x`.

## Core data model

The backend is multi-tenant. An **Instance** represents the global deployment configuration. **Tenants** are organizations (cities, departments). **Membership** links users to tenants with roles and ownership. **Bookables** and **Bookings** are scoped per tenant.

See [entities.md](entities.md) for schema details.

## Technologies

- **Runtime:** Node.js
- **Database:** MongoDB
- **Auth:** JWT (access + refresh tokens)
- **Deployment:** Docker, GitHub Container Registry
