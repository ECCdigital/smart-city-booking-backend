# Changelog

Notable changes for the Smart City Booking Backend.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Releases are tagged `v4.x.x` from branch `version/4.x`.

## [Unreleased]

### Fixed

- Manual admin bookings now set `assignedUserId` from the booking email so the assigned user can see the booking in their personal booking list


### Added
- Supervisor booking notifications: per-membership `bookingNotificationRecipients` (types `user`, `role`, `email`; max. 10 entries) resolved and mailed on booking creation for single and group bookings
- Tenant feature flag `notifySupervisorsOnBooking` (default `false`) to enable supervisor notifications per tenant
- Admin endpoint `POST /tenants/:id/update-user-booking-notification-recipients` (requires `manageUsers.updateAny`) to manage recipients on memberships
- New mail type `SUPERVISOR_BOOKING_NOTIFICATION` with overridable snippet `supervisor-booking-notification` (tenant mail UI), reusing the existing booking details block

## [4.1.4] — 2026-07-03

### Added

- Preview for receipt, invoice, and cancellation PDF templates before saving
- Configurable layout for booking tables in PDFs (summary, compact, detailed)
- Option to show or hide booking number, period, and payment details in PDF tables
- Manual collective invoice for all bookings in a group booking, with optional email delivery
- Page numbers and repeating headers/footers on multi-page PDFs

### Changed

- Updated default templates for receipts, invoices, and cancellations

## [4.1.3] — 2026-07-02

### Fixed

- Invitation partial unique index definitions now use MongoDB-compatible predicates in partial filters to avoid startup failures on environments that reject `$ne` in partial index expressions

## [4.1.2] — 2026-07-02

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

[4.1.4]: https://github.com/ECCdigital/smart-city-booking-backend/compare/v4.1.3...v4.1.4
[4.1.3]: https://github.com/ECCdigital/smart-city-booking-backend/compare/v4.1.2...v4.1.3
[4.1.2]: https://github.com/ECCdigital/smart-city-booking-backend/compare/v4.1.1...v4.1.2
[4.1.1]: https://github.com/ECCdigital/smart-city-booking-backend/compare/v4.1.0...v4.1.1
[4.1.0]: https://github.com/ECCdigital/smart-city-booking-backend/compare/v4.0.1...v4.1.0
[4.0.1]: https://github.com/ECCdigital/smart-city-booking-backend/compare/v4.0.0...v4.0.1
[4.0.0]: https://github.com/ECCdigital/smart-city-booking-backend/releases/tag/v4.0.0
