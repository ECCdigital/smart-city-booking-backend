# Changelog

Notable changes for the Smart City Booking Backend.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Releases are tagged `v4.x.x` from branch `version/4.x`.

## [Unreleased]

### Changed

- Locker fold, step 3 of 4: the checkout runs on the access seam. `BundleCheckoutService` no longer allocates compartments (`getLockerInfo` and `adminOverrides.lockerInfo` are gone); `BookingService` holds them with `AccessService.holdForBooking` right after the booking is stored - a hold that fails rolls the booking back as before (deleted, coupon given back) - grants them with `provisionForBooking` on payment, commit and un-reject, takes them back with `revokeForBooking` on reject and delete, and moves them with `updateForBooking`; a grant that fails after the payment leaves the booking paid, the failure stands in the access audit log. The two payment entry points renew the holds with `refreshHolds` and answer a lost one as 409 `locker_unavailable` (code 3 at `POST /payments`) as before. More than one Pareva compartment of one size in one booking is now told apart by its own rental, so lowering the amount and cancelling reach every rental
- `booking.lockerInfo` is a read field derived from the `accessInfo` entries of type `locker`, in the shape it had (`id`, `lockerSystem`, `bookableId`, `isConfirmed`, `processId`, iFBS' `ifbsMetadata { boxId, nummer, price, bookingId }`); it goes out with the booking as before, a value sent in is ignored, and it is no longer stored. The seam's `Hold` and `Grant` gained an optional `metadata` (iFBS: box id and price) kept at the entry for it. Until the migration of step 4, bookings stored before this step read as having no compartments
- Until the migration of step 4 the locker systems stay configured at the bookable as `lockerDetails.units`: `AccessService` stands in for their `accesspoints` rows with synthesized ones (id `locker:<provider>:<externalId>`, capacity the unit's amount, occupancy the unrevoked compartments the concurrent bookings have at the size - bookings stored before this step count only once the migration of step 4 has made entries of them), for units whose provider the tenant has an active application for; a bookable that references a stored locker system is left to its rows. `holdForBooking` additionally drops held-only compartments beyond what an unpaid booking books after a change
- Deleted: `LockerService` (with its in-process `reservedLockers`), `BaseLocker`, `IfbsLocker`, `ParevaLocker`, the locker registry; the locker client registry and `LockerInfoService` stay for the `/locker` routes until step 4
- Locker fold, step 2 of 4: compartments are `accessInfo` entries (`accessPointType: locker`) at stored access points of type `locker`, one per compartment, told apart by `grant.authorizationId` and carrying `bookableId`, `hold`, `compartment`, `externalBookingId`. `AccessService` gains `holdForBooking` (provider hold, or a platform hold checked against `bookable.amount`: 409 `compartments_unavailable`) and `refreshHolds`; provisioning consumes the hold and always grants a compartment (iFBS' `mode: remote` too), revoking revokes each by its own grant, an update with changed time or allocation revokes and re-grants them all. The synthesis from `booking.lockerInfo` is gone; the checkout still runs through `LockerService` until step 3
- Compartments are listed and operated under an opaque id of their own (`<accessPointId>:<authorizationId>`, `<accessPointId>:hold` before the grant); `GET /access` adds `compartment` (iFBS' box number, `null` at Pareva) and reports `isProvisioned` as granted and not revoked. The access decision treats a compartment like a door that only takes a code (`not_provisioned`, `authorization_revoked`) and asks it for the evidence its locker system's rules demand. iFBS grants name the box as `compartment`; the audit log gains the action `hold`
- Locker fold, step 1 of 4: both locker providers speak the access provider seam, which gains the optional capability `hold`/`refreshHold` answering a `Hold { holdId, expiresAt, compartment }`. `IfbsAccessProvider` holds a box, confirms it as the grant, gives it back on a revoke (cancel before the usage began, end after; idempotent) and lists the locations. New `ParevaAccessProvider`: a grant is a rental (Pareva mails the code itself), a revoke cancels it, the sizes are listed; no `open`, `getStatus` or `hold`. Both find the tenant's application as `access` first and as `locker` second
- `IfbsAccessProvider` no longer declares `getStatus`, which without an open process only ever answered unknown: `GET …/status` at an iFBS locker still answers unknown, and the projection lists its capabilities as `["open"]`
- `IfbsApiClient`, `IfbsApiError` and `ParevaApiClient` moved to `access/clients/`; the Pareva client gained `listSizes`/`startRental`/`cancelRental`, and the locker stack calls it instead of raw axios. The checkout is unchanged: `LockerService` keeps running, and characterization tests pin what it leaves in `booking.lockerInfo` and at the providers
- The never-produced blocking reason `locker_not_ready` is gone from the vocabulary, the audit labels and the OpenAPI enum

- A door that only takes a code (`mode: authorization`) is operable only while its grant is there and not revoked: without one, `canOperate` and `operableAccessPointIds` in `accessEligibility` no longer include it, and close/status/open-status answer 403. Doors that also open remotely stay operable; the missing or revoked grant remains a hint in `blockingReasons`
- Open and unlatch through the API go only to doors with a remote way in (`mode: remote` or `both`); at a door that only takes a code the attempt is refused with `no_remote_access` (HTTP 200 soft failure, audited as `denied`) instead of being sent to the provider. The booking list carries the set as `remoteOperableAccessPointIds`
- The access decision is one module: `access-decision.js` answers with `decide` (role, operable access points, blocking reasons, what evidence each door demands) and `satisfy` (evidence against the rules of one door); open/unlatch, close/status, `canView`, the access point list and the bookings list all read it. No behaviour change; `accessEligibility` in `GET /access/bookings?includeEligibility=true` additionally carries `remoteOperableAccessPointIds`, `evidenceWaived` and `demandedEvidence`
- **Schema change** `booking.accessInfo[]`: the grant is stored as `grant: { authorizationId, externalPrincipalId, secret }` (secret encrypted) plus `principalRemovedAt`, `principalCleanupAttemptedAt`, `principalCleanupError`; the flat `authorizationId`, `accessId`, `saltoUserId`, `pin`, `providerResponse` and `saltoUser*` fields are gone. Migration `02-09-2026-move-access-grants` converts existing entries (idempotent, `down` restores all but `providerResponse`). `accessInfo` still goes out raw in the booking GET
- Access provider seam: `grantAuthorization` answers a `Grant`, `revokeAuthorization(accessPoint, grant)` a `Revocation`; a revoke is idempotent at every provider, so a grant already gone at the provider is recorded as revoked instead of left provisioned. Provision/revoke audit payloads carry the grant without its secret
- NUKI keypad grants send type and code as the Web API numbers them, keep the name within 32 characters, generate codes Nuki accepts (digits 1-9, not starting with 12) and read the authorization id from the listing, since Nuki creates authorizations asynchronously without answering one
- The Salto-only cleanup job is now the provider-neutral `grant-cleanup-service`, revoking again through the seam wherever a grant's external principal is still there. Env `GRANT_CLEANUP_ENABLED` / `GRANT_CLEANUP_INTERVAL_MS` replace `SALTO_KS_CLEANUP_*`, which still count where they are the only ones set

- Access provider seam typed: `open`/`unlatch` answer an `OpenOutcome`, `getStatus` a `LockStatus`, `close` nothing, and the new `getOpenProgress` (capability `getOpenProgress`, iFBS) an `OpenProgress`; the audit log stores these instead of the raw provider answer. `open`/`unlatch` throw only `AccessOpenError` at every provider now, so NUKI and iFBS failures reach the client as `openFailure` instead of HTTP 500. HTTP shapes are unchanged; a failed iFBS poll at `/open-status` reports `open`/`confirmed` as `null` (unknown) instead of `false`, and iFBS lockers no longer declare `close` (the API has no command for it)

### Added

- Access provider contract test against NUKI, Salto KS, iFBS and an in-memory test provider, plus characterization tests that pin today's provider dialects. Access providers accept an injected API client (`{ client }`) for tests; production behaviour is unchanged

- Manual price per bookable item: `bookableItems[].manualPriceEur` (net, per unit) on the admin booking API (`PUT /api/:tenant/bookings`). Under the `ADMIN_MANUAL` checkout policy it replaces the price that categories or external providers would yield — VAT, amount and coupons apply as before — and it stays on the stored item until the admin clears it (`null`), so moving the booking never silently reprices it. A self-service checkout that carries the field has it stripped (on copies — the caller's items are left untouched), so it can never reach a stored booking. Until now the Admin UI could only express an entered price by rewriting one price category of the item, which silently missed whenever that category did not match the booking date
- QR door access: scan-code QR generation & rotation — `GET /api/:tenant/accesspoints/:id/qrcode?format=svg|png|pdf` (default `svg`) renders the printable QR code, `POST /api/:tenant/accesspoints/:id/rotate-scan-code` retires the current scan code and mints a new one. Requires the new global env var `STORE_FRONT_URL` (public store-front base URL, used to build `https://<STORE_FRONT_URL>/mobile-key/<tenant>/<scanCode>`; not the Vue admin app that `FRONTEND_URL` points at)
- QR door access: location prefill from the provider — `GET /api/:tenant/accesspoints/:id/location-prefill` suggests where the lock stands via the optional provider capability `getLocation` (NUKI returns coordinates without address; Salto KS and providers without the capability return `null`). `getLocation` support is exposed in `providerCapabilities` of `GET /api/:tenant/access-apps/providers`. The endpoint writes nothing; adopt the suggestion via `location` in the regular `PUT /api/:tenant/accesspoints`

- Salto KS remote open per the spec: IQ activation wizard under `GET/POST/DELETE /api/:tenant/access-apps/salto-ks/iqs…` (`MANAGE_TENANTS`; first secret stored encrypted before the PIN mail, PIN entered once by the admin, activation via `PUT …/pin` with `delta:"0000"`), the backend computes the Salto-OTP itself on every open (max one per attempt; `otp_blocked` starts a 25-min local backoff, 3× `otp_invalid` degrades the activation), and `supportedModes` follow the capability rule (keypad lock types keep `authorization`, `remote` needs an activated IQ — or none for IQs without `otp_enabled` — and no `restore_required`). `POST …/salto-ks/test` additionally reports `remote_access` and the per-IQ activation state; the remote locking right is declared not verifiable

- Media library core: new `media` collection (schema/model/entity/manager) as the single source of truth for platform-managed files, plus a shared media reference sub-document (`{ source: "media" | "external" }`) for later use at bookables, events and the instance
- Storage abstraction with exactly seven operations (`put`, `getStream`, `getBuffer`, `stat`, `delete`, `deleteMany`, `deletePrefix`) and a provider-neutral `StorageError`; Nextcloud (WebDAV) and S3 (AWS SDK v3, `S3_ENDPOINT` + `S3_FORCE_PATH_STYLE` make MinIO pure configuration) implement it. Keys follow the media identity (`{tenantId}/media/{mediaId}/original.{ext}`, instance media under `_instance/`); reading follows the provider stored on the medium, `STORAGE_PROVIDER` only steers new uploads
- `/api/v2/:tenant/media` endpoints: upload (one file per request), paginated listing with `kind`/`tag`/`q`/`visibility` filters, metadata read and PATCH (never the file), original download and delete (database document first, bytes best-effort). `public` media are readable anonymously, `intern` media require an active membership in the owning tenant. Documented in OpenAPI from the start
- Boot check for the storage configuration: an explicitly set `STORAGE_PROVIDER` with missing variables aborts the boot; the implicit Nextcloud default only warns
- Media upload hardening: the type is decided from the content (magic bytes via `file-type`, plus a sharp decode for images), never from the file name; the allowlist is JPEG, PNG, WebP, GIF, SVG and PDF. Per-kind limits come from `MEDIA_MAX_IMAGE_SIZE_MB` (15) and `MEDIA_MAX_DOCUMENT_SIZE_MB` (50)
- Global `express-fileupload` limit for every upload route (`MEDIA_UPLOAD_BACKSTOP_SIZE_MB`, by default 5 MB above the largest media limit) — the upload middleware ran without any option before
- Image variants `thumb` (160×160 crop), `sm`/`md`/`lg` (480/800/1600 wide, never enlarged), all WebP, generated synchronously on upload: a failing variant fails the whole upload and already written bytes are removed again. Presets that would not shrink the original produce no variant, SVG originals are rasterised for all presets, animated GIFs become stills, documents get none
- `GET /media/:id/file?size=<preset>` serves variants and degrades to the next larger variant and finally to the original, so a preset choice never 404s; an unknown preset name is a 400. SVG originals are served as a download
- Caching matrix for media delivery: public originals immutable for a year, public variants cacheable for a day with a strong ETag from the variant checksum, internal media `private, no-cache` with an ETag, booking documents `private, no-store` — including `304` handling, in a shared helper (`commons/utilities/cache-headers.js`)

- Role group `manageMedia` (the usual seven booleans, ownership is the uploader) and the admin interface `media`; media create/update/delete run through the `PermissionService` with own/any semantics. Listing and metadata reading are the picker right (`readAny` shows the whole library, `readOwn` only one's own uploads); the binary route keeps following the visibility of the medium
- Migration `26-08-2026-add-manage-media-role-group` mirrors `manageBookables` into `manageMedia` for every role and adds the `media` admin interface wherever a bookable interface is managed, so no existing admin loses a workflow
- Receipts, invoices and cancellations are stored as booking document media (non-empty `bookingIds`) instead of raw Nextcloud files. An aggregated document is one medium with one byte copy, referencing every booking of its group. Reading follows the receipt rule — `manageBookings.readAny` or the owner of any referenced booking, so customers reach their own invoices without a role — and the existing booking download routes keep working as a facade, falling back to the legacy Nextcloud tree for documents written before this change. Booking documents never appear in the library listing or picker, and cannot be deleted through the API

- `GET /api/v2/:tenant/media/:id/usage` answers the usage proof of a medium — every bookable, event, booking and the instance that references it, searched on demand over the reference sites; there is no `usedBy` field and no back reference at the medium. Read like the metadata
- Deleting a medium that is still in use answers `409` with exactly the body of `/usage`, so the admin UI shows one list no matter which call produced it. Without usage, deletion stays final: database document first, bytes best-effort — the whole storage folder of the medium is removed (`deletePrefix`), so no empty folder stays behind on WebDAV; a failed byte removal leaves an accepted orphan for the later media CLI to clean up
- Removing a booking now cascades to its documents (system receipts included): each document loses that booking's reference before the booking itself goes, and a medium is deleted with its last reference, on the same database-first, bytes-best-effort path
- One imported legacy file is one medium per tenant: partial unique index on `{tenantId, legacyPath}` (built once pre-model-change imports are purged); deliberately no checksum-based dedup — deduplication follows file identity (legacy path, booking group), never content

- Bookables carry an ordered image list (`images`) of media references instead of a single image; position 0 is the cover image, so reordering the list changes the cover and an empty list means there is none. `imgUrl` stays in exports as a derived read field with the address of the cover image, so storefront v4 and the HTML endpoint are unchanged — the HTML endpoint still shows only the cover image
- Every image site of an event is a media reference now — teaser image, contact person image, the image list (`images`) and the photo of each speaker (`eventOrganizer.speakers[].image`). All of them keep going out under their old names as the address they resolve to, so the public structure and the HTML markup are unchanged; the image list stays a plain list, the title image of an event is and stays the teaser image. With that the usage proof covers the whole event, and deleting a medium that only hangs on a speaker or in the image list is blocked instead of silent
- Attachments of bookables, events and bookings carry a media reference under `reference` next to their context fields (`title`, `caption`, `show`, `required`, `mailAttach`); the checkout copies it into the booking. Exported references are enriched with the delivery URL
- Saving a bookable or event validates every medium it references: it has to belong to the tenant, the saver needs the picker right, and a publicly visible entity may only reference `public` media
- `mailAttach` attachments that are media references are read through the media service instead of an HTTP self-call to the platform's own public URL — which is why `mailAttach` now works for `intern` media too. External references are still fetched over HTTP
- Media images in mails follow the visibility of the medium: a public image is embedded at `?size=sm`, an intern one is only linked, since a mail client fetches images anonymously

- `/api/v2/instance/media` opens the media library for instance-wide content: the same routes as the tenant library, addressed with `instance` where a tenant id would stand, for media without a tenant (keys under `_instance/`). Managing it belongs to the instance owner alone, and `intern` means any signed-in user of the instance — there is no tenant whose membership could narrow it. Instance and tenant media stay strictly separated in both directions: neither appears in the other's listing, and neither can be referenced from the other's entities
- Instance branding and legal documents carry media references (`branding.logo`, `branding.favicon`, and `reference` inside `dataProtection`/`legalNotice`/`termsAndConditions`); `branding.logoUrl`/`faviconUrl` and the `url` of each legal document stay as derived read fields, so nothing downstream has to learn about media. Both are absolute addresses, as branding always was: the store front fetches the logo server side and puts a document URL into an `href`, and has no origin of the platform to resolve a relative one against. Saving them validates that the medium is an instance medium the instance owner may pick, and branding takes `public` media only
- ICO joins the upload allowlist for favicons. It passes on its magic bytes alone and gets no variants — sharp cannot read it
- `media-cli relocate --to <nextcloud|s3> [--tenant <id>]` moves the media stock between storage providers: per medium copy all files under unchanged keys, verify size (and checksum where stored) at the target, then flip `storage.provider` — a medium moves as a whole or not at all, and the bytes at the old provider stay in place for the operator to remove

- Media CLI (`node src/cli/media-cli.js`) with `import`, `regenerate`, `verify`, `cleanup`, `purge-imported`, `purge-legacy` and `relocate`, each with `--dry-run` and a report of what was processed, skipped, left unplaced or failed. Deliberately not a boot migration: an update never waits on a file move. Every command is idempotent — a second run changes nothing
- `import` turns the whole legacy file stock into media: `public/` and `protected/` of every tenant and the tenant-less trees (which become instance media), folder names become tags, the tree decides the visibility, and the place a file had is kept as its legacy path. Bytes are copied to the currently configured storage provider, so the import is the storage move as well; the source is left where it is and `uploadedBy` stays empty. Variants follow with `regenerate`
- `import` then converts every stored address into a media reference — bookable cover images and attachments, every image site of an event and its attachments, instance branding and legal documents, and the attachment copies on bookings. Resolution is host-independent: stored URLs carry the host of the environment they were uploaded in, so only the path decides. Addresses that are not ours stay external references, and tenant and instance scopes never resolve into each other
- Legacy booking documents (`receipts/`, `invoices/`, `cancellations/`) are placed by matching their file name against the `title` and `name` of the booking attachments; one legacy file becomes one medium referencing every booking it names. A file no attachment names is reported, never guessed
- `purge-imported` takes an import back so it can run from scratch: it removes every medium carrying a legacy path (`--tenant` narrows it to one tenant) and leaves the legacy tree, which is what the next `import` reads, untouched. Entities that still reference one of the media stop the whole run before anything is deleted, since the import may already have rewritten stored addresses. Bytes go best-effort, so a key the storage keeps is reported as an orphan — `cleanup` can no longer reach the key space of a deleted medium. The report names the duplicate legacy-path groups it found and what each scope is left with
- `GET /api/files/get` and `GET /api/:tenant/files/get` stay for good as the resolver of stored legacy addresses: they look a medium up by its legacy path and deliver it with the media caching matrix. Until the import has run they still serve the legacy tree directly — but with the media permission checks in front of it, so a protected file now needs an active membership in the owning tenant instead of any session at all. Once the import has run, the library is the whole truth and an unknown address is a `404`
- An installation whose media import has not run boots with a warning, never an error

- Tenants carry their own legal documents (`legalDocuments`): a list of `{ type, title, reference }` with the types `dataProtection`, `legalNotice`, `termsAndConditions`, `rightOfWithdrawal` and `other`. A known type may appear only once and carries no title; `other` needs one and no two may share it. Unlike the instance documents this is a typed subdocument list — the tenant has no legacy stock to keep readable. Migration `28-08-2026-add-tenant-legal-documents` starts the field empty everywhere
- Tenant legal documents are a media reference site: the usage proof and the deletion block cover them, so a medium a tenant document references answers `409` with the new usage type `tenant` instead of being deleted. The matching save-time check is in place in the media reference guard — the medium has to belong to the tenant, the saver has to be allowed to pick it, and it has to be `public`, since a legal document is meant to be published — and takes effect once the tenant API accepts the field
- `legalDocuments` travels with the existing tenant API, without an endpoint of its own: `PUT /api/tenants` takes the field and refuses a broken list or a medium that may not be referenced with its own code instead of a blanket `500`, and the tenant reads back with every reference carrying the address it resolves to. The permission is the one that was already there, tenant or instance ownership, and the public tenant export is unchanged

### Fixed

- Defects found in passing by the architecture review of 2026-09-01: booking references are now really checked for uniqueness before a new booking takes one (the check read `.id` off a promise and never fired), `GET /api/payments/response` no longer treats `aggregated=false` as aggregated, checkout checks name their own reason code (`checkout.duration_too_short`, `checkout.duration_too_long`, `checkout.bookable_not_bookable`, also for the iFBS minimum duration) instead of the resolver guessing it from German prose, two stray `console.log` calls are gone and the receipt service and the PDF browser log under their own names
- A mandatory checkout addon that was already in the cart with a mismatched amount is priced once instead of twice — the checkout corrected the amount but also appended the same item again, so `POST /checkout` charged the addon double while `validate-group` priced it correctly
- The public bookable routes (`/bookables/public`, `/bookables/public/:id`) resolve media references again — they serve the raw entity, whose stored references carry no `url` since the media library, so the storefront checkout lost its cover image (`imgUrl` empty, `images[].url` null) while the JSON embed interface kept working through `exportPublic`
- Nextcloud storage uses the `/remote.php/dav/files/{user}` endpoint instead of the legacy `/remote.php/webdav`. The legacy endpoint answers PROPFIND on a missing path with a malformed 207 multistatus instead of a 404, which crashed the webdav client during recursive directory creation and made every media upload fail with `storage_put_failed`
- The HTML and JSON embed interfaces resolve media addresses to absolute URLs (`BACKEND_URL`) again — cover images (`imgUrl`), image lists, event teaser/speaker images and attachment links were relative delivery routes since the media library, which foreign websites embedding the interfaces cannot load. The storefront and admin API keep their relative URLs
- Attachments with a media reference render a working link in the HTML detail views — the raw stored entry has no `url` anymore
- Storage failures no longer write credentials into the log. A raw webdav or axios error carries its whole request — `Authorization` header and session cookies included — and bunyan without an error serializer wrote all of it out; the media, storage and legacy-file loggers now use the standard serializer, which keeps the message and the stack and nothing else
- A legacy tree that does not exist is logged at debug instead of error. The media import asks after every tree an installation could have, and an installation without cancellations does not have a `cancellations/` folder — those misses buried the report the command exists to produce

### Changed

- Checkout policy: one value (`SELF_SERVICE` | `ADMIN_MANUAL`) crosses the checkout interface instead of the flag combination `manualBooking` + `bookWithoutDiscount` + `capacityChecksOnly` + `excludeBookingIds`. What a policy means is decided in one module (`checkout-policy.js`): under `ADMIN_MANUAL` no checks run, discounts are always suppressed, mandatory addons are not auto-added, admin-entered prices are authoritative and the invoice permission is not checked. The `Manual*` checkout service classes are gone; the base services interpret the policy, accept an admin-overrides object (`ADMIN_MANUAL` only) and take an optional bookable snapshot in `init`. Behavioural fixes riding along: external booking providers now receive the checkout id (`userID`) on manual bookings — the manual constructors silently dropped it — and all items of one checkout share one external-provider cache
- Terminology: `CONTEXT.md` defines „Checkout-Policy", „Selbstbuchung" and „Manuelle Buchung"
- Access open/unlatch: the `otp` request parameter is gone for good — providers that need an OTP compute it themselves. Provider failures after passed checks now answer soft (`success: false`, `data.openFailure: "temporary" | "configuration"`) instead of HTTP 500; details stay in the access audit
- Docs: Salto KS remote open specified after the successful door proof — integration spec `docs/specs/salto-ks-remote-open.md`, ADR 0002 (IQ activation via API only, never via the app), ADR 0001 status updated to proven, glossary entries corrected
- Docs: Salto KS research corrected to the proven state — API contract §9 resolution (app activation rotates the secret, real `delta` causes the PIN ambiguity; the API path works), positive-run addendum in the door-proof doc, remote-open status in the access-points tracking board
- Salto KS access app: the free-text `apiBaseUrl` is replaced by `environment` (`accept` | `production`, default `accept`); the backend derives Connect API and identity server from it (accept: `clp-accept-user.my-clay.com` + `identity-acc.eu.my-clay.com`, production: `connect.my-clay.com` + `identity.eu.my-clay.com`, overridable via `SALTO_{ACCEPT,PRODUCTION}_{API_BASE_URL,IDENTITY_URL}`; the global `SALTO_IDENTITY_URL` is gone). A stored legacy `apiBaseUrl` is tolerated and only read to tell the environment. `POST /api/:tenant/access-apps/salto-ks/test` accepts `environment` and now reports the identity server's `error`/`error_description` (e.g. `invalid_client: …`) or the Connect API `Message` instead of the bare HTTP status
- The media CLI resolves its `.env` from the repository rather than the working directory, so it runs from anywhere; a failing command prints its error instead of the whole help text
- Who may read the file of a medium now lives in one media access service instead of the media controller, so the media route and the legacy resolver answer the question identically
- `applyCacheHeaders` also owns `Last-Modified` and its `If-Modified-Since` comparison, for the legacy resolver, which serves bytes it has no checksum for

### Removed

- The tenant-less `GET /api/files/list` and `POST /api/files` are gone, replaced by `/api/v2/instance/media`; the upload route ran without any authentication middleware
- The tenant file listing `GET /api/:tenant/files/list` and the upload `POST /api/:tenant/files` are gone with the admin UI switching to the media library. `GET /api/:tenant/files/get` stays as the resolver of legacy addresses

### Notes

- Booking documents are the system receipts the platform writes itself; the API refuses to delete them (`booking_document_not_deletable`), they only cascade with their booking
- Legacy plain URLs (`imgUrl` of a bookable, the image fields of an event, the `url` of an attachment) stay readable and are read as external references until the media import converts them; nothing is rewritten on save
- `purge-legacy` removes only files a medium answers for; whatever the import could not take — an unplaced booking document above all — stays in the tree and is reported. `cleanup` reaches the key space of known media only, because the storage contract has no `list`: bytes of an already deleted medium remain the operator's to remove
- New dependencies `sharp` and `file-type`; sharp ships prebuilt binaries, tune it with `MEDIA_IMAGE_MAX_PIXELS` and `MEDIA_SHARP_CONCURRENCY`

## [4.2.6] — 2026-08-25

### Added

- Custom field definitions support `usageOptions.showInMail` (checkout fields only, enforced on write): flagged fields render as `Label: Wert` lines in the booking-details block of all booking mails; empty values show as "nicht angegeben"
- Mail-visible custom field values render type-aware via `CustomFieldService.formatValueForDisplay`: booleans as "Ja"/"Nein", selects as the option caption (raw value if the option was deleted), numbers as strings
- Migration `25-08-2026-customfield-show-in-mail` backfills `usageOptions.showInMail: false` on existing custom field definitions (instance, tenant, bookable) so all fields stay opt-in

### Fixed

- Admin booking update no longer applies the assignee's bookable booking discounts when recomputing prices (same as manual create; Admin-entered list prices from `priceCategories` are kept)

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

[4.2.6]: https://github.com/ECCdigital/smart-city-booking-backend/compare/v4.2.5...v4.2.6
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
