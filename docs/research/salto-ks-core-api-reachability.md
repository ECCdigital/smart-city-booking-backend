# Salto KS – Erreichbarkeit der Core API mit dem Accept-Client

**Messzeitpunkt:** 2026-08-19 12:55 UTC
**Umgebung:** Accept (`environment: accept`)
**Mandant:** `test` / `4d3f2474-a429-4320-9b61-c8de5d58fe84`
**Modus:** ausschließlich lesend (GET / Token-Requests), keine zustandsändernden Aufrufe.

## Verwendete Endpunkte und Credentials

- **Token-Endpoint:** `https://identity-acc.eu.my-clay.com/connect/token` (Password-Grant, Basic-Auth `clientId:clientSecret`)
- **Core API:** `https://clp-accept-hardware.my-clay.com` (Spec `v1.2`, 83 Pfade, `.scratch/salto-core.json`)
- **Connect/User API (bisher genutzt):** `apiBaseUrl = https://clp-accept-user.my-clay.com`
- **App-Daten aus MongoDB (`applications[]`, `id: salto-ks`, `type: access`):**
  - `clientId`: Klartext-String (UUID, 36 Zeichen) — **nicht** verschlüsselt gespeichert
  - `clientSecret`: verschlüsselt `{iv,data}` (entschlüsselt 36 Zeichen)
  - `username`: `marvin.anders@ecc-digital.de`
  - `password`: verschlüsselt (entschlüsselt 9 Zeichen)
  - `siteId`: `DE4520168385`
  - `environment`: `accept`

> Alle Secrets sind maskiert. Klartext-Token wurden nur lokal dekodiert, nicht gespeichert.

## openid-configuration

Beide Discovery-Dokumente sind ohne Token per GET erreichbar (HTTP 200).

**Accept (`identity-acc.eu.my-clay.com`):**
- `token_endpoint`: `https://identity-acc.eu.my-clay.com/connect/token`
- `grant_types_supported`: enthält `password`, `client_credentials`, `authorization_code`, `refresh_token`, … (Password-Grant vorhanden)
- kein `resource`-Feld / keine explizite Audience-Angabe in der Discovery
- `scopes_supported` (Auszug, Core-/Hardware-relevant):
  - `user_api.full_access`, `user_api.eloxx`
  - **`core_api.full`, `core_api.standard`** (sowie interne: `core_api.internal_icarus`, `core_api.internal_iqarus`, `core_api.internal_metadata`, `core_api.internal_nebula`, `core_api.vendor_discovery`)
  - **`hardware_api`**, `wallet_hardware_api`, `hardware.internal_support`
  - **kein** `core_api`, **kein** `core_api.full_access`, **kein** `hardware_api.full_access`, **kein** `clp_api`

**Prod (`identity.eu.my-clay.com`, nur Vergleich, kein Token-Request):**
- Nahezu identische Scope-Liste; ebenfalls `core_api.full`, `core_api.standard`, `hardware_api`; ebenfalls kein `core_api`/`clp_api`.

Wichtig: `scopes_supported` listet, was der **Identity-Server global kennt** — nicht, was **unser Client** anfordern darf.

## Ergebnistabelle

| Versuch | Scope | Token? (aud/scope) | Core-API-Aufruf | Status | Antwort |
|--------|-------|--------------------|-----------------|--------|---------|
| 1 | `user_api.full_access` | **Ja** — `aud=user_api`, `scope=user_api.full_access` | `GET /v1.2/iqs` | 401 | `WWW-Authenticate: Bearer error="invalid_token", error_description="The audience 'user_api' is invalid"` |
| 1b | `user_api.full_access` | Ja (s.o.) | `GET /v1.2/locks` | 401 | dito ("audience 'user_api' is invalid") |
| 1c | `user_api.full_access` | Ja (s.o.) | `GET /v1.2/collections` | 401 | dito |
| 1d | `user_api.full_access` | Ja (s.o.) | `GET /v1.2/accessors?$top=1` | 401 | dito |
| 2 | `hardware_api` | **Nein** | — | 400 | `error=invalid_scope` |
| 3 | `hardware_api.full_access` | Nein | — | 400 | `invalid_scope` |
| 4 | `core_api` | Nein | — | 400 | `invalid_scope` |
| 5 | `core_api.full_access` | Nein | — | 400 | `invalid_scope` |
| 6 | `core_api.full` | Nein | — | 400 | `invalid_scope` |
| 7 | `core_api.standard` | Nein | — | 400 | `invalid_scope` |
| 8 | `clp_api` | Nein | — | 400 | `invalid_scope` |
| 9 | `openid profile` | Nein | — | 400 | `invalid_scope` |
| 10 | `core_api.full core_api.standard` | Nein | — | 400 | `invalid_scope` |
| 11 | `user_api.full_access core_api.full` | Nein | — | 400 | `invalid_scope` |
| 12 | `user_api.full_access hardware_api` | Nein | — | 400 | `invalid_scope` |
| — | (ohne Token) | — | `GET /v1.2/iqs`, `/locks`, `/collections`, `/accessors` | 401 | `WWW-Authenticate: Bearer`, leerer Body |
| — | Swagger UI | — | `GET /swagger/index.html` | 200 | `text/html` (öffentlich erreichbar) |
| — | Swagger Spec | — | `GET /swagger/v1.2/swagger.json` | 200 | JSON |

## Interpretation

1. **Netzwerk/Transport zur Core API funktioniert.** DNS, TLS und HTTP zu `clp-accept-hardware.my-clay.com` sind in Ordnung: unauthentifizierte Aufrufe liefern sauber `401` mit `WWW-Authenticate: Bearer`, die Swagger-UI und die Spec sind öffentlich (200).

2. **Unser Client kann nur `aud=user_api` erzeugen.** Der Password-Grant liefert ausschließlich für `user_api.full_access` ein Token; die Audience ist `user_api`.

3. **Die Core API weist genau diese Audience ab.** Mit dem Baseline-Token antwortet jeder Core-Endpunkt mit `401` und `error_description="The audience 'user_api' is invalid"`. Die Core API erwartet also eine andere Audience (dem Scope-Namen nach voraussichtlich `core_api`/`hardware_api`) — bestätigbar war das nicht, weil wir kein solches Token bekommen.

4. **Kein Core-/Hardware-Scope ist für unseren Client freigeschaltet.** Obwohl der Identity-Server `core_api.full`, `core_api.standard` und `hardware_api` global kennt (`scopes_supported`), scheitert jede Anforderung am Token-Endpoint mit `invalid_scope`. Das ist eine **Client-seitige Beschränkung** (AllowedScopes des Clients), keine Tippfehler-/Unbekannt-Frage. Die im Ticket vermuteten Namen `core_api`, `core_api.full_access`, `hardware_api.full_access`, `clp_api` existieren serverseitig ohnehin nicht.

## Fazit

- **Erreichbar: nein (nicht nutzbar).** Der Host ist netzwerkseitig erreichbar, aber die Core API ist mit unserem Accept-Client **nicht** aufrufbar. Grund: Unser Client darf nur `user_api.full_access` (→ `aud=user_api`) beziehen, und die Core API lehnt `aud=user_api` explizit ab. Alle Core-/Hardware-Scopes scheitern schon beim Token-Bezug mit `invalid_scope`.
- **Womit es scheitert:**
  - Token-Endpoint: `HTTP 400 invalid_scope` für jeden Core-/Hardware-Scope (Client nicht berechtigt).
  - Core API mit vorhandenem Token: `HTTP 401 invalid_token — "The audience 'user_api' is invalid"`.
- **Was fehlt:** Salto muss unserem OAuth-Client zusätzliche AllowedScopes freischalten (voraussichtlich `core_api.full`/`core_api.standard` bzw. `hardware_api`), damit ein Token mit der von der Core API erwarteten Audience ausgestellt werden kann. Ohne diese Freischaltung ist der Core-Weg für uns geschlossen.

## Nutzen für Remote-Open (nur theoretisch, aktuell nicht erreichbar)

Die für Remote-Open interessanten Bausteine sind in der Core-Spec vorhanden, konnten aber **nicht** aufgerufen werden (kein gültiges Token):

- **PIN lesen:** `GET /v1.2/iqs/{id}/pins/{accessor_id}` existiert (nur `get`) — würde PIN-Auslesen ermöglichen.
- **`validate_access`:** Feld in `LockingRequest`; genutzt von `PATCH /v1.2/collections/{collection_id}/locks/{lock_id}/locking` (Remote-Locking/Unlocking).
- **`otp_enabled`:** in der IQ-/Response-Struktur vorhanden (mehrfach referenziert); über `GET /v1.2/iqs/{id}` lesbar.
- **Entity-Mapping Connect↔Core** (Core `collection`/`accessor` vs. Connect `site`/`site-user`, u. a. ob `GET /v1.2/collections` unsere Site-UUID `00d20e57-9ac2-4b76-a65d-7911bfb00da2` zeigt): **nicht prüfbar**, da alle Core-Aufrufe an `401` scheiterten.

> Hinweis gemäß Ticket: PIN-/Secret-/Locking-Endpunkte wurden bewusst **nicht** aufgerufen; sie wären bei passender Berechtigung nur "in Reichweite".

## Rohantworten (Secrets maskiert)

**Token-Endpoint, Baseline (`user_api.full_access`):** `HTTP 200`, Token dekodiert → `aud="user_api"`, `scope="user_api.full_access"` (Token nicht gespeichert).

**Token-Endpoint, alle Core-/Hardware-Scopes:**
```
HTTP 400
{"error":"invalid_scope"}
```

**Core API mit Baseline-Token (alle vier Endpunkte identisch):**
```
HTTP 401
WWW-Authenticate: Bearer error="invalid_token", error_description="The audience 'user_api' is invalid"
(Body leer)
```

**Core API ohne Token (alle vier Endpunkte):**
```
HTTP 401
WWW-Authenticate: Bearer
(Body leer)
```

**Core-Spec Security:** `components.securitySchemes.Bearer` = generisches `apiKey`/`Authorization`-Header-JWT; top-level `security: [{ "Bearer": [] }]`; **keine** Scopes je Pfad, **keine** OAuth-Flows/Audiences in der Spec hinterlegt.
