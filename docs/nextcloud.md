# Nextcloud Integration

Smart City Booking can use a [Nextcloud](https://nextcloud.com/) instance as external file storage. The backend connects via **WebDAV** and keeps the bytes of uploaded and generated files there — not in MongoDB. It is one of two storage providers; the other is S3 (`STORAGE_PROVIDER=s3`).

> **Required for file features:** If you want to use image uploads, booking attachments, receipts, invoices, cancellation PDFs, or the media library on Nextcloud, you **must** configure a reachable Nextcloud instance. Without it, these operations fail with a configuration or service-unavailable error. An installation with legacy files needs it in any case — that is where the media import reads from.

Core booking, availability, and user management work without Nextcloud.

## What is stored in Nextcloud

Everything the platform writes today is a **medium** and lives under the media
key layout — `{tenantId}/media/{mediaId}/original.{ext}` plus one key per
variant, instance media under `_instance/`. Nextcloud is one of two storage
providers for that; the other is S3 (`STORAGE_PROVIDER`).

The trees below are the **legacy stock** of installations that predate the media
library. Nothing writes into them any more; the media CLI moves them into the
media library (see below).

| Use case             | Examples                                      | Legacy path (per tenant)                  |
| -------------------- | --------------------------------------------- | ----------------------------------------- |
| **User uploads**     | Images, documents, booking attachments        | `public/…` or `protected/…`               |
| **Payment receipts** | Generated PDF payment confirmations           | `receipts/`                               |
| **Invoices**         | Generated invoice PDFs                        | `invoices/`                               |
| **Cancellations**    | Generated cancellation PDFs                   | `cancellations/`                          |
| **Instance files**   | Legal documents (terms, privacy policy files) | `public/` / `protected/` (instance level) |

Files are organised per tenant under the Nextcloud user's home directory.

## Configuration

Set these variables in `.env` (see [`.env-example`](../.env-example)):

```bash
NEXTCLOUD_URL=http://localhost:9500
NEXTCLOUD_USERNAME=CHANGE_ME__NEXTCLOUD_USER
NEXTCLOUD_PASSWORD=CHANGE_ME__NEXTCLOUD_PASSWORD
```

| Variable             | Description                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `NEXTCLOUD_URL`      | Base URL of your Nextcloud server (no trailing slash). The backend connects to `{NEXTCLOUD_URL}/remote.php/webdav`. |
| `NEXTCLOUD_USERNAME` | WebDAV user with permission to read and write files                                                                 |
| `NEXTCLOUD_PASSWORD` | Password or app password for that user                                                                              |

### Production recommendations

- Use a **dedicated Nextcloud user** (or app password) for the booking backend only
- Serve Nextcloud over **HTTPS**
- Ensure the backend can reach Nextcloud from its network (firewall, DNS)
- Back up the Nextcloud data directory alongside your MongoDB backups
- `BACKEND_URL` must be set correctly — file download links are generated relative to the API

## API endpoints

Uploading and listing files now happens through the media library
(`/api/v2/:tenant/media` and `/api/v2/instance/media`) — the legacy write and
listing routes are gone. What stays are the two download routes, permanently, as
the resolver of addresses stored in old mails, bookmarks and exports:

- `GET /api/files/get?name=…` — tenant-less legacy address
- `GET /api/:tenant/files/get?name=…` — legacy address of a tenant

Both look a medium up by its **legacy path** — the place the file had in the old
tree, kept on the medium at import. The host of a stored URL is never consulted:
only the path decides. A resolved medium is delivered with the media caching
matrix; a `public` medium is readable anonymously, an `intern` one needs an
active membership in the owning tenant, and a booking document follows the
receipt rule.

Until the media import has run, the same routes still serve the legacy tree
directly — with those same checks, not the old "any signed-in user may read
protected files" rule. Such an installation boots with a warning, never an
error.

## Media CLI — moving the legacy stock

The move is a separate, idempotent CLI, not a boot migration: an update must
never wait on a file move. Every command takes `--dry-run`, which fills the same
report without writing anything.

```bash
node src/cli/media-cli.js import --dry-run
```

| Command        | What it does                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| `import`       | Turns the legacy stock into media, places booking documents and rewrites stored addresses                             |
| `regenerate`   | Generates the image variants of the existing stock, each medium at its own provider                                   |
| `verify`       | Checks that every medium's bytes are where the database says they are                                                 |
| `cleanup`      | Removes stale variant bytes in the key space of known media                                                           |
| `purge-legacy` | Removes the imported files from the legacy tree — separate and explicit, and only where a medium answers for the file |

`import` does three things in order, because a reference can only point at a
medium that exists:

1. **Stock → media.** Everything under `public/` and `protected/`, per tenant and
   tenant-less (the latter become instance media). Folder names become tags, the
   tree decides the visibility, the old place is kept as the legacy path, and the
   bytes are copied to the **currently configured** storage provider — the import
   is the storage move as well. The source is left in place; only `purge-legacy`
   ever removes it. `uploadedBy` stays empty: an imported file has no known
   uploader.
2. **Booking documents.** `receipts/`, `invoices/` and `cancellations/` are matched
   against the `title` and `name` of the booking attachments. An aggregated
   document becomes one medium per booking it names; a file no attachment names is
   reported as an orphan and left alone.
3. **Stored addresses → media references.** Bookable cover images and attachments,
   every image site of an event (teaser image, contact person image, image list
   and speaker photos) and its attachments, instance branding and legal
   documents, and the attachment copies on bookings. Addresses that are not ours
   stay external references, and tenant and instance scopes never resolve into
   each other. The step is idempotent, so an installation that already imported
   picks the sites added since up by running `import` again.

A typical run:

```bash
node src/cli/media-cli.js import
node src/cli/media-cli.js regenerate
node src/cli/media-cli.js verify
```

Only once `verify` is clean is `purge-legacy` worth running. The CLI never
deletes as a side effect of anything else.

## Local development

For local testing you can run Nextcloud via Docker, for example on port `9500`:

```bash
NEXTCLOUD_URL=http://localhost:9500
```

Point the credentials at a user that exists in your local Nextcloud instance.

## Troubleshooting

| Symptom                                      | Likely cause                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `Nextcloud configuration is missing`         | One or more `NEXTCLOUD_*` env vars are unset                              |
| `Nextcloud service is currently unavailable` | Nextcloud unreachable, wrong credentials, or WebDAV disabled              |
| Receipt/invoice generation fails             | Nextcloud not configured or write permission missing for the service user |

Check backend logs (`file-manager.js`, `file-controller.js`, `receipt-service.js`, `invoice-service.js`, `cancellation-service.js`) for detailed error messages.
