# Access-Points – Frontend-Implementierungs-Guide

Dieser Guide beschreibt, wie das Frontend die Access-Point-Funktionen
(Türen / Schließanlagen) auf drei Ebenen umsetzt:

1. **Tenant-Ebene** – Provider-Apps konfigurieren (Nuki, Salto KS)
2. **Bookable-Ebene** – einem Bookable Türen zuweisen (`accessPointDetails`)
3. **Booking-Ebene** – Türen einer Buchung anzeigen, öffnen/schließen, Status

Backend-Hintergrund: [ACCESS_POINTS_IMPLEMENTATION_PLAN.md](./ACCESS_POINTS_IMPLEMENTATION_PLAN.md),
Status: [ACCESS_POINTS_TRACKING.md](./ACCESS_POINTS_TRACKING.md).

---

## 0. Grundbegriffe

| Begriff           | Bedeutung                                                                             |
| ----------------- | ------------------------------------------------------------------------------------- |
| **Provider**      | Schließsystem-Anbieter: `nuki`, `salto-ks` (und `ifbs` für Locker)                    |
| **Access-Point**  | Eine Tür/ein Schloss. Typ `door` (Türen) oder `locker`.                               |
| **Mode**          | Betriebsart einer Tür: `remote`, `authorization`, `both`                              |
| **Authorization** | Zeitbasierte Zutrittsberechtigung + PIN, beim Provider angelegt                       |
| **Provisioning**  | Erzeugen der Authorization/PIN bei gültiger Buchung (passiert automatisch im Backend) |

**Modi erklärt:**

- `remote` – Tür wird per Backend-Befehl ferngeöffnet/-geschlossen (Open/Close-Buttons).
- `authorization` – Buchung bekommt eine zeitlich begrenzte Berechtigung + PIN (Keypad). Kein Remote-Open.
- `both` – beides verfügbar.

**Wichtige Sicherheitsregel:** PINs werden **niemals** über die API ausgeliefert
(weder in der Buchung noch in der Access-Point-Liste). Sie gehen ausschließlich
per Mail an den Buchenden.

**Response-Envelope** (Access- und Access-App-Endpunkte nutzen `ApiResponse`):

```json
{
  "success": true,
  "data": {
    /* ... */
  }
}
```

Fehler:

```json
{ "success": false, "error": "Could not ..." }
```

> Hinweis: Tenant- und Bookable-Endpunkte (`/tenants`, `/bookables`) geben das
> Objekt direkt zurück (ohne `success`/`data`-Hülle). Die Access-spezifischen
> Endpunkte (`/access`, `/access-apps`) nutzen die Hülle oben.

Alle Routen sind tenant-bezogen unter `/api/:tenant/...` und benötigen einen
eingeloggten User (Bearer/Session), sofern nicht anders angegeben.

---

## 1. Tenant-Ebene: Provider-Apps konfigurieren

Die Provider-Apps liegen im Tenant unter `tenant.applications` (Array). Eine
Access-App ist ein Eintrag mit `type: "access"`.

### 1.1 Tenant laden / speichern

- **Laden:** `GET /api/tenants/:id` → liefert das vollständige Tenant-Objekt
  inkl. `applications`. Geheimnisse (`apiToken`, `clientSecret`) werden für den
  Owner **entschlüsselt** zurückgegeben.
- **Speichern:** `PUT /api/tenants` mit dem kompletten Tenant-Objekt im Body
  (Feld `applications` muss mitgeschickt werden).

> **Wichtig beim Speichern:**
>
> - Immer das **gesamte** `applications`-Array zurückschicken (nicht nur die
>   geänderte App), sonst werden andere Apps entfernt.
> - Felder, die das Backend setzt (z.B. `webhookSubscriptionId`,
>   `webhookRegisteredAt`), unverändert mit-zurückschicken (Round-Trip).
> - Geheimnisse: Beim erneuten Speichern wird ein als **String** übergebenes
>   Secret neu verschlüsselt. Wenn der User das Secret **nicht** ändert, das
>   bereits geladene (entschlüsselte) Secret unverändert mitsenden.

### 1.2 App-Schema: Nuki

```jsonc
{
  "type": "access",
  "id": "nuki",
  "title": "Nuki Türen", // frei wählbar (Anzeigename)
  "active": true, // App aktiv?
  "apiToken": "<API-TOKEN>", // Nuki Web API Token (wird verschlüsselt)
  "apiBaseUrl": "https://api.nuki.io", // optional, Default gesetzt
}
```

### 1.3 App-Schema: Salto KS

```jsonc
{
  "type": "access",
  "id": "salto-ks",
  "title": "Salto KS",
  "active": true,
  "clientId": "<CLIENT-ID>", // Klartext
  "clientSecret": "<CLIENT-SECRET>", // wird verschlüsselt gespeichert
  "username": "<KS-USER-EMAIL>", // E-Mail des KS-System-Users (Password-Grant)
  "password": "<KS-USER-PASSWORT>", // wird verschlüsselt gespeichert
  "siteId": "<SITE-UUID>", // Salto Site UUID; Referenzwerte werden backendseitig aufgelöst
  "apiBaseUrl": "https://clp-accept-user.saltoks.com", // optional, Default gesetzt

  // Vom Backend verwaltet (read-only fürs UI, aber mit-zurückschicken):
  // "webhookCallbackUrl": "...",
  // "webhookSubscriptionId": "...",
  // "webhookRegisteredAt": 1718200000000,
  // "webhookRegistrationError": null
}
```

**UI-Formular-Empfehlung:**

| Feld                               | Nuki | Salto KS |
| ---------------------------------- | ---- | -------- |
| Anzeigename (`title`)              | ✓    | ✓        |
| Aktiv (`active`) Toggle            | ✓    | ✓        |
| `apiToken` (Passwortfeld)          | ✓    | –        |
| `clientId`                         | –    | ✓        |
| `clientSecret` (Passwortfeld)      | –    | ✓        |
| `username` (E-Mail KS-System-User) | –    | ✓        |
| `password` (Passwortfeld)          | –    | ✓        |
| `siteId` (Salto Site UUID)         | –    | ✓        |
| `apiBaseUrl` (advanced/optional)   | ✓    | ✓        |

Für `clientSecret`/`apiToken`/`password`: Wenn bereits gesetzt, im UI maskiert
anzeigen (z.B. `••••••`) und nur bei tatsächlicher Eingabe überschreiben.

> Salto KS nutzt den OAuth **Password-Grant** (Backend-Server-Integration).
> Daher sind zusätzlich `username` (E-Mail eines KS-System-Users mit Rolle
> `site_admin`) und `password` nötig. Details:
> [SALTO_KS_PASSWORD_GRANT_FRONTEND.md](./SALTO_KS_PASSWORD_GRANT_FRONTEND.md).

### 1.4 Verbindung testen

Vor dem Speichern (oder als „Test"-Button) die Credentials prüfen:

`POST /api/:tenant/access-apps/:provider/test`

Body = die einzugebenden Felder (Klartext), z.B. Salto KS:

```json
{
  "clientId": "...",
  "clientSecret": "...",
  "username": "service-user@example.com",
  "password": "...",
  "siteId": "f9616ba5-443a-11e6-a8b9-0050568da097",
  "apiBaseUrl": "..."
}
```

> Salto erwartet in API-Pfaden eine Site-UUID. Referenzwerte wie
> `DE4520168385` können vom Backend gegen `/v1.2/sites` aufgelöst werden, aber
> die echte `id` aus der Sites-Liste ist für das UI die robusteste Speicherung.

Nuki:

```json
{ "apiToken": "...", "apiBaseUrl": "..." }
```

Antwort:

```json
{ "success": true, "message": "Connection successful" }
```

oder

```json
{ "success": false, "message": "Invalid credentials" }
```

Erforderliche Felder: Nuki → `apiToken`; Salto KS → `clientId`, `clientSecret`,
`username`, `password`. Fehlen sie, kommt
`{ success: false, message: "Missing required fields: ..." }`.

Berechtigung: `MANAGE_TENANTS` (Update).

### 1.5 Aktive Provider auflisten

Für UI-Dropdowns (welche Provider sind beim Tenant aktiv?):

`GET /api/:tenant/access-apps/providers`

```json
{
  "success": true,
  "data": [
    {
      "id": "salto-ks",
      "title": "Salto KS",
      "capabilities": ["getLocks", "openLock", ...],
      "providerCapabilities": ["open", "getStatus", ...]
    },
    {
      "id": "nuki",
      "title": "Nuki Türen",
      "capabilities": ["getSmartlocks", ...],
      "providerCapabilities": ["open", "getLocation", ...]
    }
  ]
}
```

- `capabilities`: was der API-Client des Providers kann (Low-Level).
- `providerCapabilities`: was der Provider selbst anbietet — inklusive
  **optionaler** Fähigkeiten. Danach richtet sich, ob eine Aktion überhaupt
  angeboten wird; z.B. `getLocation` für den Standort-Prefill (siehe 2.3).

Berechtigung: `MANAGE_BOOKABLES` (Read).

### 1.6 Webhooks (Events vom Provider)

- **Salto KS:** Webhook-Registrierung passiert **automatisch** beim Speichern des
  Tenants, sobald die `salto-ks`-App `active: true` ist (und beim Deaktivieren
  wieder entfernt). Das UI muss dafür nichts tun. Den Status kann man an den
  Feldern `webhookRegisteredAt` (Zeitstempel) bzw. `webhookRegistrationError`
  (Fehlertext) ablesen und z.B. als Badge anzeigen.
- **Manuell neu registrieren** (z.B. nach Fehler):
  - `POST /api/:tenant/access-apps/:provider/webhook/register` mit Body
    `{ "callbackUrl": "https://<backend>/api/webhooks/access/:provider/:tenant" }`
  - `POST /api/:tenant/access-apps/:provider/webhook/unregister` mit Body
    `{ "notificationId": "<subscriptionId>" }`
  - Antwort: `{ "success": true, "data": { ... } }`
  - Berechtigung: `MANAGE_TENANTS`.

> Der `callbackUrl` wird serverseitig aus `ACCESS_WEBHOOK_BASE_URL` bzw.
> `BACKEND_URL` gebildet; ein manueller Aufruf ist nur als Fallback nötig.

---

## 2. Bookable-Ebene: Türen zuweisen

Türen werden am Bookable im Feld `accessPointDetails` gespeichert.

### 2.1 Struktur `accessPointDetails`

```jsonc
{
  "active": true, // Access-Points für dieses Bookable aktiv?
  "accessBuffer": { "before": 15, "after": 10 }, // Puffer in MINUTEN
  "accessPointIds": ["ap-uuid-1", "ap-uuid-2"], // Referenzen in /accesspoints
}
```

- **`accessPointIds`**: Referenzen auf AccessPoints des Mandanten. Die Tür selbst
  (Provider, `externalId`, Label, Modus, Konfiguration) wird unter
  `/api/:tenant/accesspoints` verwaltet, nicht am Bookable.
- Eine unbekannte ID beantwortet `PUT /api/:tenant/bookables` mit HTTP 400 und
  `details[].code = "unknown_access_point"`.
- Mehrere Bookables dürfen dieselbe ID referenzieren — der Haupteingang gehört
  typischerweise zu mehreren Räumen.
- **`accessBuffer`** (Minuten): Vor-/Nachlaufzeit, in der die Buchung die Tür
  bereits/noch bedienen darf. Gilt für alle AccessPoints des Bookables; sonst 0.

### 2.2 Verfügbare Türen vom Provider laden

Um dem Admin eine Auswahlliste der echten Schlösser anzubieten:

`GET /api/:tenant/access-apps/:provider/access-points`

```json
{
  "success": true,
  "data": [
    {
      "id": "lock-123",
      "type": "door",
      "provider": "salto-ks",
      "externalId": "lock-123",
      "locationId": "site-1",
      "label": "Haupteingang",
      "capabilities": ["remote", "authorization"],
      "supportedModes": ["remote", "authorization", "both"],
      "metadata": {
        /* Roh-Objekt vom Provider */
      }
    }
  ]
}
```

**UI-Flow zum Hinzufügen einer Tür:**

1. Provider wählen (aus aktiven Providern, siehe 1.5).
2. `GET .../:provider/access-points` aufrufen → Liste anzeigen.
3. Tür auswählen → per `PUT /api/:tenant/accesspoints` einen AccessPoint anlegen
   (`provider`, `externalId`, `label`, `providerLocationId` vorbefüllen; die `id`
   kommt vom Server). Nur für Tenant-Owner.
4. `mode` wählen — **nur Modi aus `supportedModes`** anbieten.
5. Die zurückgegebene `id` in `accessPointDetails.accessPointIds` des Bookables
   aufnehmen.

Berechtigung: `MANAGE_BOOKABLES` (Read).

### 2.3 Standort eines AccessPoints vom Provider vorbefüllen

`GET /api/:tenant/accesspoints/:id/location-prefill` (Tenant-Owner)

Fragt den Provider, wo das Schloss steht — damit der Admin Koordinaten nicht
abtippen muss, die der Provider ohnehin kennt.

```json
{ "coordinates": { "type": "Point", "points": [7.1, 51.2] } }
```

- NUKI liefert Koordinaten, aber **keine** Adresse (die API kennt keine).
- Salto KS deklariert die optionale Capability nicht (keine Geodaten in der
  Connect-API) und liefert `null` — ebenso Provider ohne die Capability und ein
  Schloss ohne hinterlegte Position. Dann bleibt nur manuelle Eingabe.

Der Endpoint **schreibt nichts**. Die Übernahme ist ein normales
`PUT /api/:tenant/accesspoints` mit dem Wert im Feld `location`; die Entity
bleibt die einzige Quelle für den Standort (kein Sync, kein Hintergrundabgleich).

**UI-Flow:** Die Prefill-Aktion nur anbieten, wenn `providerCapabilities` des
Providers `getLocation` enthält (siehe 1.5). Ergebnis ins Formular schreiben und
erst beim Speichern mit-PUTen; `null` als „Provider kennt keinen Standort"
melden. Adresse ggf. manuell ergänzen.

### 2.4 Bookable speichern

`PUT /api/:tenant/bookables` mit dem kompletten Bookable-Objekt inkl.
`accessPointDetails`. Das gesamte Bookable round-trippen (wie bei `lockerDetails`).

### 2.5 Vererbung (Hinweis)

Access-Points werden standardmäßig an Eltern-/Kind-Bookables vererbt
(steuerbar serverseitig via `ACCESS_POINTS_INHERIT_PARENTS` /
`ACCESS_POINTS_INHERIT_CHILDREN`). Eine Buchung „erbt" also auch Türen von
verwandten Bookables. Fürs UI relevant: An der Buchung können **mehr** Türen
auftauchen als direkt am gebuchten Bookable konfiguriert.

---

## 3. Booking-Ebene: Laufzeit (öffnen/schließen/Status)

### 3.1 Türen einer Buchung auflisten

`GET /api/:tenant/access?bookingId=<id>`

```json
{
  "success": true,
  "data": [
    {
      "id": "ap-uuid-1",
      "type": "door",
      "provider": "salto-ks",
      "externalId": "lock-123",
      "label": "Haupteingang",
      "mode": "authorization",
      "bookableId": "...",
      "bookableTitle": "...",
      "authorizationId": "access-99",
      "isProvisioned": true,
      "provisionedAt": 1718200000000,
      "lastEvent": {
        "type": "open",
        "timestamp": 1718200500000,
        "source": "webhook",
        "success": true,
        "errorCode": null
      },
      "accessBuffer": { "beforeMs": 900000, "afterMs": 600000 },
      "accessFrom": 1718199100000,
      "accessTo": 1718205600000
    }
    // Locker-Einträge haben type:"locker" und zusätzliche Felder
  ]
}
```

- **`pin` ist NICHT enthalten** (bewusst). Nur Provisioning-Status & letztes Event.
- `accessFrom`/`accessTo` = gepufferter Zeitraum (ms), in dem bedient werden darf.
- Berechtigung: Owner **oder** `MANAGE_BOOKINGS`. Buchung muss gültig sein
  (committed, ggf. bezahlt, nicht abgelehnt) – aber **nicht** zwingend im
  Zeitfenster (Liste ist immer sichtbar).

### 3.2 Tür öffnen / schließen / entriegeln

| Aktion             | Endpoint                                                         | Mode          |
| ------------------ | ---------------------------------------------------------------- | ------------- |
| Öffnen             | `POST /api/:tenant/access/:accessPointId/open?bookingId=<id>`    | remote/both   |
| Entriegeln (Latch) | `POST /api/:tenant/access/:accessPointId/unlatch?bookingId=<id>` | remote (Nuki) |
| Schließen          | `POST /api/:tenant/access/:accessPointId/close?bookingId=<id>`   | remote/both   |

Antwort:

```json
{ "success": true, "data": { "success": true, "state": "open", "providerResponse": { ... } } }
```

- `accessPointId` = die `id` des Punktes (nicht die `externalId`).
- `bookingId` als **Query-Param**.
- **Salto KS** unterstützt kein remote `close` (Schlösser verriegeln selbst) –
  Close-Button für Salto-Türen ausblenden bzw. nur bei Nuki anzeigen. Orientiere
  dich am `mode` und ggf. an `provider`.
- **Berechtigung & Zeitfenster:** Owner oder `MANAGE_BOOKINGS`, und die Buchung
  muss **im (gepufferten) Zeitfenster** liegen. Open/Close-Buttons also nur
  innerhalb `accessFrom`..`accessTo` aktiv schalten.
- **Abgelehntes Öffnen** antwortet mit `200` und
  `{ "success": false, "data": { "blockingReasons": ["payment_required", ...] } }`
  – die Gründe sind nach Priorität sortiert und eignen sich direkt für die
  Fehlermeldung. `403` bleibt dem Fall vorbehalten, dass Buchung oder
  Access-Point nicht existieren. `close`/`unlatch` antworten unverändert mit
  `403`, wenn nicht geöffnet werden darf.

### 3.3 Status / Rückmeldung

- **Live-Status:** `GET /api/:tenant/access/:accessPointId/status?bookingId=<id>`

```json
{
  "success": true,
  "data": {
    "open": true,
    "locked": false,
    "doorOpen": null,
    "statusSource": "provider_status",
    "...": "providerspezifische Felder"
  }
}
```

- **Open-Status nach dem Öffnen (Polling):**
  `GET /api/:tenant/access/:accessPointId/open-status?bookingId=<id>&openProcessId=<optional>`

```json
{
  "success": true,
  "data": {
    "open": true,
    "confirmed": true,
    "confirmedAt": 1718200500000,
    "statusSource": "last_event"
  }
}
```

Hinweise:

- Für **Nuki/Salto** wird der Status webhook-getrieben aus dem zuletzt
  gespeicherten Event (`lastEvent`) gelesen (`statusSource: "last_event"`),
  ansonsten als Fallback live beim Provider abgefragt.
- Für **iFBS-Locker** bleibt das bisherige `openProcessId`-Polling.
- Empfehlung: Nach `open` kurz auf `open-status` pollen (z.B. alle 2s, max ~30s)
  und das Ergebnis (`confirmed`/`open`) anzeigen.

### 3.4 Buchungen mit Zutritt (nutzerzentriert, tenant-übergreifend)

Für eine „Meine Türen"-Ansicht eines eingeloggten Users über alle Tenants:

- `GET /api/access/bookings?filter=active|upcoming|past|all&includeAccessPoints=true&capability=authorization`
- `GET /api/access/access-points/:accessPointId/bookings?...`

Query-Parameter:

| Param                   | Werte                               | Default |
| ----------------------- | ----------------------------------- | ------- |
| `filter` (oder `state`) | `active`, `upcoming`, `past`, `all` | `all`   |
| `capability`            | `authorization`                     | –       |
| `includeAccessPoints`   | `true`/`false`                      | `false` |
| `includeLockers`        | `true`/`false`                      | `false` |
| `includeBuffer`         | `true`/`false`                      | `false` |

Antwort: `{ "success": true, "data": [ { booking-ähnliches Objekt, accessPointIds, ggf. accessPoints } ] }`.

---

## 4. Permissions – Übersicht

| Aktion                                                   | Permission                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| Tenant-Apps lesen (Provider-Liste, Access-Points listen) | `MANAGE_BOOKABLES` (Read)                                         |
| Tenant-Apps testen / Webhook registrieren                | `MANAGE_TENANTS` (Update)                                         |
| Bookable konfigurieren                                   | `MANAGE_BOOKABLES`                                                |
| Türen einer Buchung listen                               | Owner **oder** `MANAGE_BOOKINGS`                                  |
| Öffnen/Schließen/Status                                  | Owner **oder** `MANAGE_BOOKINGS` + gültige Buchung im Zeitfenster |

---

## 5. UI-Checkliste

**Tenant-Settings (Provider-Apps):**

- [ ] Liste der Access-Apps mit Aktiv-Toggle + Anzeigename
- [ ] Formular Nuki (`apiToken`, `apiBaseUrl`)
- [ ] Formular Salto KS (`clientId`, `clientSecret`, `username`, `password`, `siteId`, `apiBaseUrl`)
- [ ] Secrets maskiert, nur bei Eingabe überschreiben
- [ ] „Verbindung testen"-Button (`/access-apps/:provider/test`)
- [ ] Webhook-Status-Badge für Salto (`webhookRegisteredAt` / `webhookRegistrationError`)
- [ ] Gesamtes `applications`-Array beim Speichern round-trippen

**Bookable-Editor:**

- [ ] `accessPointDetails.active` Toggle
- [ ] `accessBuffer` (before/after in Minuten) für alle Türen des Bookables
- [ ] Türen aus `/accesspoints` auswählen und in `accessPointIds` referenzieren
- [ ] Neue Türen via Provider-Auswahl + `PUT /accesspoints` anlegen (Tenant-Owner)
- [ ] `label`, `mode` (nur aus `supportedModes`) am AccessPoint pflegen
- [ ] Standort per `location-prefill` vorschlagen (nur bei `getLocation` in
      `providerCapabilities`), Übernahme erst beim Speichern

**Booking-Detail / Self-Service:**

- [ ] Türen-Liste via `/access?bookingId=`
- [ ] Open/(Unlatch/Close)-Buttons abhängig von `mode`/`provider`
- [ ] Buttons nur im Zeitfenster (`accessFrom`..`accessTo`) aktiv
- [ ] Status/Bestätigung via `/status` bzw. `/open-status`
- [ ] Hinweis „PIN per Mail" – PIN wird nie über die API geliefert
