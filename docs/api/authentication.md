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

### GET /auth/verify/:hookId

Verify a user using the hook ID generated during signup.

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

Retrieve data of the currently authenticated user.

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
