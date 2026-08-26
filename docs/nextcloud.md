# Nextcloud Integration

Smart City Booking uses a [Nextcloud](https://nextcloud.com/) instance as external file storage. The backend connects via **WebDAV** and stores all uploaded and generated files there — not in MongoDB.

> **Required for file features:** If you want to use image uploads, booking attachments, receipts, invoices, cancellation PDFs, or instance/tenant file management, you **must** configure a reachable Nextcloud instance. Without it, these operations fail with a configuration or service-unavailable error.

Core booking, availability, and user management work without Nextcloud.

## What is stored in Nextcloud

| Use case             | Examples                                      | Storage path (per tenant)                  |
| -------------------- | --------------------------------------------- | ------------------------------------------ |
| **User uploads**     | Images, documents, booking attachments        | `public/…` or `protected/…` (via file API) |
| **Payment receipts** | Generated PDF payment confirmations           | `receipts/`                                |
| **Invoices**         | Generated invoice PDFs                        | `invoices/`                                |
| **Cancellations**    | Generated cancellation PDFs                   | `cancellations/`                           |
| **Instance files**   | Legal documents (terms, privacy policy files) | `public/` / `protected/` (instance level)  |

Files are organised per tenant under the Nextcloud user's home directory. The backend creates subfolders automatically when uploading.

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

File operations are exposed through the backend API. The backend proxies requests to Nextcloud.

**Instance level:**

- `GET /api/files/list` — list instance files
- `GET /api/files/get` — download instance file
- `POST /api/files` — upload instance file

**Tenant level:**

- `GET /api/:tenant/files/list` — list tenant files (public; protected with auth)
- `GET /api/:tenant/files/get` — download tenant file
- `POST /api/:tenant/files` — upload tenant file

Uploads accept `accessLevel` (`public` or `protected`) and an optional `customDirectory` subfolder.

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
