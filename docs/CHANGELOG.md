# Changelog

Notable changes for the Smart City Booking Backend.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Releases are tagged `v4.x.x` from branch `version/4.x`.

## [Unreleased]

## [4.2.5] — 2026-08-10

### Fixed

- Admin manual booking create never hard-fails on checkout rules (including capacity/overlap), matching admin update; use validate endpoints for informational availability

## [4.2.4] — 2026-08-10

### Fixed

- Manual/admin booking create no longer applies the creating user's bookable booking discounts (list price is kept; Admin UI does not send `bookWithoutDiscount`)
- Admin booking update never hard-fails on checkout rules (including capacity/overlap); prices are still recomputed from edited `_bookableUsed.priceCategories`. Use validate endpoints with `excludeBookingIds` for informational availability while editing

## [4.2.3] — 2026-07-31

### Added

- Tenant setting `mailBookingPeriodFormat` (`default`, `fromTo`, `timeFirst`, `long`, `compact`) to control how booking periods are rendered in email booking details

## [4.2.2] — 2026-07-29

### Added

- Booking mails support an optional editable closing snippet (`mailSnippets["{type}__after"]`) rendered after buttons, QR code, and the system footer
- Tenant setting `mailShowSupportFooter` (default `true`) to hide the automatic support-contact footer in booking mails

### Fixed

- **DEV-845:** Group cancellation refund preview lists bookings chronologically by `timeBegin` (with dates in the payload); `createGroupBooking` also sorts attempts by start time before creating
- Mail snippets inherit the tenant mail theme font; hardcoded `font-family` values are stripped at render time so booking details match header/footer typography
- Normalize double-quoted font names in mail HTML (`"Segoe UI"` → `'Segoe UI'`) so inline theme styles are not truncated

## [4.2.1] — 2026-07-22

### Added

- `POST /api/v2/:tenant/checkout/validate-group` — batch-validate series / group booking attempts in one request (avoids storefront 429s from parallel single validates)
- Full-stack operator guide ([getting-started.md](getting-started.md)): wire Admin UI and Storefront to the API, local npm setup, and Docker Compose example (`docker-compose.full-stack.example.yml`)
- Public JSON bookable responses (`/json/:tenant/bookables*`, event tickets) include the tenant `cancellationRefundTiers`

### Fixed

- Docker image base switched from Node 25 to Node 22 LTS so `npm ci` succeeds during image build

## [4.2.0] — 2026-07-17

### Added

- Configurable cancellation refund tiers: refund share can depend on how many days before the booking the cancellation happens; admins can preview and override amounts
- Customers see expected refund amounts before and after self-cancellation (preview and confirmation emails)
- Percentage booking discounts per user or role on bookables (replaces free-booking-only lists); coupons still apply afterwards
- Optional contact hint in booking emails when self-cancellation is disabled, so customers know how to get in touch
- Supervisor notifications on new bookings (single and series), with configurable recipients per membership
- Catalog indicates whether the current user may create series bookings
- Bank details can be included on group booking cancellations (as with single bookings)
- Renaming a user can optionally skip updating names on assigned self-bookings

### Fixed

- Fixed-amount coupons are applied correctly to the total (gross) price and only once per checkout, also for multi-item bookings
- Invoices and receipts present coupon and discount lines more clearly (regular prices, Rabatt labels, discounts after VAT)
- Cancellation PDFs: clearer refund labels, improved table layout, and optional cancellation number prefix only when configured
- No cancel button in booking emails when self-cancellation is turned off
- Deleting custom field definitions also removes their values from affected bookables
- SSO users can again access related bookings, protected files, and private catalogs without token errors
- Bookings created manually by an admin appear in the assigned user’s personal booking list
- Restoring a previously cancelled booking clears stored refund audit data

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

[4.2.5]: https://github.com/ECCdigital/smart-city-booking-backend/compare/v4.2.4...v4.2.5
[4.2.4]: https://github.com/ECCdigital/smart-city-booking-backend/compare/v4.2.3...v4.2.4
[4.2.3]: https://github.com/ECCdigital/smart-city-booking-backend/compare/v4.2.2...v4.2.3
[4.2.2]: https://github.com/ECCdigital/smart-city-booking-backend/compare/v4.2.1...v4.2.2
[4.2.1]: https://github.com/ECCdigital/smart-city-booking-backend/compare/v4.2.0...v4.2.1
[4.2.0]: https://github.com/ECCdigital/smart-city-booking-backend/compare/v4.1.4...v4.2.0
[4.1.4]: https://github.com/ECCdigital/smart-city-booking-backend/compare/v4.1.3...v4.1.4
[4.1.3]: https://github.com/ECCdigital/smart-city-booking-backend/compare/v4.1.2...v4.1.3
[4.1.2]: https://github.com/ECCdigital/smart-city-booking-backend/compare/v4.1.1...v4.1.2
[4.1.1]: https://github.com/ECCdigital/smart-city-booking-backend/compare/v4.1.0...v4.1.1
[4.1.0]: https://github.com/ECCdigital/smart-city-booking-backend/compare/v4.0.1...v4.1.0
[4.0.1]: https://github.com/ECCdigital/smart-city-booking-backend/compare/v4.0.0...v4.0.1
[4.0.0]: https://github.com/ECCdigital/smart-city-booking-backend/releases/tag/v4.0.0
