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

Register a new user.

**Request body:**

```json
{
  "id": "someone@example.com",
  "password": "your-password",
  "firstName": "First Name",
  "lastName": "Last Name",
  "verifyUrl": "https://storefront.example.com/auth/verify",
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

- a local or card account: its e-mail verification (`isVerified`, set only by the released verification hook)
- an SSO account: the identity provider's confirmation of the e-mail, persisted on the user as `idpEmailVerifiedAt` (Date) and `idpEmailVerifiedProvider` (`keycloak`) when a `POST /auth/sso/signup` or `POST /auth/sso/signin` carries Keycloak's `email_verified: true` claim. The first proof stands. An SSO account whose provider has not confirmed the e-mail has no proof — the `isVerified: true` every SSO signup sets is an activation flag, not a proof.

Both fields are part of the user object the auth routes answer (`user.idpEmailVerifiedAt`, `user.idpEmailVerifiedProvider`, next to `user.authType`).

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
