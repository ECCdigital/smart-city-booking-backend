# Changelog

Notable changes for the Smart City Booking Backend.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Releases are tagged `v4.x.x` from branch `version/4.x`.

## [Unreleased]

### Added

- User ID normalization utility for case-insensitive email/user matching across invitation and membership flows
- Migration `02-07-2026-normalize-membership-invitation-user-ids` to normalize invitation/membership user IDs and deduplicate conflicting membership and single-use invitation records

### Changed

- Preparation lead time (`preparationLeadTimeMinutes` / `serviceHours`) now also applies to time-period- and block-period-related bookables, not only schedule-related ones

### Fixed

- Invitation acceptance, rejection, and verification now compare intended user IDs case-insensitively
- Tenant user onboarding and invitation resend endpoints now normalize user IDs before membership/invitation lookups
- Prevent creating duplicate active single-use invitations for the same tenant and intended user

## [4.1.1] — 2026-07-01

### Fixed

- Invoice number generation now uses `invoiceNumberPrefix` instead of `receiptNumberPrefix`

## [4.1.0] — 2026-06-30

### Added

- Preparation lead time for schedule-related bookables: `preparationLeadTimeMinutes` and weekday-based `serviceHours` on the bookable schema
- Lead-time calculator and checkout availability checks ensuring a contiguous preparation block within service hours before booking start
- Booking buffer times (`bufferTimeBeforeMinutes`, `bufferTimeAfterMinutes`) for capacity checks to prevent back-to-back bookings
- Bookable entity documentation for lead-time and buffer configuration

### Changed

- Capacity interval calculator, calendar service, and booking manager apply buffer-expanded blocked intervals around existing bookings
- Window availability and parent/child capacity rules account for booking buffers

## [4.0.1] — 2026-06-26

### Added

- Entity and API documentation updates

## [4.0.0] — 2026-06-26

- Major release line on branches `develop` (integration) and `version/4.x` (stable)
- Public booking UI moved to [smart-city-booking-store-front](https://github.com/ECCdigital/smart-city-booking-store-front)
- [smart-city-booking-vue-app](https://github.com/ECCdigital/smart-city-booking-vue-app) remains the primary **Admin UI**

## Earlier releases

### v3.7.x (LTS)

- Maintenance on branch `version/3.x`
- Patch and security releases tagged `v3.x.x`

### v3.4.0 (BREAKING)

- JWT-based authentication replaces session/cookie login
- **Membership** entity replaces `tenant.users` and `tenant.ownerUserIds`

**Migration guide:** [migrations/v3.4-jwt-membership.md](migrations/v3.4-jwt-membership.md)

See git tags (`v3.x.x`, `v2.x.x`, `v4.0.0-rc.*`) for historical releases.

[4.1.1]: https://github.com/ECCdigital/smart-city-booking-backend/compare/v4.1.0...v4.1.1
[4.1.0]: https://github.com/ECCdigital/smart-city-booking-backend/compare/v4.0.1...v4.1.0
[4.0.1]: https://github.com/ECCdigital/smart-city-booking-backend/compare/v4.0.0...v4.0.1
[4.0.0]: https://github.com/ECCdigital/smart-city-booking-backend/releases/tag/v4.0.0
