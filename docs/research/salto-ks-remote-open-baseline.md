# Salto KS Remote-Open — Ist-Zustand (Baseline) der Accept-Anlage

Gemessen am **2026-08-19 12:55:14 UTC** (zweiter, identischer Lauf; erster Lauf 2026-08-19 12:54:36 UTC mit identischen Werten).

| | |
|---|---|
| Umgebung | `accept` — API `https://clp-accept-user.my-clay.com`, Identity `https://identity-acc.eu.my-clay.com` |
| Site | `DE4520168385` (`site_uid`), UUID `00d20e57-9ac2-4b76-a65d-7911bfb00da2`, `customer_reference` "Biletado-ECC GmbH_Bad Belzig" |
| Tenant | `test` (`4d3f2474-a429-4320-9b61-c8de5d58fe84`), Application `salto-ks` (`siteId: DE4520168385`, `environment: accept`) |
| Methode | Nur `GET` gegen die Connect API + `POST /connect/token` (Password Grant). Kein `/locking`, kein `/pin`, kein `/secret`. Einmal-Skript unter `/tmp/`, nicht im Repo. |
| Spec-Referenz | `.scratch/salto.json` (Connect API v-latest) |

Maskierung: E-Mails (`m***@e***.de`), Vor-/Nachnamen (`M***`), Telefon (`***`). Tag-Nummern, MACs und alle UUIDs sind unmaskiert, Token/Secrets erscheinen nirgends.

## 1. Vorbedingungen für Remote-Open laut Spec — gemessen

`PATCH /v1.2/sites/{site_id}/locks/{id}/locking` verlangt laut Spec `REMOTE_LOCKING_ALL` (bzw. `REMOTE_LOCKING_ACCESSIBLE`), Body `LockingRequest { locked_state: RequestLockStates, otp?: string }`; `RequestLockStates = none|locked|office_mode|uncertain|unlocked`. Die Aktivierung am IQ (`/me/{site_id}/activated_iqs`, Schema `IqPinResponse`, "Status of Iq pin") ist die Quelle des OTP.

| Vorbedingung für Remote-Open (laut Spec) | Messwert | erfüllt / offen / unbekannt |
|---|---|---|
| Recht `REMOTE_LOCKING_ALL` / `REMOTE_LOCKING_ACCESSIBLE` | `GET /v2/sites/{id}/me/permissions` → **403**, `GET /v2/sites/{id}/me/roles` → **403**, `/v2/sites/{id}/roles` und `/v2/sites/{id}/permissions` → **403** (RFC-7807-Body). Rollen des System-Users laut `/v1.2/sites/{id}/me`: `test` ("Test", `is_hierarchical: true`, custom), `site_remote_office_mode_user`, `site_mobile_user` — **nicht** `site_admin`. Welche Permission-Codes die Rolle `test` trägt, ist über die API nicht auslesbar. | **unbekannt** (nur per Verhalten/Web-UI prüfbar) |
| `remote_access: true` am Site-User des Tokens | `/v1.2/sites/{id}/me` → `remote_access: true`, `blocked: false`, `subscription_state: subscribed`, `use_pin: true`, `expires_at: null` | **erfüllt** |
| Lock `online` | `/v1.2/sites/{id}/locks/4d77312f-…` → `online: true`, `iq_link_state: attached`, `locked_state: locked`, `lock_type: escutcheon_pin`, `communication_type: blue_net`, `battery_level: fresh`, `privacy_mode: false` | **erfüllt** |
| IQ `online` | `/v1.2/sites/{id}/iqs/5dfdc54e-…` → `online: true`, `state: active`, `signal_strength: 21`, `revision: 2.0`; am Lock `iq.is_online: true` | **erfüllt** |
| IQ `otp_enabled` | IQ → `otp_enabled: true`; am Lock `iq.otp_enabled: true`; in `activated_iqs` des System-Users `otp_enabled: true` | **erfüllt** |
| System-User am IQ aktiviert (OTP-Quelle) | `GET /v1.2/me/{site_id}/activated_iqs` → `[{ iq_id: 5dfdc54e-…, activated: true, activation_date: 2026-08-19T07:05:04Z }]`; `GET /v1.2/sites/{id}/users/be523f65-…/activated_iqs` → `[{ id: 5dfdc54e-…, customer_reference: "IQ 01", otp_enabled: true }]` | **erfüllt** (seit heute 07:05 UTC) |
| IQ `data_sync_state` | `not_synced` (Enum: `synced|pending|not_synced|failed`) | **offen** — IQ meldet online, aber Konfiguration nicht synchronisiert; Auswirkung auf Remote-Open unbekannt |
| IQ `restore_required` | `false`, `reset_date: null` | **erfüllt** |
| (Kontext) Site-Subscription | `subscription_valid: true`, `active_user_amount: 5`, `subscribed_user_amount: 10`, `active_iq_amount: 1`, `pin_enabled: true`, `installation_state: released`, `time_zone: Europe/Berlin`, `mkey_compatible: true`, `store_events_ttl: 90.00:00:00` | erfüllt |
| (Kontext) Token | `aud: user_api`, `scope: [user_api.full_access]`, `iss: https://identity-acc.eu.my-clay.com`, `exp-iat = 3600 s`, `amr: [password]`, `idp: local`, `typ: at+jwt`, `alg: RS256`; Zusatz-Claims `product_id`, `tenant_id`, `identity_id`, `skip_email`, `profile_id_f9616ba5-…` | erfüllt |

**Fazit:** Alle per API messbaren Hardware-/User-Vorbedingungen sind erfüllt, insbesondere ist der System-User seit 2026-08-19 07:05 UTC am IQ aktiviert (das war bei der Messung vom 2026-08-18 — `Otp is invalid` — noch nicht der Fall). Offen bleiben (a) das Recht `REMOTE_LOCKING_*` der Custom-Rolle `test` (v2-Permission-API antwortet 403) und (b) `data_sync_state: not_synced` am IQ.

## 2. Identifikatoren

| Objekt | Id |
|---|---|
| Site | `00d20e57-9ac2-4b76-a65d-7911bfb00da2` (`site_uid` `DE4520168385`) |
| IQ „IQ 01“ | `5dfdc54e-8335-11f0-a2ed-6045bd92d38f` (MAC `3B.9E.05`) |
| Lock „Tür 01“ | `4d77312f-4a87-41db-a97b-f9d948dcc908` (MAC `0163813000002C`, Vendor `sallis`) |
| System-User — Site-User-Id (`/sites/{id}/me`.id) | `be523f65-6e55-446c-91a5-337d69bb27a2` |
| System-User — Plattform-User-Id (`/me`.id, `user.id`) | `40c32eb0-62d4-4e16-b60e-5c359dca7f18` |
| System-User — Token `sub` | `1021b7ba-e938-4e03-b596-a9a03ad3068b` (Identity-Subject, ≠ Plattform-User-Id) |
| Token `client_id` | `f74143dc-2b18-4004-b656-40a5a556b4a1` |
| Rolle `test` (custom, hierarchisch) | `3bf83b0a-aeb0-4554-a766-94306b723741` |

## 3. Site-User-Übersicht (`GET /v1.2/sites/{id}/users?$top=100`, 6 Einträge)

| Site-User-Id | Plattform-User-Id | Rollen | `remote_access` | `subscription_state` | `blocked` | am IQ aktiviert (`…/users/{id}/activated_iqs`) |
|---|---|---|---|---|---|---|
| `04f6d454-f7a0-4c45-84e3-00d36622b267` | `cdaaf4aa-beae-483f-baa9-6a5f0fc9dc1f` | `site_user` | false | subscribed | false | nein |
| `1d8b32c6-a652-4079-bd71-f92360a82766` | `c6f84b4f-34b8-4d5e-abae-43f359d12c1c` | `site_pod_member`, `site_admin`, `site_mobile_user` | true | subscribed | false | ja (IQ 01) |
| `9d09f81e-5420-477e-af19-b55de8aaa2f2` | `13407b4c-644f-4e4c-bc62-cec05552fc6f` | `site_admin` | true | subscribed | false | nein |
| `bb82669f-7568-4729-bb95-07c1c22471a0` | `45c85495-a598-4d1e-ba97-20c657486346` | `site_user`, `site_mobile_user` | true | suspended | false | nein |
| `be523f65-6e55-446c-91a5-337d69bb27a2` (System-User) | `40c32eb0-62d4-4e16-b60e-5c359dca7f18` | `test`, `site_remote_office_mode_user`, `site_mobile_user` | true | subscribed | false | ja (IQ 01) |
| `efc8f3f4-e448-4b6d-b0f2-dafa5807b761` | `29b5f559-0785-437a-b061-bcd519e41fb0` | `site_admin` | true | subscribed | false | nein |

Form der Antwort: `{ items, next_page_link, count }` — sowohl mit `$top=100` als auch ohne Query (Kontrollaufruf, 200). Das widerspricht der Notiz „bare array“ für `/users` in `salto-ks-api-contract.md` (gemessen 2026-08-18).

Nur zwei Site-User sind am IQ aktiviert: der System-User (`be523f65-…`) und der `site_admin` `1d8b32c6-…`. Die beiden anderen `site_admin`s sind nicht aktiviert.

## 4. Letzte Ereignisse (`GET /v1.1/sites/{id}/entries?$top=20&$orderby=utc_date_time desc`)

| utc_date_time | event_category | event_detail | access_by | access_detail | user | exit_requested |
|---|---|---|---|---|---|---|
| 2026-08-19T12:50:38Z | easy_office_mode | end | tag | 02309289 | M*** A*** | false |
| 2026-08-19T12:50:32Z | easy_office_mode | start | tag | 02305075 | L*** S*** | false |
| 2026-08-19T12:50:28Z | lock_rejected |  | tag | 02307300 | — | false |
| 2026-08-19T12:50:24Z | lock_rejected |  | tag | 02309102 | — | false |
| 2026-08-19T12:50:20Z | lock_rejected |  | tag | 02306295 | — | false |
| 2026-08-19T12:50:16Z | easy_office_mode | end | tag | 02309289 | M*** A*** | false |
| 2026-08-19T12:50:06Z | easy_office_mode | start | tag | 02309289 | M*** A*** | false |
| 2026-08-19T12:49:08Z | easy_office_mode | end | tag | 02309289 | M*** A*** | false |
| 2026-08-19T12:49:02Z | easy_office_mode | start | tag | 02309289 | M*** A*** | false |
| 2026-08-19T10:14:04Z | easy_office_mode | end | tag | 02309289 | M*** A*** | false |
| 2026-08-19T10:14:00Z | easy_office_mode | start | tag | 02309289 | M*** A*** | false |
| 2026-08-19T09:46:42Z | lock_opened |  | inside_handle |  | — | true |
| 2026-08-19T09:46:40Z | lock_opened |  | inside_handle |  | — | true |
| 2026-08-19T09:46:38Z | lock_opened |  | inside_handle |  | — | true |
| 2026-08-19T09:46:30Z | lock_opened |  | inside_handle |  | — | true |
| 2026-08-19T09:46:20Z | lock_opened |  | inside_handle |  | — | true |
| 2026-08-19T09:44:14Z | lock_opened |  | inside_handle |  | — | true |
| 2026-08-19T09:44:12Z | lock_opened |  | inside_handle |  | — | true |
| 2026-08-19T09:43:14Z | lock_opened |  | inside_handle |  | — | true |
| 2026-08-19T09:01:50Z | easy_office_mode | end | tag | 02309289 | M*** A*** | false |

Beobachtete `access_by`-Werte: `tag`, `inside_handle`. Laut Spec (`EntryResponse.access_by`: "What was used for access (tag, remote, etc.)") wäre für einen späteren Remote-Open `access_by: remote` zu erwarten, voraussichtlich mit `event_category: lock_opened` und gesetzter `user_id` (Plattform-User-Id des System-Users). `lock_rejected`-Einträge tragen `user_id: null` und nur die Tag-Nummer in `access_detail`.

## 5. Alle Aufrufe (Methode, Pfad, Status)

| # | Methode | Pfad | Status |
|---|---|---|---|
| 0 | POST | `https://identity-acc.eu.my-clay.com/connect/token` (grant_type=password, scope=user_api.full_access, Basic clientId:clientSecret) | 200 |
| 1 | GET | `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2` | 200 |
| 2 | GET | `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/iqs` | 200 |
| 3 | GET | `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/iqs/5dfdc54e-8335-11f0-a2ed-6045bd92d38f` | 200 |
| 4 | GET | `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/locks` | 200 |
| 5 | GET | `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/locks/4d77312f-4a87-41db-a97b-f9d948dcc908` | 200 |
| 6 | GET | `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/me` | 200 |
| 7 | GET | `/v1.2/me` | 200 |
| 8 | GET | `/v2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/me/roles` | 403 |
| 9 | GET | `/v2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/me/permissions` | 403 |
| 10 | GET | `/v2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/roles` | 403 |
| 11 | GET | `/v2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/permissions` | 403 |
| 12 | GET | `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/roles` | 200 |
| 13 | GET | `/v1.2/me/00d20e57-9ac2-4b76-a65d-7911bfb00da2/activated_iqs` | 200 |
| 14 | GET | `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/users/be523f65-6e55-446c-91a5-337d69bb27a2/activated_iqs` | 200 |
| 15 | GET | `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/users?$top=100` | 200 |
| 16 | GET | `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/users/04f6d454-f7a0-4c45-84e3-00d36622b267/activated_iqs` | 200 |
| 17 | GET | `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/users/1d8b32c6-a652-4079-bd71-f92360a82766/activated_iqs` | 200 |
| 18 | GET | `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/users/9d09f81e-5420-477e-af19-b55de8aaa2f2/activated_iqs` | 200 |
| 19 | GET | `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/users/bb82669f-7568-4729-bb95-07c1c22471a0/activated_iqs` | 200 |
| 20 | GET | `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/users/efc8f3f4-e448-4b6d-b0f2-dafa5807b761/activated_iqs` | 200 |
| 21 | GET | `/v1.1/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/entries?$top=20&$orderby=utc_date_time desc` | 200 |

## 6. Rohantworten (maskiert)

### 6.0 Token (dekodierter JWT-Payload, ohne Token selbst)

```json
{
  "status": 200,
  "expires_in": 3600,
  "token_type": "Bearer",
  "scope_in_response": "user_api.full_access",
  "header": {
    "alg": "RS256",
    "typ": "at+jwt",
    "kid": "<present>"
  },
  "payload": {
    "iss": "https://identity-acc.eu.my-clay.com",
    "aud": "user_api",
    "scope": [
      "user_api.full_access"
    ],
    "client_id": "f74143dc-2b18-4004-b656-40a5a556b4a1",
    "sub": "1021b7ba-e938-4e03-b596-a9a03ad3068b",
    "amr": [
      "password"
    ],
    "idp": "local",
    "auth_time": 1787144114,
    "iat": 1787144114,
    "nbf": 1787144114,
    "exp": 1787147714,
    "lifetime_s": 3600,
    "other_claims": [
      "product_id",
      "skip_email",
      "tenant_id",
      "identity_id",
      "profile_id_f9616ba5-443a-11e6-a8b9-0050568da097"
    ]
  }
}
```

### 6.1 GET `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2` → 200

```json
{
  "active_user_amount": 5,
  "active_iq_amount": 1,
  "pin_enabled": true,
  "site_uid": "DE4520168385",
  "id": "00d20e57-9ac2-4b76-a65d-7911bfb00da2",
  "customer_reference": "Biletado-ECC GmbH_Bad Belzig",
  "subscribed_user_amount": 10,
  "subscription_valid": true,
  "country_code": "DE",
  "time_zone": "Europe/Berlin",
  "owner": {
    "email": "r***@s***.com",
    "image_url": null,
    "tag_number": "01507333",
    "is_managed_by_current_site": false,
    "has_profile": true,
    "id": "29b5f559-0785-437a-b061-bcd519e41fb0",
    "first_name": "R***",
    "last_name": "W***"
  },
  "installation_state": "released",
  "mkey_compatible": true,
  "store_events_ttl": "90.00:00:00"
}
```

### 6.2 GET `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/iqs` → 200

```json
{
  "items": [
    {
      "id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "customer_reference": "IQ 01",
      "time_zone": "Europe/Berlin",
      "mac": "3B.9E.05",
      "operator": "Telekom.de KPN Mode 7",
      "state": "active",
      "restore_required": false,
      "reset_date": null,
      "online": true,
      "led_enabled": true,
      "data_sync_state": "not_synced",
      "signal_strength": 21,
      "revision": "2.0",
      "otp_enabled": true
    }
  ],
  "next_page_link": null,
  "count": null
}
```

### 6.3 GET `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/iqs/5dfdc54e-8335-11f0-a2ed-6045bd92d38f` → 200

```json
{
  "id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
  "customer_reference": "IQ 01",
  "time_zone": "Europe/Berlin",
  "mac": "3B.9E.05",
  "operator": "Telekom.de KPN Mode 7",
  "state": "active",
  "restore_required": false,
  "reset_date": null,
  "online": true,
  "led_enabled": true,
  "data_sync_state": "not_synced",
  "signal_strength": 21,
  "revision": "2.0",
  "otp_enabled": true
}
```

### 6.4 GET `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/locks` → 200

```json
{
  "items": [
    {
      "offline_access_keys_limit": 360,
      "offline_access_keys_count": 1,
      "mac": "0163813000002C",
      "floor": null,
      "locked_state": "locked",
      "lock_type": "escutcheon_pin",
      "online": true,
      "iq_link_state": "attached",
      "tag_registration_state": "not_started",
      "battery_level": "fresh",
      "left_open_alarm": false,
      "intrusion_alarm": false,
      "easy_office_mode_schedule": {
        "eom_auto_start": true,
        "monday": true,
        "tuesday": true,
        "wednesday": true,
        "thursday": true,
        "friday": true,
        "saturday": true,
        "sunday": true,
        "start_time": "00:00:00",
        "end_time": "23:59:59",
        "start_date": null,
        "end_date": null
      },
      "iq": {
        "mac_address": "3B.9E.05",
        "is_online": true,
        "revision": "2.0",
        "otp_enabled": true,
        "id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
        "customer_reference": "IQ 01"
      },
      "repeater": null,
      "privacy_mode": false,
      "communication_type": "blue_net",
      "vendor": {
        "id": "d948da26-c404-11ee-8767-000d3a46a880",
        "reference": "sallis",
        "display_name": "SALTO Sallis"
      },
      "id": "4d77312f-4a87-41db-a97b-f9d948dcc908",
      "customer_reference": "Tür 01"
    }
  ],
  "next_page_link": null,
  "count": null
}
```

### 6.5 GET `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/locks/4d77312f-4a87-41db-a97b-f9d948dcc908` → 200

```json
{
  "offline_access_keys_limit": 360,
  "offline_access_keys_count": 1,
  "mac": "0163813000002C",
  "floor": null,
  "locked_state": "locked",
  "lock_type": "escutcheon_pin",
  "online": true,
  "iq_link_state": "attached",
  "tag_registration_state": "not_started",
  "battery_level": "fresh",
  "left_open_alarm": false,
  "intrusion_alarm": false,
  "easy_office_mode_schedule": {
    "eom_auto_start": true,
    "monday": true,
    "tuesday": true,
    "wednesday": true,
    "thursday": true,
    "friday": true,
    "saturday": true,
    "sunday": true,
    "start_time": "00:00:00",
    "end_time": "23:59:59",
    "start_date": null,
    "end_date": null
  },
  "iq": {
    "mac_address": "3B.9E.05",
    "is_online": true,
    "revision": "2.0",
    "otp_enabled": true,
    "id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
    "customer_reference": "IQ 01"
  },
  "repeater": null,
  "privacy_mode": false,
  "communication_type": "blue_net",
  "vendor": {
    "id": "d948da26-c404-11ee-8767-000d3a46a880",
    "reference": "sallis",
    "display_name": "SALTO Sallis"
  },
  "id": "4d77312f-4a87-41db-a97b-f9d948dcc908",
  "customer_reference": "Tür 01"
}
```

### 6.6 GET `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/me` → 200

```json
{
  "ownership_state": "site_user",
  "member_of_pods": [],
  "guest_of_pods": [],
  "id": "be523f65-6e55-446c-91a5-337d69bb27a2",
  "user": {
    "email": "m***@e***.de",
    "image_url": null,
    "tag_number": null,
    "is_managed_by_current_site": false,
    "has_profile": true,
    "id": "40c32eb0-62d4-4e16-b60e-5c359dca7f18",
    "first_name": "M***",
    "last_name": "A***"
  },
  "roles": [
    {
      "id": "3bf83b0a-aeb0-4554-a766-94306b723741",
      "customer_reference": "Test",
      "code": "test",
      "parent_id": null,
      "is_hierarchical": true
    },
    {
      "id": "58ebcde4-d01d-11eb-b9e0-000d3a46a880",
      "customer_reference": "Site Remote Office Mode User",
      "code": "site_remote_office_mode_user",
      "parent_id": null,
      "is_hierarchical": false
    },
    {
      "id": "9df437bb-80fb-11e8-a892-000d3a221c5b",
      "customer_reference": "Site Mobile User",
      "code": "site_mobile_user",
      "parent_id": null,
      "is_hierarchical": false
    }
  ],
  "alias": null,
  "toggle_easy_office_mode": false,
  "toggle_manual_office_mode": false,
  "remote_access": true,
  "blocked": false,
  "tag_owned_by_this_site": false,
  "subscription_state": "subscribed",
  "override_privacy_mode": false,
  "use_pin": true,
  "data_removal_expires_at": null,
  "expires_at": null
}
```

### 6.7 GET `/v1.2/me` → 200

```json
{
  "id": "40c32eb0-62d4-4e16-b60e-5c359dca7f18",
  "first_name": "M***",
  "last_name": "A***",
  "phone": "***",
  "email": "m***@e***.de",
  "language": "de-DE",
  "tag_number": null,
  "tag_rf_id_uid": null,
  "image_url": null
}
```

### 6.8 GET `/v2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/me/roles` → 403

```json
{
  "type": "https://httpstatuses.io/403",
  "title": "Forbidden",
  "status": 403,
  "traceId": "00-cea3d65c87df8ca9a62a34e8c0d672fd-9ff9cf7d6345cd71-00"
}
```

### 6.9 GET `/v2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/me/permissions` → 403

```json
{
  "type": "https://httpstatuses.io/403",
  "title": "Forbidden",
  "status": 403,
  "traceId": "00-63fa16d69261c0ee1e7c2fd9fdc6796c-f091819619e58d51-00"
}
```

### 6.10 GET `/v2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/roles` → 403

```json
{
  "type": "https://httpstatuses.io/403",
  "title": "Forbidden",
  "status": 403,
  "traceId": "00-c7fdb84ddad35c3e626298f2df811e9d-f8103d2806b454dd-00"
}
```

### 6.11 GET `/v2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/permissions` → 403

```json
{
  "type": "https://httpstatuses.io/403",
  "title": "Forbidden",
  "status": 403,
  "traceId": "00-5be8ec8e9961bbad25e8ec13b9688474-27c2d88119687209-00"
}
```

### 6.12 GET `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/roles` → 200

```json
{
  "items": [
    {
      "id": "8f6081a3-80fb-11e8-a892-000d3a221c5b",
      "customer_reference": "Site User",
      "code": "site_user",
      "parent_id": "76f7e578-80fb-11e8-a892-000d3a221c5b",
      "is_hierarchical": true
    }
  ],
  "next_page_link": null,
  "count": null
}
```

### 6.13 GET `/v1.2/me/00d20e57-9ac2-4b76-a65d-7911bfb00da2/activated_iqs` → 200

```json
{
  "items": [
    {
      "iq_id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "activation_date": "2026-08-19T07:05:04Z",
      "activated": true
    }
  ],
  "next_page_link": null,
  "count": null
}
```

### 6.14 GET `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/users/be523f65-6e55-446c-91a5-337d69bb27a2/activated_iqs` → 200

```json
{
  "items": [
    {
      "id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "customer_reference": "IQ 01",
      "otp_enabled": true
    }
  ],
  "next_page_link": null,
  "count": null
}
```

### 6.15 GET `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/users?$top=100` → 200

```json
{
  "items": [
    {
      "id": "04f6d454-f7a0-4c45-84e3-00d36622b267",
      "user": {
        "email": null,
        "image_url": null,
        "tag_number": null,
        "is_managed_by_current_site": true,
        "has_profile": false,
        "id": "cdaaf4aa-beae-483f-baa9-6a5f0fc9dc1f",
        "first_name": "B***",
        "last_name": "0***"
      },
      "roles": [
        {
          "id": "8f6081a3-80fb-11e8-a892-000d3a221c5b",
          "customer_reference": "Site User",
          "code": "site_user",
          "parent_id": "76f7e578-80fb-11e8-a892-000d3a221c5b",
          "is_hierarchical": true
        }
      ],
      "alias": "",
      "toggle_easy_office_mode": false,
      "toggle_manual_office_mode": false,
      "remote_access": false,
      "blocked": false,
      "tag_owned_by_this_site": false,
      "subscription_state": "subscribed",
      "override_privacy_mode": false,
      "use_pin": true,
      "data_removal_expires_at": null,
      "expires_at": null
    },
    {
      "id": "1d8b32c6-a652-4079-bd71-f92360a82766",
      "user": {
        "email": "m***@e***.de",
        "image_url": null,
        "tag_number": "02309289",
        "is_managed_by_current_site": false,
        "has_profile": true,
        "id": "c6f84b4f-34b8-4d5e-abae-43f359d12c1c",
        "first_name": "M***",
        "last_name": "A***"
      },
      "roles": [
        {
          "id": "1243f463-1033-11ea-ac2c-000d3a46a880",
          "customer_reference": "Site Pod Member",
          "code": "site_pod_member",
          "parent_id": null,
          "is_hierarchical": false
        },
        {
          "id": "7d53b0b3-3ef7-11e8-9f1c-0050568d6e36",
          "customer_reference": "Site Admin",
          "code": "site_admin",
          "parent_id": null,
          "is_hierarchical": true
        },
        {
          "id": "9df437bb-80fb-11e8-a892-000d3a221c5b",
          "customer_reference": "Site Mobile User",
          "code": "site_mobile_user",
          "parent_id": null,
          "is_hierarchical": false
        }
      ],
      "alias": "",
      "toggle_easy_office_mode": true,
      "toggle_manual_office_mode": true,
      "remote_access": true,
      "blocked": false,
      "tag_owned_by_this_site": true,
      "subscription_state": "subscribed",
      "override_privacy_mode": true,
      "use_pin": true,
      "data_removal_expires_at": null,
      "expires_at": null
    },
    {
      "id": "9d09f81e-5420-477e-af19-b55de8aaa2f2",
      "user": {
        "email": "l***@e***.de",
        "image_url": null,
        "tag_number": "02305075",
        "is_managed_by_current_site": false,
        "has_profile": true,
        "id": "13407b4c-644f-4e4c-bc62-cec05552fc6f",
        "first_name": "L***",
        "last_name": "S***"
      },
      "roles": [
        {
          "id": "7d53b0b3-3ef7-11e8-9f1c-0050568d6e36",
          "customer_reference": "Site Admin",
          "code": "site_admin",
          "parent_id": null,
          "is_hierarchical": true
        }
      ],
      "alias": "",
      "toggle_easy_office_mode": true,
      "toggle_manual_office_mode": true,
      "remote_access": true,
      "blocked": false,
      "tag_owned_by_this_site": true,
      "subscription_state": "subscribed",
      "override_privacy_mode": true,
      "use_pin": true,
      "data_removal_expires_at": null,
      "expires_at": null
    },
    {
      "id": "bb82669f-7568-4729-bb95-07c1c22471a0",
      "user": {
        "email": "m***@p***.com",
        "image_url": null,
        "tag_number": null,
        "is_managed_by_current_site": false,
        "has_profile": true,
        "id": "45c85495-a598-4d1e-ba97-20c657486346",
        "first_name": "M***",
        "last_name": "A***"
      },
      "roles": [
        {
          "id": "8f6081a3-80fb-11e8-a892-000d3a221c5b",
          "customer_reference": "Site User",
          "code": "site_user",
          "parent_id": "76f7e578-80fb-11e8-a892-000d3a221c5b",
          "is_hierarchical": true
        },
        {
          "id": "9df437bb-80fb-11e8-a892-000d3a221c5b",
          "customer_reference": "Site Mobile User",
          "code": "site_mobile_user",
          "parent_id": null,
          "is_hierarchical": false
        }
      ],
      "alias": null,
      "toggle_easy_office_mode": false,
      "toggle_manual_office_mode": false,
      "remote_access": true,
      "blocked": false,
      "tag_owned_by_this_site": false,
      "subscription_state": "suspended",
      "override_privacy_mode": false,
      "use_pin": true,
      "data_removal_expires_at": null,
      "expires_at": null
    },
    {
      "id": "be523f65-6e55-446c-91a5-337d69bb27a2",
      "user": {
        "email": "m***@e***.de",
        "image_url": null,
        "tag_number": null,
        "is_managed_by_current_site": false,
        "has_profile": true,
        "id": "40c32eb0-62d4-4e16-b60e-5c359dca7f18",
        "first_name": "M***",
        "last_name": "A***"
      },
      "roles": [
        {
          "id": "3bf83b0a-aeb0-4554-a766-94306b723741",
          "customer_reference": "Test",
          "code": "test",
          "parent_id": null,
          "is_hierarchical": true
        },
        {
          "id": "58ebcde4-d01d-11eb-b9e0-000d3a46a880",
          "customer_reference": "Site Remote Office Mode User",
          "code": "site_remote_office_mode_user",
          "parent_id": null,
          "is_hierarchical": false
        },
        {
          "id": "9df437bb-80fb-11e8-a892-000d3a221c5b",
          "customer_reference": "Site Mobile User",
          "code": "site_mobile_user",
          "parent_id": null,
          "is_hierarchical": false
        }
      ],
      "alias": null,
      "toggle_easy_office_mode": false,
      "toggle_manual_office_mode": false,
      "remote_access": true,
      "blocked": false,
      "tag_owned_by_this_site": false,
      "subscription_state": "subscribed",
      "override_privacy_mode": false,
      "use_pin": true,
      "data_removal_expires_at": null,
      "expires_at": null
    },
    {
      "id": "efc8f3f4-e448-4b6d-b0f2-dafa5807b761",
      "user": {
        "email": "r***@s***.com",
        "image_url": null,
        "tag_number": "01507333",
        "is_managed_by_current_site": false,
        "has_profile": true,
        "id": "29b5f559-0785-437a-b061-bcd519e41fb0",
        "first_name": "R***",
        "last_name": "W***"
      },
      "roles": [
        {
          "id": "7d53b0b3-3ef7-11e8-9f1c-0050568d6e36",
          "customer_reference": "Site Admin",
          "code": "site_admin",
          "parent_id": null,
          "is_hierarchical": true
        }
      ],
      "alias": null,
      "toggle_easy_office_mode": false,
      "toggle_manual_office_mode": false,
      "remote_access": true,
      "blocked": false,
      "tag_owned_by_this_site": false,
      "subscription_state": "subscribed",
      "override_privacy_mode": true,
      "use_pin": false,
      "data_removal_expires_at": null,
      "expires_at": null
    }
  ],
  "next_page_link": null,
  "count": null
}
```

### 6.16 GET `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/users/04f6d454-f7a0-4c45-84e3-00d36622b267/activated_iqs` → 200

```json
{
  "items": [],
  "next_page_link": null,
  "count": null
}
```

### 6.17 GET `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/users/1d8b32c6-a652-4079-bd71-f92360a82766/activated_iqs` → 200

```json
{
  "items": [
    {
      "id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "customer_reference": "IQ 01",
      "otp_enabled": true
    }
  ],
  "next_page_link": null,
  "count": null
}
```

### 6.18 GET `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/users/9d09f81e-5420-477e-af19-b55de8aaa2f2/activated_iqs` → 200

```json
{
  "items": [],
  "next_page_link": null,
  "count": null
}
```

### 6.19 GET `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/users/bb82669f-7568-4729-bb95-07c1c22471a0/activated_iqs` → 200

```json
{
  "items": [],
  "next_page_link": null,
  "count": null
}
```

### 6.20 GET `/v1.2/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/users/efc8f3f4-e448-4b6d-b0f2-dafa5807b761/activated_iqs` → 200

```json
{
  "items": [],
  "next_page_link": null,
  "count": null
}
```

### 6.21 GET `/v1.1/sites/00d20e57-9ac2-4b76-a65d-7911bfb00da2/entries?$top=20&$orderby=utc_date_time desc` → 200

```json
{
  "items": [
    {
      "id": "5fb49f42-5eb1-4e32-b841-a7954d6be11e",
      "event_category": "easy_office_mode",
      "event_detail": "end",
      "utc_date_time": "2026-08-19T12:50:38Z",
      "local_date_time": "2026-08-19T14:50:38",
      "lock_id": "4d77312f-4a87-41db-a97b-f9d948dcc908",
      "lock_mac_address": "0163813000002C",
      "lock_customer_reference": "Tür 01",
      "user_id": "c6f84b4f-34b8-4d5e-abae-43f359d12c1c",
      "user_first_name": "M***",
      "user_last_name": "A***",
      "user_image_url": null,
      "user_alias": "",
      "iq_id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "iq_customer_reference": "IQ 01",
      "iq_mac_address": "3B.9E.05",
      "iq_revision": "2.0",
      "exit_requested": false,
      "access_by": "tag",
      "access_detail": "02309289",
      "ttl_in_seconds": 7776000,
      "expiration_date_time": "2026-11-17T12:50:39.401Z"
    },
    {
      "id": "aa5320e6-8167-4880-8793-50ff3ecdc24e",
      "event_category": "easy_office_mode",
      "event_detail": "start",
      "utc_date_time": "2026-08-19T12:50:32Z",
      "local_date_time": "2026-08-19T14:50:32",
      "lock_id": "4d77312f-4a87-41db-a97b-f9d948dcc908",
      "lock_mac_address": "0163813000002C",
      "lock_customer_reference": "Tür 01",
      "user_id": "13407b4c-644f-4e4c-bc62-cec05552fc6f",
      "user_first_name": "L***",
      "user_last_name": "S***",
      "user_image_url": null,
      "user_alias": "",
      "iq_id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "iq_customer_reference": "IQ 01",
      "iq_mac_address": "3B.9E.05",
      "iq_revision": "2.0",
      "exit_requested": false,
      "access_by": "tag",
      "access_detail": "02305075",
      "ttl_in_seconds": 7776000,
      "expiration_date_time": "2026-11-17T12:50:34.274Z"
    },
    {
      "id": "25ea37f4-d6e0-42c0-9ea8-afee14450273",
      "event_category": "lock_rejected",
      "event_detail": null,
      "utc_date_time": "2026-08-19T12:50:28Z",
      "local_date_time": "2026-08-19T14:50:28",
      "lock_id": "4d77312f-4a87-41db-a97b-f9d948dcc908",
      "lock_mac_address": "0163813000002C",
      "lock_customer_reference": "Tür 01",
      "user_id": null,
      "user_first_name": null,
      "user_last_name": null,
      "user_image_url": null,
      "user_alias": null,
      "iq_id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "iq_customer_reference": "IQ 01",
      "iq_mac_address": "3B.9E.05",
      "iq_revision": "2.0",
      "exit_requested": false,
      "access_by": "tag",
      "access_detail": "02307300",
      "ttl_in_seconds": 7776000,
      "expiration_date_time": "2026-11-17T12:50:30.197Z"
    },
    {
      "id": "127582b6-11f6-4f4d-9042-03b77652d75c",
      "event_category": "lock_rejected",
      "event_detail": null,
      "utc_date_time": "2026-08-19T12:50:24Z",
      "local_date_time": "2026-08-19T14:50:24",
      "lock_id": "4d77312f-4a87-41db-a97b-f9d948dcc908",
      "lock_mac_address": "0163813000002C",
      "lock_customer_reference": "Tür 01",
      "user_id": null,
      "user_first_name": null,
      "user_last_name": null,
      "user_image_url": null,
      "user_alias": null,
      "iq_id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "iq_customer_reference": "IQ 01",
      "iq_mac_address": "3B.9E.05",
      "iq_revision": "2.0",
      "exit_requested": false,
      "access_by": "tag",
      "access_detail": "02309102",
      "ttl_in_seconds": 7776000,
      "expiration_date_time": "2026-11-17T12:50:26.744Z"
    },
    {
      "id": "a3dd4793-63ec-4472-9f90-6983b40b653f",
      "event_category": "lock_rejected",
      "event_detail": null,
      "utc_date_time": "2026-08-19T12:50:20Z",
      "local_date_time": "2026-08-19T14:50:20",
      "lock_id": "4d77312f-4a87-41db-a97b-f9d948dcc908",
      "lock_mac_address": "0163813000002C",
      "lock_customer_reference": "Tür 01",
      "user_id": null,
      "user_first_name": null,
      "user_last_name": null,
      "user_image_url": null,
      "user_alias": null,
      "iq_id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "iq_customer_reference": "IQ 01",
      "iq_mac_address": "3B.9E.05",
      "iq_revision": "2.0",
      "exit_requested": false,
      "access_by": "tag",
      "access_detail": "02306295",
      "ttl_in_seconds": 7776000,
      "expiration_date_time": "2026-11-17T12:50:22.131Z"
    },
    {
      "id": "dc92b755-68ad-4823-91d7-c0bbd426c671",
      "event_category": "easy_office_mode",
      "event_detail": "end",
      "utc_date_time": "2026-08-19T12:50:16Z",
      "local_date_time": "2026-08-19T14:50:16",
      "lock_id": "4d77312f-4a87-41db-a97b-f9d948dcc908",
      "lock_mac_address": "0163813000002C",
      "lock_customer_reference": "Tür 01",
      "user_id": "c6f84b4f-34b8-4d5e-abae-43f359d12c1c",
      "user_first_name": "M***",
      "user_last_name": "A***",
      "user_image_url": null,
      "user_alias": "",
      "iq_id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "iq_customer_reference": "IQ 01",
      "iq_mac_address": "3B.9E.05",
      "iq_revision": "2.0",
      "exit_requested": false,
      "access_by": "tag",
      "access_detail": "02309289",
      "ttl_in_seconds": 7776000,
      "expiration_date_time": "2026-11-17T12:50:17.42Z"
    },
    {
      "id": "eac6a549-267d-4ddd-8ac3-d78f8073f499",
      "event_category": "easy_office_mode",
      "event_detail": "start",
      "utc_date_time": "2026-08-19T12:50:06Z",
      "local_date_time": "2026-08-19T14:50:06",
      "lock_id": "4d77312f-4a87-41db-a97b-f9d948dcc908",
      "lock_mac_address": "0163813000002C",
      "lock_customer_reference": "Tür 01",
      "user_id": "c6f84b4f-34b8-4d5e-abae-43f359d12c1c",
      "user_first_name": "M***",
      "user_last_name": "A***",
      "user_image_url": null,
      "user_alias": "",
      "iq_id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "iq_customer_reference": "IQ 01",
      "iq_mac_address": "3B.9E.05",
      "iq_revision": "2.0",
      "exit_requested": false,
      "access_by": "tag",
      "access_detail": "02309289",
      "ttl_in_seconds": 7776000,
      "expiration_date_time": "2026-11-17T12:50:09.166Z"
    },
    {
      "id": "748c98fa-03df-4078-a915-cb01f487440f",
      "event_category": "easy_office_mode",
      "event_detail": "end",
      "utc_date_time": "2026-08-19T12:49:08Z",
      "local_date_time": "2026-08-19T14:49:08",
      "lock_id": "4d77312f-4a87-41db-a97b-f9d948dcc908",
      "lock_mac_address": "0163813000002C",
      "lock_customer_reference": "Tür 01",
      "user_id": "c6f84b4f-34b8-4d5e-abae-43f359d12c1c",
      "user_first_name": "M***",
      "user_last_name": "A***",
      "user_image_url": null,
      "user_alias": "",
      "iq_id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "iq_customer_reference": "IQ 01",
      "iq_mac_address": "3B.9E.05",
      "iq_revision": "2.0",
      "exit_requested": false,
      "access_by": "tag",
      "access_detail": "02309289",
      "ttl_in_seconds": 7776000,
      "expiration_date_time": "2026-11-17T12:49:09.826Z"
    },
    {
      "id": "5a26bb2e-5964-498d-80fe-9a73cf2252eb",
      "event_category": "easy_office_mode",
      "event_detail": "start",
      "utc_date_time": "2026-08-19T12:49:02Z",
      "local_date_time": "2026-08-19T14:49:02",
      "lock_id": "4d77312f-4a87-41db-a97b-f9d948dcc908",
      "lock_mac_address": "0163813000002C",
      "lock_customer_reference": "Tür 01",
      "user_id": "c6f84b4f-34b8-4d5e-abae-43f359d12c1c",
      "user_first_name": "M***",
      "user_last_name": "A***",
      "user_image_url": null,
      "user_alias": "",
      "iq_id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "iq_customer_reference": "IQ 01",
      "iq_mac_address": "3B.9E.05",
      "iq_revision": "2.0",
      "exit_requested": false,
      "access_by": "tag",
      "access_detail": "02309289",
      "ttl_in_seconds": 7776000,
      "expiration_date_time": "2026-11-17T12:49:04.994Z"
    },
    {
      "id": "3087563c-c468-483a-9e78-0f4f129da0d7",
      "event_category": "easy_office_mode",
      "event_detail": "end",
      "utc_date_time": "2026-08-19T10:14:04Z",
      "local_date_time": "2026-08-19T12:14:04",
      "lock_id": "4d77312f-4a87-41db-a97b-f9d948dcc908",
      "lock_mac_address": "0163813000002C",
      "lock_customer_reference": "Tür 01",
      "user_id": "c6f84b4f-34b8-4d5e-abae-43f359d12c1c",
      "user_first_name": "M***",
      "user_last_name": "A***",
      "user_image_url": null,
      "user_alias": "",
      "iq_id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "iq_customer_reference": "IQ 01",
      "iq_mac_address": "3B.9E.05",
      "iq_revision": "2.0",
      "exit_requested": false,
      "access_by": "tag",
      "access_detail": "02309289",
      "ttl_in_seconds": 7776000,
      "expiration_date_time": "2026-11-17T10:14:05.821Z"
    },
    {
      "id": "e3819ff9-0510-4d85-86cf-a91bd429f778",
      "event_category": "easy_office_mode",
      "event_detail": "start",
      "utc_date_time": "2026-08-19T10:14:00Z",
      "local_date_time": "2026-08-19T12:14:00",
      "lock_id": "4d77312f-4a87-41db-a97b-f9d948dcc908",
      "lock_mac_address": "0163813000002C",
      "lock_customer_reference": "Tür 01",
      "user_id": "c6f84b4f-34b8-4d5e-abae-43f359d12c1c",
      "user_first_name": "M***",
      "user_last_name": "A***",
      "user_image_url": null,
      "user_alias": "",
      "iq_id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "iq_customer_reference": "IQ 01",
      "iq_mac_address": "3B.9E.05",
      "iq_revision": "2.0",
      "exit_requested": false,
      "access_by": "tag",
      "access_detail": "02309289",
      "ttl_in_seconds": 7776000,
      "expiration_date_time": "2026-11-17T10:14:00.982Z"
    },
    {
      "id": "60503091-b6cd-45e8-965e-4e9c129bebc1",
      "event_category": "lock_opened",
      "event_detail": null,
      "utc_date_time": "2026-08-19T09:46:42Z",
      "local_date_time": "2026-08-19T11:46:42",
      "lock_id": "4d77312f-4a87-41db-a97b-f9d948dcc908",
      "lock_mac_address": "0163813000002C",
      "lock_customer_reference": "Tür 01",
      "user_id": null,
      "user_first_name": null,
      "user_last_name": null,
      "user_image_url": null,
      "user_alias": null,
      "iq_id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "iq_customer_reference": "IQ 01",
      "iq_mac_address": "3B.9E.05",
      "iq_revision": "2.0",
      "exit_requested": true,
      "access_by": "inside_handle",
      "access_detail": "",
      "ttl_in_seconds": 7776000,
      "expiration_date_time": "2026-11-17T09:47:01.219Z"
    },
    {
      "id": "c7d23685-13a6-40d2-a777-91dd1f2c5274",
      "event_category": "lock_opened",
      "event_detail": null,
      "utc_date_time": "2026-08-19T09:46:40Z",
      "local_date_time": "2026-08-19T11:46:40",
      "lock_id": "4d77312f-4a87-41db-a97b-f9d948dcc908",
      "lock_mac_address": "0163813000002C",
      "lock_customer_reference": "Tür 01",
      "user_id": null,
      "user_first_name": null,
      "user_last_name": null,
      "user_image_url": null,
      "user_alias": null,
      "iq_id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "iq_customer_reference": "IQ 01",
      "iq_mac_address": "3B.9E.05",
      "iq_revision": "2.0",
      "exit_requested": true,
      "access_by": "inside_handle",
      "access_detail": "",
      "ttl_in_seconds": 7776000,
      "expiration_date_time": "2026-11-17T09:46:40.977Z"
    },
    {
      "id": "fef12ddb-8fb2-4127-936a-564b55211db4",
      "event_category": "lock_opened",
      "event_detail": null,
      "utc_date_time": "2026-08-19T09:46:38Z",
      "local_date_time": "2026-08-19T11:46:38",
      "lock_id": "4d77312f-4a87-41db-a97b-f9d948dcc908",
      "lock_mac_address": "0163813000002C",
      "lock_customer_reference": "Tür 01",
      "user_id": null,
      "user_first_name": null,
      "user_last_name": null,
      "user_image_url": null,
      "user_alias": null,
      "iq_id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "iq_customer_reference": "IQ 01",
      "iq_mac_address": "3B.9E.05",
      "iq_revision": "2.0",
      "exit_requested": true,
      "access_by": "inside_handle",
      "access_detail": "",
      "ttl_in_seconds": 7776000,
      "expiration_date_time": "2026-11-17T09:47:01.211Z"
    },
    {
      "id": "a7732515-702f-4e65-a366-3603b1c77dc6",
      "event_category": "lock_opened",
      "event_detail": null,
      "utc_date_time": "2026-08-19T09:46:30Z",
      "local_date_time": "2026-08-19T11:46:30",
      "lock_id": "4d77312f-4a87-41db-a97b-f9d948dcc908",
      "lock_mac_address": "0163813000002C",
      "lock_customer_reference": "Tür 01",
      "user_id": null,
      "user_first_name": null,
      "user_last_name": null,
      "user_image_url": null,
      "user_alias": null,
      "iq_id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "iq_customer_reference": "IQ 01",
      "iq_mac_address": "3B.9E.05",
      "iq_revision": "2.0",
      "exit_requested": true,
      "access_by": "inside_handle",
      "access_detail": "",
      "ttl_in_seconds": 7776000,
      "expiration_date_time": "2026-11-17T09:46:38.831Z"
    },
    {
      "id": "d464fbfc-eecc-43f2-96d5-90b390146acb",
      "event_category": "lock_opened",
      "event_detail": null,
      "utc_date_time": "2026-08-19T09:46:20Z",
      "local_date_time": "2026-08-19T11:46:20",
      "lock_id": "4d77312f-4a87-41db-a97b-f9d948dcc908",
      "lock_mac_address": "0163813000002C",
      "lock_customer_reference": "Tür 01",
      "user_id": null,
      "user_first_name": null,
      "user_last_name": null,
      "user_image_url": null,
      "user_alias": null,
      "iq_id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "iq_customer_reference": "IQ 01",
      "iq_mac_address": "3B.9E.05",
      "iq_revision": "2.0",
      "exit_requested": true,
      "access_by": "inside_handle",
      "access_detail": "",
      "ttl_in_seconds": 7776000,
      "expiration_date_time": "2026-11-17T09:47:01.354Z"
    },
    {
      "id": "c8229801-6874-48e1-9475-b889acf2de6f",
      "event_category": "lock_opened",
      "event_detail": null,
      "utc_date_time": "2026-08-19T09:44:14Z",
      "local_date_time": "2026-08-19T11:44:14",
      "lock_id": "4d77312f-4a87-41db-a97b-f9d948dcc908",
      "lock_mac_address": "0163813000002C",
      "lock_customer_reference": "Tür 01",
      "user_id": null,
      "user_first_name": null,
      "user_last_name": null,
      "user_image_url": null,
      "user_alias": null,
      "iq_id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "iq_customer_reference": "IQ 01",
      "iq_mac_address": "3B.9E.05",
      "iq_revision": "2.0",
      "exit_requested": true,
      "access_by": "inside_handle",
      "access_detail": "",
      "ttl_in_seconds": 7776000,
      "expiration_date_time": "2026-11-17T09:44:16.518Z"
    },
    {
      "id": "05ea2265-1c2f-4c9a-80ea-d7528bf936f3",
      "event_category": "lock_opened",
      "event_detail": null,
      "utc_date_time": "2026-08-19T09:44:12Z",
      "local_date_time": "2026-08-19T11:44:12",
      "lock_id": "4d77312f-4a87-41db-a97b-f9d948dcc908",
      "lock_mac_address": "0163813000002C",
      "lock_customer_reference": "Tür 01",
      "user_id": null,
      "user_first_name": null,
      "user_last_name": null,
      "user_image_url": null,
      "user_alias": null,
      "iq_id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "iq_customer_reference": "IQ 01",
      "iq_mac_address": "3B.9E.05",
      "iq_revision": "2.0",
      "exit_requested": true,
      "access_by": "inside_handle",
      "access_detail": "",
      "ttl_in_seconds": 7776000,
      "expiration_date_time": "2026-11-17T09:44:16.465Z"
    },
    {
      "id": "e7adae68-d3fb-4aaa-bc62-1b06dc3f5b4c",
      "event_category": "lock_opened",
      "event_detail": null,
      "utc_date_time": "2026-08-19T09:43:14Z",
      "local_date_time": "2026-08-19T11:43:14",
      "lock_id": "4d77312f-4a87-41db-a97b-f9d948dcc908",
      "lock_mac_address": "0163813000002C",
      "lock_customer_reference": "Tür 01",
      "user_id": null,
      "user_first_name": null,
      "user_last_name": null,
      "user_image_url": null,
      "user_alias": null,
      "iq_id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "iq_customer_reference": "IQ 01",
      "iq_mac_address": "3B.9E.05",
      "iq_revision": "2.0",
      "exit_requested": true,
      "access_by": "inside_handle",
      "access_detail": "",
      "ttl_in_seconds": 7776000,
      "expiration_date_time": "2026-11-17T09:44:32.882Z"
    },
    {
      "id": "078e5319-e6ef-4c88-b43c-4f9020ab6926",
      "event_category": "easy_office_mode",
      "event_detail": "end",
      "utc_date_time": "2026-08-19T09:01:50Z",
      "local_date_time": "2026-08-19T11:01:50",
      "lock_id": "4d77312f-4a87-41db-a97b-f9d948dcc908",
      "lock_mac_address": "0163813000002C",
      "lock_customer_reference": "Tür 01",
      "user_id": "c6f84b4f-34b8-4d5e-abae-43f359d12c1c",
      "user_first_name": "M***",
      "user_last_name": "A***",
      "user_image_url": null,
      "user_alias": "",
      "iq_id": "5dfdc54e-8335-11f0-a2ed-6045bd92d38f",
      "iq_customer_reference": "IQ 01",
      "iq_mac_address": "3B.9E.05",
      "iq_revision": "2.0",
      "exit_requested": false,
      "access_by": "tag",
      "access_detail": "02309289",
      "ttl_in_seconds": 7776000,
      "expiration_date_time": "2026-11-17T09:01:50.726Z"
    }
  ],
  "continuation_token": "[{\"token\":\"+RID:~+l4rAMrWm-7Qmy4AAAAAAA==#RT:1#TRC:20#RTD:aJDThDmVW80suVVL/6XbBTMxMzcuMTkuMjpVMTo7MTI7NjFbAA==#ISV:2#IEO:65567#QCF:8#FPC:AgGuuq4UAHEZAMASQP3/AgAxAIABEQAAyQuBrx4Aj7UEwDw8AAK+AQBwQQCABiIAOfyAABSAQQDAACuAsAQA1IUxgbYgAHECOAAegAXAFwAIIQsIAAAYAIWAUgBAAwAgwgEAuC8AuQYAsQ8AB++gujwAD5IDwEQGACds4E2AC4AGgBEAJwAhAAyASoARAAAJTIEPgAHA7AuBBgYAIQAAAyQAAPwB/AMABgChAAx/\",\"range\":{\"min\":\"\",\"max\":\"FF\"}}]"
}
```
