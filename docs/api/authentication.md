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
  "lastName": "Last Name"
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
