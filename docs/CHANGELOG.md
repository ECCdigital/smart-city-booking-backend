# Changelog

Notable changes and migration guides for Smart City Booking Backend.

## v4.0.0

- Major release line on branches `develop` (integration) and `version/4.x` (stable)
- Public booking UI moved to [smart-city-booking-store-front](https://github.com/ECCdigital/smart-city-booking-store-front)
- [smart-city-booking-vue-app](https://github.com/ECCdigital/smart-city-booking-vue-app) remains the primary **Admin UI**
- See release notes and tags `v4.x.x` for full details

## v3.7.x (LTS)

- Maintenance on branch `version/3.x`
- Patch and security releases tagged `v3.x.x`

## v3.4.0 (BREAKING)

- JWT-based authentication replaces session/cookie login
- **Membership** entity replaces `tenant.users` and `tenant.ownerUserIds`

**Migration guide:** [migrations/v3.4-jwt-membership.md](migrations/v3.4-jwt-membership.md)

## Earlier versions

See git tags (`v3.x.x`, `v2.x.x`) for historical releases.
