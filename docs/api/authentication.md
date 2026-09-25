# Authentication

The backend uses JWT-based authentication. On successful sign-in, the API returns an `accessToken` and `refreshToken`.

For protected routes, send the access token in the `Authorization` header:

```http
Authorization: Bearer <accessToken>
```

## Routes

### POST /auth/signin

Sign in a user and receive JWT tokens.

**Request body:**

```json
{
  "id": "someone@example.com",
  "password": "your-password"
}
```

**Response:** `{ user, permissions, accessToken, refreshToken }`. `permissions.tenants[]` carries, per active membership of the user, the merged role levels and the tenant's supervision (see [Tenant supervision in the sign-in](#tenant-supervision-in-the-sign-in)). The SSO and card sign-ins answer the same `permissions`.

### POST /auth/refresh

Exchange a refresh token for new `accessToken` and `refreshToken`.

**Request body:**

```json
{
  "refreshToken": "your-refresh-token"
}
```

### POST /auth/signout

Sign out the currently authenticated user (revokes the active token; optional refresh token in body).

### POST /auth/signup

Register a new user. The answer is account-neutral: `201` whether or not the address already has an account. An existing account is never duplicated; if it is still unverified, it receives its verification mail again (within the verification mail limits below), a verified one receives nothing. `400` when `id` or `password` is missing, `429` with `Retry-After` (seconds) past the per-IP limit — no account is created then.

**Request body:**

```json
{
  "id": "someone@example.com",
  "password": "your-password",
  "firstName": "First Name",
  "lastName": "Last Name",
  "verifyUrl": "https://store.example.com/auth/verify",
  "nextUrl": "/tenants/new"
}
```

### POST /auth/check-email

Answers `200` for every well-formed address, known or not (`400` without `email`). It no longer tells whether an address is registered; clients that used the former `409` to prefill a "sign in instead" hint must not rely on it.

**Request body:**

```json
{ "email": "someone@example.com" }
```

### POST /auth/resend-verification

Sends the verification mail of an unverified account again. Answers `202` with the same body for a known unverified, a known verified and an unknown address (`400` without `id`). The per-account limits (1 per minute and 5 per hour) apply silently; the per-IP limit (30 per hour) answers `429` with `Retry-After` for every address alike. A new mail invalidates the earlier verification links of the account.

**Request body:**

```json
{
  "id": "someone@example.com",
  "verifyUrl": "https://store.example.com/auth/verify",
  "nextUrl": "/tenants/new"
}
```

`verifyUrl` (optional) is the client's own verify page; the verification mail links it with `?token=<hookId>&id=<email>`. Without it the mail links `GET /auth/verify/:hookId`.

`nextUrl` (optional) is the return target (Rückkehrziel): where the client sends the user once the account is verified and signed in, e.g. the tenant self-creation the user came from. It is kept on the verification hook and travels with the flow: the mail link gains `&next=<encoded nextUrl>`, `POST /auth/verify-email` answers it, and `GET /auth/verify/:hookId` redirects to `<FRONTEND_URL>/email/verify?next=<encoded nextUrl>`. Only a relative path (`/…`, not `//…`) or an absolute `http(s)` address on the origin of `verifyUrl` or of `FRONTEND_URL` is kept; anything else is dropped silently. The client carries the target from its verify page to the login and on.

### POST /auth/verify-email

Verify a user with the token and address from the verification mail's link.

**Request body:**

```json
{
  "token": "<hookId>",
  "id": "someone@example.com"
}
```

**Response `200`:**

```json
{
  "success": true,
  "message": "Email verified successfully",
  "nextUrl": "/tenants/new"
}
```

`nextUrl` is the signup's return target, `null` when the signup named none. Failures answer their status with a plain text message (`400` bad token or id mismatch, `404` unknown, `410` already verified).

### GET /auth/verify/:hookId

Verify a user using the hook ID generated during signup.

## Verification proof

The self-service actions of the tenant supervision (e.g. the self-creation of a tenant) need a verified account, and the server re-checks it on the action; a login alone is not enough. What counts as proof (Verifizierungsnachweis):

- a local or card account: its e-mail verification (`isVerified`, set by the released verification hook — or by an instance administrator through the user administration, which counts the same)
- an SSO account: the identity provider's confirmation of the e-mail, persisted on the user as `idpEmailVerifiedAt` (Date) and `idpEmailVerifiedProvider` (`keycloak`) when a `POST /auth/sso/signup` or `POST /auth/sso/signin` carries Keycloak's `email_verified: true` claim. The first proof stands. An SSO account whose provider has not confirmed the e-mail has no proof — the `isVerified: true` every SSO signup sets is an activation flag, not a proof.

Both fields are part of the user object the auth routes answer (`user.idpEmailVerifiedAt`, `user.idpEmailVerifiedProvider`, next to `user.authType`). The claim is read on the SSO routes only; a Keycloak bearer session that never passed `POST /auth/sso/signin` gains its proof at its next SSO sign-in.

Server-side the check is `assertVerifiedForSelfService(user)` (`src/commons/services/user/verification-proof.js`), fed the stored user (`UserManager.getUser(id)`), not the slim `req.user` of the auth middleware.

An action without proof is refused with `403`:

```json
{
  "error": "ForbiddenError",
  "code": "email_verification_required",
  "statusCode": 403,
  "params": { "method": "email", "provider": null }
}
```

`params.method` names the way to get one: `email` (verify the e-mail address) or `identity_provider` (confirm the address at the provider named in `params.provider`, e.g. `keycloak`).

### GET /auth/reset/:hookId

Reset a user's password via a hook.

### POST /auth/resetpassword

Update the password using the hook data.

**Request body:**

```json
{
  "id": "someone@example.com",
  "password": "new-password"
}
```

### GET /auth/me

Retrieve data of the currently authenticated user: `{ user, permissions }`, the same `permissions` as the sign-in.

## Tenant supervision in the sign-in

Every entry of `permissions.tenants[]` (`/auth/signin`, `/auth/me`, `/auth/sso/signin`, `/auth/card/signin`) carries the supervision of that tenant (glossary „Aufsichtsstufe“), so the Admin UI can mark a declined or waiting tenant before its first request:

```json
{
  "tenantId": "tenant-1",
  "isOwner": true,
  "supervisionLevel": "declined",
  "supervisionChangedAt": "2026-09-24T10:00:00.000Z",
  "supervisionReason": "Kein Impressum"
}
```

`supervisionLevel` is `free | supervised | pending | declined` (a tenant without a stored level reads `free`), `supervisionChangedAt` the latest level change or `null`, `supervisionReason` the reason of that latest change (glossary „Begründung des jüngsten Stufenwechsels“) or `null`.

## The declined tenant: the membership rests

A declined tenant (glossary „abgewiesen“) is closed to its own people. The membership of its tenant owners and members rests (glossary „Ruhende Mitgliedschaft“): the principal is loaded with it resting - no member, no tenant owner, no role level there - so every path that decides rights meets it, the route markers, the handlers' second decisions and the instance routes that ask per tenant alike. A request `authorize` refuses to them answers:

```http
HTTP/1.1 403 Forbidden
{
  "error": "ForbiddenError",
  "code": "tenant_declined",
  "statusCode": 403,
  "params": {
    "tenantId": "tenant-1",
    "supervisionLevel": "declined",
    "supervisionChangedAt": "2026-09-24T10:00:00.000Z",
    "supervisionReason": "Kein Impressum"
  }
}
```

This holds for every refused request - read and write, whether or not the membership would have given the right - on `/api/:tenant/...`, `/api/tenants/:tenant/...`, `/api/v2/:tenant/...`, `/csv/:tenant/...` and `PUT /api/tenants` with the tenant in the body; the supervision history and the readiness check of the tenant included. Routes that never refuse (`public`) narrow instead: `GET /api/:tenant/bookings` lists the own bookings, `?public=true` answers the public's `404`. Across tenants the declined one is left out: the owned list of `GET /api/tenants` (it stays in `?publicTenants=true`), the instance dashboard, and what `GET /api/access/bookings` manages. The metadata of its media are refused, its files answer members as the public (`intern` `403`, `public` `404`). Not affected:

- the instance owner (every right stays),
- what any signed-in user has: the own booking, its receipt, refund preview and lock, an invitation - a tenant owner who booked in the own tenant keeps exactly that, at the reach `own`,
- public and token-authorized routes: booking status, payment callbacks, hooks, webhooks,
- an unknown tenant, which passes to the handler's `404`.

Staff of a declined tenant see its public projection no more either: the public delivery paths answer them the public's `404 tenant_not_found`. Staff of a `pending` tenant keep their reach there, so a tenant can be prepared before its approval.

## Environment variables

Configure JWT in your `.env` file:

- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `JWT_ALGORITHM`
- `JWT_EXPIRES_IN`
- `JWT_REFRESH_EXPIRES_IN`
- `JWT_ISSUER`
- `JWT_AUDIENCE`

See `.env-example` for reference values.

### Rate limits

Sliding windows counted in MongoDB (`rateLimitEvents`, rows expire after 7 days), so they hold across parallel requests and several server processes. Each limit has a count and a `_WINDOW_SECONDS` companion; a value that is not a positive integer falls back to the default. A limit hit answers `429 { code: "too_many_requests", params: { retryAfterSeconds } }` with a `Retry-After` header.

| Variable                                         | Default | Applies to                               |
| ------------------------------------------------ | ------- | ---------------------------------------- |
| `RATE_LIMIT_SIGNUP_PER_IP`                       | 10/h    | `POST /auth/signup`, per client IP       |
| `RATE_LIMIT_VERIFICATION_MAIL_PER_ACCOUNT_SHORT` | 1/min   | verification mails per account           |
| `RATE_LIMIT_VERIFICATION_MAIL_PER_ACCOUNT_LONG`  | 5/h     | verification mails per account           |
| `RATE_LIMIT_VERIFICATION_MAIL_PER_IP`            | 30/h    | `POST /auth/resend-verification`, per IP |
| `RATE_LIMIT_TENANT_SELF_CREATION_PER_USER`       | 3/24h   | tenant self-creation per user            |

The client IP is `req.ip`; the server trusts the proxy headers (`trust proxy`), so run it behind a reverse proxy that sets `X-Forwarded-For` from the connection, not from the client.
