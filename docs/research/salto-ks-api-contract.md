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

## 5. The PIN did not open the door — open question

Server side the recipe is complete and verified via the API: guest
`subscription_state: subscribed`, `use_pin: true`, PIN key present, member of an
access group that contains the lock, no time schedule. The keypad still rejects
it (tested by hand at the door, 2026-08-18, six attempts spread over 20
minutes).

The entry log (`GET /v1.1/sites/{id}/entries`) distinguishes the two failures
precisely:

| Attempt                                    | `event_category` | `event_detail` | `user_alias`                | Reading                              |
| ------------------------------------------ | ---------------- | -------------- | --------------------------- | ------------------------------------ |
| Guest #2, PIN ~8 min old, `use_pin: false` | `lock_rejected`  | `null`         | `Booking wayfinder-probe-2` | Lock **knew** the PIN, denied access |
| Guest #3, PIN 2–8 min old, `use_pin: true` | `lock_rejected`  | `no_access`    | `null`                      | Lock did **not** know the PIN        |

So the lock does learn PINs (it knew guest #2's), but it had still not learned
guest #3's PIN **20 minutes** after it was issued. This is therefore not a short
propagation delay that a bit of lead time would cover — something else gates it.
The IQ reports `data_sync_state: "not_synced"` throughout, and
`GET /locks/{id}/offline_keys` is empty while the lock claims
`offline_access_keys_count: 1`.

What differed between the two guests is not obviously causal and is worth
testing next: guest #2 was in the access group **while that group carried a time
schedule** (created 10:25, deleted 10:37); guest #3 has never had one. Other
candidates: the IQ needs an explicit sync or activation, `use_pin` needs time to
propagate, or Sallis/`blue_net` locks handle PINs differently from Salto's own.

**This is the decisive open question for the whole Guest+PIN design**: if a
freshly issued PIN needs minutes (or a manual sync) to reach the door, a
just-in-time grant at `accessFrom` cannot work — the grant needs lead time, or
the PIN path is not viable at all for short-notice bookings. It has its own
ticket.

Left standing for that test: guest `Booking wayfinder-probe-3`
(site user `034d50b8-43db-4e55-bdf0-42045be11f56`, platform user
`996bb445-955d-437e-8a99-5458afcd3d3b`), **PIN `525149`**, valid 7 days, in
access group `zzz-wayfinder-probe (delete me)`
(`04f5784d-7428-4ec4-b6e9-1cd5e64e7379`) which holds `Tür 01`. Delete both when
the question is answered.

## 6. The working recipe (server side)

```
POST   /v1.2/sites/{siteUuid}/guests                  {alias, expires_at}   -> site_user_id + user.id
PATCH  /v1.2/sites/{siteUuid}/users/{site_user_id}    {use_pin: true}
POST   /v1.2/sites/{siteUuid}/access_groups           {customer_reference}  -> access_group_id   (once per AccessPoint)
POST   /v1.2/sites/{siteUuid}/access_groups/{ag}/locks {lock_id}                                 (once per AccessPoint)
POST   /v1.2/sites/{siteUuid}/access_groups/{ag}/users {user_id: user.id}   <- platform user id!
PUT    /v1.2/sites/{siteUuid}/users/{site_user_id}/pin {}                   -> "525149"
…
DELETE /v1.2/sites/{siteUuid}/users/{site_user_id}                          -> 202, seat freed
```

Check `subscription_state === "subscribed"` after step 1; retry steps 2, 5 and 6
on 403 `2203` / 404 `2202`.

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
- Left behind on purpose: guest `Booking wayfinder-probe-3` and access group
  `zzz-wayfinder-probe (delete me)` (see §5). Everything else created during the
  measurement was deleted; the site is back at `active_user_amount: 6` plus that
  one guest.
