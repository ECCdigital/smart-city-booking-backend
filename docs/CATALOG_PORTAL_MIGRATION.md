# Katalog → Portal: Frontend-Migrationsleitfaden

Dieses Dokument beschreibt, was auf der **Katalog-Seite (Frontend)** angepasst
werden muss, damit sie mit der neuen Backend-Struktur ab v4.0.0 funktioniert.

## TL;DR

1. Neuer Endpunkt **`GET /catalog/mode`** liefert den Portal-Modus
   (`offers` | `personal`) und das Branding (Theme + Logo). Diesen einmal pro
   Page-Load aufrufen und als Routing-Hint verwenden.
2. **Kein `503` mehr** auf `/catalog/bundle`, `/catalog/:slug`,
   `/catalog/themes`, `/catalog/themes/:slug` – stattdessen enthält das Payload
   ein Feld `offersEnabled` bzw. `mode`.
3. **Theme + Logo + Favicon** kommen jetzt aus `instance.branding`,
   **`hero`** bleibt pro Katalog-Slug konfigurierbar.
   - `branding.active` (ehemals `branding.theme.active`) ist der **einzige
     Schalter** für das gesamte Instanz-Branding. Bei `active: false`
     enthalten die Responses **`theme: null`**, **`logoUrl: null`** **und**
     **`faviconUrl: null`** – das Frontend nutzt dann sein Default-Theme,
     Default-Logo und Default-Favicon.
   - `hero` (am Katalog) ist davon nicht betroffen und wird unabhängig
     ausgeliefert.
4. Im **Instance-Settings-Formular** zwei umbenannte Felder anbieten
   (`publicOffersEnabled`, `portalUrl`); legacy Felder werden serverseitig
   automatisch mitgepflegt, müssen also nicht mehr im UI gepflegt werden.

---

## 1. Konzeptueller Wechsel

| Vorher | Nachher |
|---|---|
| `instance.enableCatalog = false` → Frontend bekommt **503** und kann den Katalog nicht aufrufen. | `instance.publicOffersEnabled = false` → Frontend bekommt **200** mit einem reduzierten Payload und rendert den **persönlichen Bereich** (Profil + Buchungen) anstelle der Buchungsangebote. |
| Logo/Theme nur verfügbar, wenn Katalog aktiviert. | Logo/Theme werden **immer** ausgeliefert, unabhängig vom Modus. |
| `instance.catalogUrl` | `instance.portalUrl` |

Die Katalog-URL ist nun also kein "an/aus"-Feature mehr, sondern ein **Portal**
mit zwei Modi.

---

## 2. Neue / geänderte API-Endpoints

### 2.1 `GET /catalog/mode` *(neu)*

Routing-Hint für das Frontend.

```json
{
  "mode": "offers",            // "offers" | "personal"
  "portalUrl": "https://...",
  "branding": {
    "active": true,
    "logoUrl": "https://.../logo.png",
    "faviconUrl": "https://.../favicon.ico",
    "theme": {
      "colors": { "primary": "#005ca9", "secondary": "#ffffff" }
    }
  }
}
```

Bei inaktivem Branding sieht der `branding`-Block so aus:

```json
{
  "branding": {
    "active": false,
    "logoUrl": null,
    "faviconUrl": null,
    "theme": null
  }
}
```

Empfehlung: **Direkt nach dem App-Bootstrap** aufrufen, im globalen Store
ablegen (Pinia/Vuex/Redux) und für das Layout-Routing nutzen:

```ts
const { mode, branding } = await api.get("/api/catalog/mode");
applyTheme(branding.theme);
setLogo(branding.logoUrl);
router.replace(mode === "offers" ? "/catalog" : "/me");
```

### 2.2 `GET /catalog/themes` und `GET /catalog/themes/:slug`

Response-Schema **erweitert** (kein Breaking Change für Lese-Pfad, aber kein
`503` mehr):

```json
{
  "active": true,
  "theme": { "colors": { "primary": "...", "secondary": "..." } },
  "logoUrl": "https://.../logo.png",
  "faviconUrl": "https://.../favicon.ico",
  "hero": { "title": "Willkommen", "subtitle": "..." },
  "visibility": "public"
}
```

- `active`, `theme`, `logoUrl` und `faviconUrl` stammen aus
  `instance.branding`.
- `hero` stammt weiterhin aus dem (jeweiligen) Katalog.
- **Bei `branding.active === false`** sind `theme`, `logoUrl` und
  `faviconUrl` **alle drei `null`** – das Frontend soll dann ausschließlich
  auf seine Default-Optik zurückfallen. `hero` und `visibility` bleiben
  befüllt.
- **Wegfall**: Vorher endete der Call bei deaktiviertem Katalog in `503`.
  Frontend muss diesen Fehlerpfad **entfernen** und stattdessen den
  `active`-Flag auswerten.

### 2.3 `GET /catalog/bundle`

Erweitert um `offersEnabled` und `branding`:

**Offers-Modus** (`publicOffersEnabled = true`):
```json
{
  "offersEnabled": true,
  "branding": {
    "active": true,
    "logoUrl": "...",
    "faviconUrl": "...",
    "theme": { "colors": {...} }
  },
  "portalUrl": "https://...",
  "catalog": { /* exportPublic() */ },
  "tenants": [ { "id": "...", "name": "..." } ]
}
```

**Personal-Modus** (`publicOffersEnabled = false`, Branding inaktiv):
```json
{
  "offersEnabled": false,
  "branding": {
    "active": false,
    "logoUrl": null,
    "faviconUrl": null,
    "theme": null
  },
  "portalUrl": "https://...",
  "catalog": { /* nur Basisdaten */ },
  "tenants": []
}
```

`branding.active` und `publicOffersEnabled` sind unabhängig voneinander – auch
im Personal-Modus kann das Branding aktiv sein (Theme wird ausgeliefert) und
auch im Offers-Modus kann das Branding deaktiviert sein (`theme: null`).

Frontend-Logik:

```ts
const bundle = await api.get("/api/catalog/bundle");
if (!bundle.offersEnabled) {
  showPersonalArea(bundle.branding);
  return;
}
showOffers(bundle);
```

### 2.4 `GET /catalog/:slug`

Verhält sich analog. Bei `publicOffersEnabled = false`:

```json
{
  "offersEnabled": false,
  "slug": "<requested-slug>",
  "branding": {
    "active": true,
    "logoUrl": "...",
    "faviconUrl": "...",
    "theme": { "colors": {...} }
  }
}
```

Bei `publicOffersEnabled = true` wie bisher (vollständiges Catalog-Objekt).

> **Hinweis:** Der Endpoint liefert **niemals mehr 503**. Ein altes Frontend,
> das `503` als "Feature deaktiviert" interpretiert, würde stattdessen einen
> reduzierten 200-Payload sehen – bitte unbedingt anpassen.

---

## 3. Instance-Settings-UI

### 3.1 Felder im Admin-Bereich

| Altes Feld | Neues Feld | UI-Empfehlung |
|---|---|---|
| `enableCatalog` (Boolean) | `publicOffersEnabled` (Boolean) | Toggle „Öffentliche Buchungsangebote anzeigen" mit Hinweistext: *„Wenn deaktiviert, sehen Besucher beim Aufruf der Portal-URL nur ihren persönlichen Bereich (Profil & Buchungen)."* |
| `catalogUrl` (String) | `portalUrl` (String) | Label „Portal-URL"; selber Input wie bisher. |
| `catalog.theme.active` | `instance.branding.active` | Eigener Toggle „Branding aktiv" auf der Branding-Sektion. Bei `false` werden weder `theme`, `logoUrl` noch `faviconUrl` ausgeliefert. |
| `catalog.theme.colors` | `instance.branding.theme.colors` | Color-Picker für `primary`/`secondary`. |
| `catalog.logoUrl` (am Catalog-Objekt) | `instance.branding.logoUrl` | Upload-Feld in der Branding-Sektion. |
| *(neu)* | `instance.branding.faviconUrl` | Zusätzliches Upload-Feld in der Branding-Sektion (Favicon der Instanz). |
| `catalog.hero` | **bleibt im Katalog** | Wird weiterhin im Katalog-Edit-Bildschirm gepflegt. |

### 3.2 Übergangsphase

Während der Übergangsphase (zwei Releases) hält das Backend die Felder
bidirektional synchron:

- Setzt der User im UI `publicOffersEnabled = true`, wird serverseitig
  automatisch auch `enableCatalog = true` gespiegelt (und umgekehrt).
- Setzt der User im UI `portalUrl`, wird `catalogUrl` ebenfalls geschrieben.

Das heißt: **Das Frontend darf bereits ausschließlich mit den neuen Feldnamen
arbeiten**, ohne dass alte Clients brechen.

### 3.3 Branding aus dem Katalog entfernen

In der Catalog-Edit-Maske (Instance-Catalog) sollten die UI-Sektionen für
`theme` und `logoUrl` **aus dem Katalog entfernt** und in die
Instance-Settings-Seite verschoben werden. Hero bleibt in der Katalog-Maske.

> Hintergrund: `Catalog.theme` und `Catalog.logoUrl` bleiben im Backend-Schema
> noch eine Release-Generation als `@deprecated` erhalten, werden aber von
> keinem Endpoint mehr gelesen. Ein späteres Cleanup-Migrationsskript wird die
> Felder vollständig entfernen.

---

## 4. Konkrete Frontend-TODOs

1. **API-Layer**
   - [ ] Neue Methode `fetchPortalMode()` für `GET /catalog/mode`.
   - [ ] `fetchTheme(slug?)`: Response-Type um `logoUrl` + `hero` ergänzen
         (kein optionaler 503-Pfad mehr).
   - [ ] `fetchCatalogBundle()`: Response-Type um `offersEnabled` und
         `branding` ergänzen.
   - [ ] `fetchCatalogBySlug(slug)`: Discriminated Union für
         `offersEnabled: false` einführen.

2. **App-Bootstrap / Routing**
   - [ ] Beim App-Start `fetchPortalMode()` aufrufen, Branding global anwenden,
         Mode in Store ablegen.
   - [ ] Router-Guard / Layout: Bei `mode === "personal"` auf den persönlichen
         Bereich routen, statt Katalog-Listing zu rendern.
   - [ ] Fehlerseiten für `503` aus den Katalog-Calls entfernen.

3. **Persönlicher Bereich**
   - [ ] Route / View `/me` (oder vergleichbar) implementieren, die Profil
         und Buchungen rendert (Daten kommen aus den bestehenden User-/
         Booking-Endpoints – kein neuer Endpoint nötig).
   - [ ] Branding (Logo + Theme-Farben) anwenden – kommt aus
         `branding` der `/catalog/mode`- oder `/catalog/themes`-Response.

4. **Admin-Instance-Settings**
   - [ ] Toggle umbenennen: `enableCatalog` → `publicOffersEnabled`.
   - [ ] Input umbenennen: `catalogUrl` → `portalUrl`.
   - [ ] Neue Branding-Sektion mit `active` (Toggle), `theme.colors`
         (primary/secondary), `logoUrl` und `faviconUrl` hinzufügen.
   - [ ] Frontend muss `branding.active === false` (bzw. `theme === null`
         **und** `logoUrl === null`) als "Default-Optik anwenden" behandeln –
         **kein** Logo und **kein** Theme aus dem Backend rendern.

5. **Admin-Catalog-Edit**
   - [ ] Sektionen `Theme` und `LogoUrl` entfernen (verschoben nach
         Instance-Settings).
   - [ ] `hero`-Sektion belassen.

---

## 5. Caching-Hinweis

`branding` und `publicOffersEnabled` werden serverseitig **5 Minuten**
gecached (`InstanceCache`). Nach einer Änderung in den Instance-Settings ist
der Cache sofort invalidiert – das Frontend muss daher **nicht** zwischen
Mutation und Refetch warten. Wenn ein Eventbus/SSE existiert, kann optional
ein `instance.updated`-Event genutzt werden, um Branding global neu zu
laden.

---

## 6. Migration / Rollout-Reihenfolge

1. **Backend deployen** (dieser Branch). Migrationen laufen automatisch:
   - `28-05-2026-add-instance-branding` (mappt `catalog.theme.active` →
     `instance.branding.active`, `catalog.theme.colors` →
     `instance.branding.theme.colors`, `catalog.logoUrl` →
     `instance.branding.logoUrl`, `branding.faviconUrl` wird leer angelegt)
   - `28-05-2026-add-branding-favicon-url` (Idempotenz-Migration: ergänzt
     `branding.faviconUrl: ""` falls noch nicht vorhanden – wichtig für
     Umgebungen, in denen `add-instance-branding` bereits gelaufen ist)
   - `28-05-2026-rename-instance-catalog-fields` (kopiert `enableCatalog` →
     `publicOffersEnabled`, `catalogUrl` → `portalUrl`)
2. **Frontend deployen** mit den oben beschriebenen Anpassungen.
3. Optional in Folge-Release: Cleanup-Migration, die `theme`/`logoUrl` aus
   den Catalog-Dokumenten und `enableCatalog`/`catalogUrl` aus dem
   Instance-Dokument entfernt. Das Backend muss zu diesem Zeitpunkt keine
   Fallbacks mehr aus den Legacy-Feldern lesen.

---

## 7. Quick Reference – Endpoints

| Endpoint | Methode | Verhalten neu |
|---|---|---|
| `/api/catalog/mode` | GET | Liefert `{ mode, portalUrl, branding }`. Immer 200. |
| `/api/catalog/themes` | GET | Liefert `{ theme, logoUrl, hero, visibility }`. Immer 200. |
| `/api/catalog/themes/:slug` | GET | Liefert `{ theme, logoUrl, hero, visibility }` für den Slug. Immer 200. |
| `/api/catalog/bundle` | GET | Liefert `{ offersEnabled, branding, portalUrl, catalog, tenants }`. Bei `offersEnabled=false` ist `tenants=[]`. |
| `/api/catalog/:slug` | GET | Bei `offersEnabled=false`: minimaler Payload `{ offersEnabled, slug, branding }`. Sonst voller Katalog. |
| `/api/instances/` (PUT) | PUT | Schreibt neue Felder; alte Felder werden serverseitig mitgepflegt. |
