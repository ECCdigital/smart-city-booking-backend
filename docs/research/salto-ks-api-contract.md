# Salto KS Connect API — the contract as measured, not as guessed

Measured 2026-08-18 against the accept site `DE4520168385` (UUID
`00d20e57-9ac2-4b76-a65d-7911bfb00da2`, one IQ, one Sallis lock `Tür 01`,
`lock_type: escutcheon_pin`), API `clp-accept-user.my-clay.com`, identity
`identity-acc.eu.my-clay.com`, tenant `test`.

Probe scripts (gitignored, throwaway): `.scratch/diag/salto-contract-probe.js`
and `.scratch/diag/salto-explore*.js`.

## 1. What the API actually answers

| Endpoint                                                              | Request                                                             | Answer                                                                                                                                                                                                                                    | Deviation from spec / from our code                                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1.2/sites`                                                     | —                                                                   | 200, **bare array**. Site carries both `site_uid` (`DE4520168385`) and `id` (UUID) plus `customer_reference`                                                                                                                              | Site list is not `{items}` — unlike almost every other list                                                                                               |
| `GET /v1.2/sites/{uuid}`                                              | —                                                                   | 200 `active_user_amount: 5`, `subscribed_user_amount: 10`, `pin_enabled: true`, `active_iq_amount: 1`, `time_zone: Europe/Berlin`                                                                                                         | `{site_id}` **must be the UUID**; the site UID gives 400 `ErrorCode 1100`                                                                                 |
| `GET /v1.2/sites/{id}/locks`                                          | —                                                                   | 200 `{items, next_page_link, count}`. Lock: `lock_type: escutcheon_pin`, `online: true`, `locked_state: locked`, `battery_level: fresh`, `communication_type: blue_net`, `vendor.reference: sallis`, nested `iq` with `otp_enabled: true` | Locks carry **no** `siteId` — `listAccessPoints` maps `lock.siteId` and always gets `null`                                                                |
| `GET /v1.2/sites/{id}/subscription`                                   | —                                                                   | 200 `user_amount: 10`, `type: default`, `features[]` = `pods, events_streaming, smart_tag_assignment, time_and_attendance_report, nfc, events_storage, e_loxx, xs_com, activity_log`                                                      | **No `custom_pin`** feature → `PUT /pin/custom` is out for this site. No explicit remote-opening feature code                                             |
| `GET /v1.2/me`                                                        | —                                                                   | 200 — the _platform_ profile of the system user (name, mail, phone). No `remote_access` field here                                                                                                                                        | `remote_access` lives on the **site user**, not on `/me`                                                                                                  |
| `GET /v2/sites/{id}/me/permissions`, `GET /v2/sites/{id}/permissions` | —                                                                   | **403 Forbidden** (RFC7807 body, not `{ErrorCode, Message}`)                                                                                                                                                                              | The v2 permission API is not reachable with `user_api.full_access`. We cannot enumerate `REMOTE_LOCKING_*` — capabilities must be inferred from behaviour |
| `GET /v1.2/sites/{id}/users`                                          | —                                                                   | 200, **bare array**. Site user = `{id (site user id), user: {id (platform user id), …}, roles[], alias, subscription_state, use_pin, remote_access, expires_at}`                                                                          | Two ids per user — see §2                                                                                                                                 |
| `POST /v1.2/sites/{id}/guests`                                        | `{alias, expires_at}`                                               | **201**, role `site_guest`, `subscription_state: subscribed`, `use_pin: **false**`, no e-mail, no invite                                                                                                                                  | Works exactly as hoped — but `use_pin` defaults to `false`                                                                                                |
| `PUT /v1.2/sites/{id}/users/{site_user_id}/pin`                       | `{}` or `{expiry_date}`                                             | 200, body is a **bare JSON string** — a 6-digit PIN, e.g. `"525149"`                                                                                                                                                                      | Salto generates the PIN; we cannot supply one. Repeated calls **rotate** the same key object rather than adding keys                                      |
| `POST /v1.2/sites/{id}/access_groups`                                 | `{customer_reference}`                                              | 200 `{id, customer_reference}`                                                                                                                                                                                                            | —                                                                                                                                                         |
| `POST …/access_groups/{ag}/locks`                                     | `{lock_id}`                                                         | 200                                                                                                                                                                                                                                       | —                                                                                                                                                         |
| `POST …/access_groups/{ag}/users`                                     | `{user_id}`                                                         | 200 — **but only with the platform `user.id`**                                                                                                                                                                                            | Site-user id gives 404 `2202 User not found`. See §2                                                                                                      |
| `PATCH /v1.2/sites/{id}/users/{site_user_id}`                         | `{use_pin: true}`                                                   | 200                                                                                                                                                                                                                                       | Not in our code at all; required to let a guest use a PIN                                                                                                 |
| `GET …/users/{site_user_id}/keys`                                     | —                                                                   | 200 `{items:[{type: "pin", key_identifier: "pin", expiry_date, offline_access: false}]}`                                                                                                                                                  | —                                                                                                                                                         |
| `POST /v1.1/sites/{id}/access_groups/{ag}/time_schedules`             | `{monday…sunday: bool, start_time, end_time, start_date, end_date}` | 200; API returns `end_time` as `18:00:59`                                                                                                                                                                                                 | **Not** a `days: []` array — a boolean per weekday. `days` gives 400 `1101 At least one day should be selected`                                           |
| `PATCH /v1.2/sites/{id}/locks/{lock}/locking`                         | `{locked_state: "unlocked"}`                                        | **404 `{"ErrorCode":"2202","Message":"Otp is invalid"}`**                                                                                                                                                                                 | The OTP is **mandatory**, not optional. Remote open is impossible until the IQ is activated                                                               |
| `DELETE /v1.2/sites/{id}/users/{site_user_id}`                        | —                                                                   | **202**, seat free in the same second, user 404 within 10 s                                                                                                                                                                               | "Asynchronous" in name only                                                                                                                               |
| `PATCH /v1.2/sites/{id}/users/{id}/subscription`                      | `{subscription_state}`                                              | 400 `1101`                                                                                                                                                                                                                                | Field is **`state`** (`subscribed`\|`suspended`), not `subscription_state` (untested — no free seat)                                                      |
| `GET /v1.1/sites/{id}/entries`                                        | `$top`, `$orderby=utc_date_time desc`                               | 200                                                                                                                                                                                                                                       | **v1.1 only** — `/v1.2/…/entries` gives 405. `$orderby=date` gives 400 `1102`; the field is `utc_date_time`                                               |

## 2. Two ids per user — the trap

A site user has **two** ids and the API is inconsistent about which one it wants:

- `id` — the _site user_ id. Used by `/users/{site_user_id}`, `/users/{id}/pin`,
  `/users/{id}/keys`, `PATCH /users/{id}`, `DELETE /users/{id}`.
- `user.id` — the _platform user_ id. Used by
  `POST /access_groups/{ag}/users` and returned by
  `GET /access_groups/{ag}/users`.

Verified: adding a guest to an access group with its site-user id returns
404 `2202 User not found`; with `user.id` it returns 200. Both ids must be
stored per booking.

## 3. Seats — the research question, now answered

**Guests consume a subscription seat.** `active_user_amount` went 5 → 6 the
moment `POST /guests` returned.

- `expires_at` passing does **not** free the seat: 80 s after expiry the seat
  was still taken, `subscription_state` still `subscribed`, the PIN key still
  present.
- `DELETE /users/{site_user_id}` frees it **immediately** (202, count drops in
  the same second).
- **Seat exhaustion is silent and dangerous.** Filled to 10/10, a further
  `POST /guests` still returns **201** — but with
  `subscription_state: "suspended"`. `PUT /pin` then also returns 200 and hands
  out a PIN. Nothing anywhere reports an error; the booking would simply not
  open the door. `active_user_amount` just stops counting at
  `subscribed_user_amount`.

→ Any provisioning job **must** check `subscription_state === "subscribed"` on
the created guest and treat `suspended` as a failure. It cannot rely on an HTTP
error.

## 4. Guest provisioning is eventually consistent

Twice out of three guests, everything worked within ~2 s of creation. Once, for
~1 minute after `POST /guests`, `GET /users/{id}` returned `roles: []` and

- `PUT /users/{id}/pin` → 403 `2203 User does not have permission for this operation on this user`
- `POST /access_groups/{ag}/users` → 404 `2202 User not found`

The same calls succeeded a minute later unchanged. A `PATCH` response also once
showed `roles: []` while the following `GET` showed the role. → The job must
retry these two calls; the errors are not permanent.

## 5. An access group without a time schedule never reaches the lock

Measured at the door on 2026-08-18. This is the single most important
operational fact in this document: **a `site_guest` PIN only works if the access
group carries a time schedule.** Without one, the group is never rolled out to
the lock, and the keypad treats the PIN as unknown.

The A/B is clean — same guests, same group, same lock, same PINs, one variable:

| local time   | event                                         | user resolved to                     |
| ------------ | --------------------------------------------- | ------------------------------------ |
| 11:21–11:24  | `lock_rejected` `no_access`                   | `ee8f17b4-…` (sentinel, see below)   |
| **11:26:38** | **time schedule created on the access group** | —                                    |
| 11:30:12     | `lock_opened` `pin_code`                      | guest #4 `Booking wayfinder-probe-4` |
| 11:30:24     | `lock_opened` `pin_code`                      | guest #3 `Booking wayfinder-probe-3` |

Guest #3's PIN was 51 minutes old and had been rejected eight times; it opened
3m34s after the schedule appeared. Three distinct PINs issued at three different
times all failed before, all worked after.

`POST /v1.1/sites/{id}/access_groups/{ag}/time_schedules` with every weekday
`true`, `start_time: "00:00"`, `end_time: "23:59"` is the "always" schedule and
is enough. → **The provider must create a time schedule when it lazily creates
an AccessPoint's access group.** A group without one silently grants nothing.

### Propagation latency — the constraint on the just-in-time grant

Into an **already scheduled** group, a fresh guest is usable at the door within
**45 seconds**: guest #6 granted 11:34:19.9 (four API calls, 4.0 s server side),
door opened 11:35:04. That 45 s is an upper bound — the first keypad attempt was
not necessarily immediate.

So the just-in-time grant at `accessFrom` is viable, with about a minute of lead
time. What is slow is creating the _schedule_, not adding the _member_, and the
schedule is per AccessPoint and created once.

### Reading the entry log correctly

`GET /v1.1/sites/{id}/entries` carries 23 fields; reading only
`event_category`/`event_detail`/`user_alias` is what produced the earlier wrong
diagnosis. The fields that matter:

- `access_by` — `pin_code`, `inside_handle`, … Always says how the door was tried.
- `user_id` — the **platform** user id (not the site-user id), resolvable
  against `GET /sites/{id}/users` → `user.id`.
- `event_detail` — the precise reason: `no_access`, `suspended`, `offline`, or
  `null`.

**`user_id: ee8f17b4-701b-4aa6-9f1c-22f71cc61ca6` is a sentinel, not a user.**
It resolves to no site user and no platform user, and three different unknown
PINs all produced it. On this site it means "PIN not known to the lock". Do not
mistake it for a real identity.

Two rejection shapes seen, and they mean different things:

| `event_detail` | `user_alias` | meaning                                             |
| -------------- | ------------ | --------------------------------------------------- |
| `no_access`    | `null`       | PIN unknown to the lock (sentinel `user_id`)        |
| `null`         | set          | lock knows the user, denies — e.g. `use_pin: false` |
| `suspended`    | `null`       | user known, `subscription_state: suspended`         |

### What this rules out

All of these were suspected and are refuted by the same measurement — a
`site_user` PIN opened this lock repeatedly while every one of them held:

- **Propagation delay / lead time.** PINs reach this lock in under a minute.
- **`data_sync_state: "not_synced"` on the IQ.** It reads `not_synced` in the
  steady state, including during every successful open. There is also no way to
  act on it: `data_sync_state` appears only on `IqResponse`, and the only write
  path is `PUT /iqs/{id}/tree`, which needs `HARDWARE_MANAGE` **and** an OTP.
- **Sallis / `blue_net` handling PINs differently.** Same lock, same vendor.
- **The `site_guest` role lacking PIN rights.** Guests open fine once scheduled.
- **`offline_keys`.** Irrelevant to PINs — the spec's `excluded=true` filter
  says candidates "can't be pin keys", and the list holds only the two NFC tags.
  `offline_access_keys_count: 1` does not refer to a PIN.

## 6. The working recipe (server side)

Once per AccessPoint, when its access group is lazily created:

```
POST /v1.2/sites/{siteUuid}/access_groups             {customer_reference}  -> access_group_id
POST /v1.2/sites/{siteUuid}/access_groups/{ag}/locks  {lock_id}
POST /v1.1/sites/{siteUuid}/access_groups/{ag}/time_schedules
     {monday…sunday: true, start_time: "00:00", end_time: "23:59"}          <- REQUIRED, see §5
```

Per booking, at grant time:

```
POST   /v1.2/sites/{siteUuid}/guests                   {alias, expires_at}  -> site_user_id + user.id
PATCH  /v1.2/sites/{siteUuid}/users/{site_user_id}     {use_pin: true}
POST   /v1.2/sites/{siteUuid}/access_groups/{ag}/users {user_id: user.id}   <- platform user id!
PUT    /v1.2/sites/{siteUuid}/users/{site_user_id}/pin {}                   -> "618263"
…
DELETE /v1.2/sites/{siteUuid}/users/{site_user_id}                          -> 202, seat freed
```

Check `subscription_state === "subscribed"` on the created guest; retry the
`PATCH`, the group join and the `PUT /pin` on 403 `2203` / 404 `2202`. Allow
~1 minute between the grant and `accessFrom` (§5).

## 7. Where the existing code does not match the API

`src/commons/services/access/clients/salto-ks-api-client.js`

| Code                                                                                 | Reality                                                                                                                                                        |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createUser({firstName, lastName, email})` → `POST /users`                           | Body is snake_case; `email` triggers an invite mail. For bookings the endpoint is `POST /guests`                                                               |
| `assignAccess(userId, lockIds, validFrom, validTo, pin)` → `POST /users/{id}/access` | **Endpoint does not exist.** Access is access-group membership; validity is the guest's `expires_at` (plus optional time schedule); the PIN cannot be supplied |
| `revokeAccess(accessId)` → `DELETE /access/{accessId}`                               | **Does not exist**                                                                                                                                             |
| `subscribeNotifications` / `unsubscribeNotifications` → `/subscriptions`             | **Does not exist** — the API has no webhooks                                                                                                                   |
| `openLock(..., {otp})` sends `otp` only when given                                   | The OTP is mandatory: without it 404 `Otp is invalid`                                                                                                          |
| —                                                                                    | No methods for guests, PIN, `use_pin`, access groups, time schedules, entries                                                                                  |
| `_resolveSiteId`                                                                     | ✅ Correct and verified — resolves `site_uid`/`customer_reference` to the UUID via `GET /v1.2/sites`, so a tenant may keep storing the readable `DE4520168385` |
| `_extractList`                                                                       | ✅ Handles both bare arrays and `{items}`                                                                                                                      |
| `testConnection`                                                                     | ✅ Works against the accept site                                                                                                                               |

`src/commons/services/access/providers/salto-ks-access-provider.js`

| Code                                                                                | Reality                                                                                                                                                                          |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_generatePin()` and passing `pin` into `assignAccess`                              | Salto generates the PIN and returns it; we cannot choose it (`pin/custom` needs a `custom_pin` feature the site does not have)                                                   |
| `_buildUser()` sends booking name and e-mail                                        | Contradicts the "no personal data at Salto" decision and would send an invite. A guest needs only `alias`                                                                        |
| `revokeAuthorization` calls `revokeAccess` then `deleteUser`                        | Only `deleteUser` exists — and only it frees the seat                                                                                                                            |
| `registerWebhook` / `unregisterWebhook` / `parseWebhook` / `verifyWebhookSignature` | Dead code — no webhooks                                                                                                                                                          |
| `listAccessPoints` maps `lock.siteId`                                               | Locks carry no site id → always `null`                                                                                                                                           |
| `capabilities: ["remote", "authorization"]` for every lock                          | Remote needs an activated IQ + OTP; authorization needs a PIN-capable `lock_type` (`escutcheon_pin` / `wall_reader_pin`) and site `pin_enabled`. Both should be derived per lock |
| `getStatus` field mapping                                                           | ✅ `locked_state`, `online`, `battery_level`, alarms all match                                                                                                                   |

## 8. Side effects of this measurement on the accept site

- `PUT /users/{id}/pin` was also run against two pre-existing site users
  (Marvin's own site user → `900412`, one `site_user` → `867353`). Their
  previous PINs no longer apply. Accepted as harmless on the test site.
- Guests `Booking wayfinder-probe-2` … `-6` and the access group
  `zzz-wayfinder-probe (delete me)` (with its time schedule) were deleted after
  the door test on 2026-08-18. The site is back at `active_user_amount: 5` with
  `Alle Türen` as its only access group.
- The system user's IQ activation was created during this measurement and is
  now unusable: its PIN was changed and can no longer be read, so no valid OTP
  can be produced and the activation cannot be reset via the API (§9). It needs
  resetting through the Salto KS app or support before remote open can be
  retested.
- During the door test the site briefly sat at 10/10 seats. Nothing was created
  while it did, so no guest was silently suspended (§3).

## 9. Remote open needs an activated IQ — and the activation is a one-way door

Measured on 2026-08-18 against IQ `5dfdc54e-…` ("IQ 01", revision 2.0,
`otp_enabled: true`). At the time of this measurement no remote open had ever
succeeded. **Resolved 2026-08-25: the API path works — every failure below was
self-inflicted** (see the resolution at the end of this section). What follows
is the activation contract, which is solid, plus the wall it ran into and why
that wall was of our own making.

### The activation, step by step

| #   | Call                                                  | Answer                                                                                                                                                  |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `GET /v1.2/sites/{site}/iqs/{iq}/secret`              | **200 with the secret, no `otp` needed** — but only _before_ activation. Afterwards `403` `2203` "Cannot get first secret for an already activated Iq." |
| 2   | `GET /v1.2/sites/{site}/iqs/{iq}/pin?send_email=true` | `204`, PIN mailed to the calling user. The IQ then appears in `GET /v1.2/me/{site}/activated_iqs` with `activated: false`                               |
| 3   | `PUT /v1.2/sites/{site}/iqs/{iq}/pin` `{otp, delta}`  | `204` → `activated: true` with an `activation_date`. Until this happens, the door answers `pin_not_changed`                                             |

Step 1 settles a question the earlier research left open: there is no
chicken-and-egg. The first secret is handed out for free, so the Salto-app
detour that Zapfloor and Booking Experts document is **not** required. The
price is that it is a single-shot read — **capture the secret on that first
call or the IQ is unusable for remote open.**

`delta` is undocumented. It is a digit-wise mod-10 difference, applied as
**`new = old − delta`**: PIN `6596` with `delta 6995` became `0601`, not `2481`.

### The OTP formula, confirmed

`MD5(YYYYMMDDHHMMSS_UTC + secret + pin)`, first 5 hex characters, **whole-second
UTC, no rounding**. Confirmed because `PUT …/iqs/{iq}/pin` validates the OTP
before applying the change: with the wrong PIN it answers `otp_invalid`, with
the right one `204`, fifteen seconds apart. A `delta` of `"0000"` therefore
makes that endpoint a **side-effect-free OTP oracle** — useful, because the
alternative is testing against a physical door.

`otp_blocked` arrives after **exactly 8** failed attempts (`403`, `ErrorCode
3102`), and clears on its own. That is far more forgiving than Salto's support
pages suggest. Failed OTPs never reach the lock: not one attempt shows up in
`GET /v1.1/sites/{site}/entries`.

### Where it stops

`PATCH /v1.2/sites/{site}/locks/{lock}/locking` rejected every self-computed OTP
with `otp_invalid` — including the exact computation the cloud had accepted
seconds earlier on `PUT …/pin`. Ruled out: the changed PIN, the mailed PIN, the
opposite delta direction (also retried hours later, outside the propagation
window), and an `Europe/Berlin` timestamp instead of UTC.

Worse, a combination proven valid at 09:59:53 was rejected at 12:25 with the
activation untouched (`activated: true`, same `activation_date`). Whether the
PIN or the secret moved cannot be told from outside, because **neither can be
read again**:

- `GET …/iqs/{iq}/pin` → `403` `command_forbidden`
- `GET …/iqs/{iq}/secret` → `403` `2203`
- `DELETE …/iqs/{iq}/pin/{user_id}` → `400` `1100` **"The otp field is required."** (with the platform id and with the site-user id)

So the reset that would break the deadlock itself needs a valid OTP. **A lost
IQ-PIN cannot be recovered through the Connect API.** Recovery has to go through
the Salto KS app/web UI, a second admin who is already activated, or Salto
support.

**Consequence for the provider.** Do not advertise a `remote` capability on the
strength of `otp_enabled` alone (§7): remote needs an IQ the backend has
activated itself (resolution below; `docs/specs/salto-ks-remote-open.md`). And
the activation must persist PIN and secret atomically at the moment of
activation — there is no second chance at either.

### Second attempt, 2026-08-19: fresh user, remote right, Salto's own web app — still `otp_invalid`

The first attempt left two excuses open: the system user had no remote-locking
permission, and its activation had been touched twice. Both are gone now, and the
result is the same. Measured with `.scratch/diag/salto-remote-door-proof.js`
(log in `salto-remote-door-proof.log`):

| UTC      | Call                                                                                                          | Answer                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 06:58    | new system user (`remote_access: true`, custom role with `REMOTE_LOCKING_*`, never activated): `GET …/secret` | 200, secret `6F6A…` (≠ the old user's `9B81…` → the secret is per user, and already creates the `activated: false` entry in `activated_iqs`) |
| 07:02    | `GET …/pin?send_email=true`                                                                                   | 204, PIN `5109` by mail                                                                                                                      |
| 07:05:03 | `PUT …/pin {otp(S, 5109), delta 9751}`                                                                        | **204**, `activated: true`                                                                                                                   |
| 07:05:04 | `PATCH …/locks/{lock}/locking {unlocked, otp(S, 6458)}`                                                       | 400 `3102 otp_invalid`                                                                                                                       |
| 07:13    | same code typed into **app-accept.saltoks.com** (same user)                                                   | `otp_invalid`                                                                                                                                |
| 07:14    | locking with the mailed PIN `5109`                                                                            | `otp_invalid`; next call `otp_blocked`                                                                                                       |
| 07:20    | `GET …/pin?send_email=true` after activation                                                                  | 403 `command_forbidden`                                                                                                                      |
| 07:37    | `GET …/secret?otp=otp(S, 6458)`                                                                               | `otp_invalid` (while `PUT …/pin` still said `otp_blocked` → the block is kept per command)                                                   |
| 08:09    | DevTools: what the web app sends                                                                              | `PATCH /v1.1/sites/{site}/locks/{lock}/locking`, body `{"locked_state":"unlocked","otp":"…"}` — byte for byte our request (we use v1.2)      |
| 09:59    | locking with PIN `4850` (= old **+** delta, in case the IQ applies the delta the other way round)             | `otp_invalid`                                                                                                                                |
| 10:00    | oracle `PUT …/pin delta 0000` with `6458`, then `5109`                                                        | `otp_invalid` twice, then `otp_blocked` after the **third** failure                                                                          |

Ruled out today: the missing permission, the request shape (Salto's own client
sends the same bytes), a second "real" secret behind `?otp=`, the direction of
`delta`, a stale code (the web-app code was 67 s old, well inside Salto's 3-minute
window). An IQ clock drift is unlikely — the entry log's IQ timestamps match our
clock to the second. What remains is a mismatch between the cloud's and the IQ's
view of this user's activation (`data_sync_state: not_synced`, no warning in the
web app) — or an OTP derivation that differs from the documented one. That cannot
be told apart from outside: the Salto KS mobile app, which would show the code
the IQ expects, exists only for production.

Two more facts for the operator: the combination the cloud accepted at
activation is rejected a few hours later (both days), so PIN + secret are not a
durable credential in this environment; and `otp_blocked` arrived after 3, not
8, consecutive failures in the second round — budget one attempt per action.

Also observed: from ~08:10 to ~10:00 UTC both accept identity servers
(`identity-acc.eu.my-clay.com`, `clp-accept-identityserver.my-clay.com`)
answered 404 on every path while production identity was fine — accept is not
a production-grade environment, plan test sessions accordingly.

**Consequence (as of 2026-08-19).** Remote open looked dead on accept; the
suspected ways forward were Salto support or a production test with the real
app. Both turned out to be unnecessary — see the resolution below.

### Resolution, 2026-08-25 — the door opens; both riddles explained

Proven at the door (fresh, never-activated system user with a reachable
mailbox; run ~07:25 UTC; remote opening confirmed in Salto's own web app):

| #   | Call                                                            | Answer                            |
| --- | --------------------------------------------------------------- | --------------------------------- |
| 1   | `GET …/iqs/{iq}/secret` (no OTP, user never activated)          | 200, first secret `S`             |
| 2   | `GET …/iqs/{iq}/pin?send_email=true`                            | 204, initial PIN `P` mailed       |
| 3   | `PUT …/iqs/{iq}/pin {otp: otp(S, P), delta: "0000"}`            | 204, `activated: true` — API-side |
| 4   | `PATCH /v1.2/…/locks/{lock}/locking {unlocked, otp: otp(S, P)}` | **200 — the door opens remotely** |

The self-computed OTP formula (§ above) is correct and sufficient. The two
riddles this section left open dissolve into two self-inflicted causes:

- **The secret is per user and the app rotates it.** Activating the user in
  the Salto mobile app performs its own handshake and replaces the secret; the
  app keeps the new one and no Connect endpoint ever returns it. A stored
  first secret then fails every locking call with `otp_invalid` — silently,
  permanently, with the activation looking untouched from outside. That is why
  a combination "proven valid at 09:59" was dead at 12:25: the app had been in
  play. The fix is a rule, not a call: **the system user is activated via the
  API only, never via the app** (`docs/adr/0002-salto-iq-activation-via-api-only.md`).
- **A real `delta` makes the PIN ambiguous.** The 08-19 run activated with
  `delta: 9751`; afterwards `PUT …/pin` (cloud-side validation) accepted OTPs
  that `PATCH …/locking` (IQ-side validation) rejected — the two sides
  disagreed about which PIN now applied. `delta: "0000"` keeps the PIN equal
  to the mailed one and removes the ambiguity; with it, the same `(S, P)`
  passes both endpoints.

Follow-ups: the first secret **survives** the API activation (step 3), so
`(S, P)` is a durable credential as long as the app stays away; and
`PUT …/pin` with `delta: "0000"` remains the side-effect-free OTP oracle. The
full integration path (data model, wizard, capability rule, error handling) is
specified in `docs/specs/salto-ks-remote-open.md`; the positive run is
documented as an addendum in `docs/research/salto-ks-remote-open-door-proof.md`.
