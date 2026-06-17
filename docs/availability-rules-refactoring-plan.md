# Plan: Gemeinsame Availability-Rules-Schicht (Option 2)

## Ausgangslage

Nach den Optimierungsphasen 0–3 existieren **zwei parallele Implementierungen** der Verfügbarkeitslogik:

| Pfad | Einsatz | Datenquelle |
|---|---|---|
| `CalendarService` (V1) | `GET …/availability` | `ItemCheckoutService` pro Segment (iterativ) |
| `CalendarServiceV2` | `GET …/availability/v2` | Eigene Module + vorgeladener `AvailabilityContext` |

V2 ist deutlich schneller, aber Regeln sind **dupliziert**. Änderungen in `ItemCheckoutService` erfordern heute manuelle Anpassungen in den Availability-Modulen — sonst driften API und echter Checkout auseinander.

### Betroffene Duplikate (Stand V2 Phase 3)

| Regel | Checkout (`item-checkout-service.js`) | Availability V2 |
|---|---|---|
| Kapazität Origin | `checkAvailability()` / `calculateAmountBooked()` | `capacity-interval-calculator.js` |
| Parent-Verfügbarkeit | `checkParentAvailability()` | `computeWindowAvailability()` (exclusive mode) |
| Child-Verfügbarkeit | `checkChildBookings()` | `computeWindowAvailability()` (additive mode) |
| Ticket-Parent | `calculateAmountBookedTicketsByParent()` | `computeTicketParentCapacityIntervals()` |
| Event-Sitze | `checkEventSeats()` | `hasEventSeatsAvailable()` |
| Event-Datum | `checkEventDate()` | `isEventDateBookable()` |
| Buchungsdauer | `checkBookingDuration()` | `availability-duration-filter.js` |
| Berechtigungen | `checkPermissions()` | `hasBookingPermission()` |
| Max. Buchungsvorlauf | `checkMaxBookingDate()` | `generateTimePeriodsFromMaxBookingAdvance()` + Tenant-Context |

---

## Ziel

**Eine gemeinsame Domänen-Schicht** (`AvailabilityRules`), die:

1. reine Geschäftsregeln enthält (ohne DB, ohne HTTP),
2. von `ItemCheckoutService` **und** `CalendarServiceV2` genutzt wird,
3. unterschiedliche **Datenadapter** erlaubt (DB live vs. `AvailabilityContext`),
4. durch Unit-Tests gegen Golden Cases abgesichert ist.

```
┌─────────────────────┐     ┌─────────────────────┐
│  ItemCheckoutService │     │  CalendarServiceV2  │
└──────────┬──────────┘     └──────────┬──────────┘
           │                             │
           │    ┌────────────────────────┘
           ▼    ▼
    ┌──────────────────────────────────────┐
    │         AvailabilityRules            │
    │  (pure functions / rule engine)      │
    └──────────────────┬───────────────────┘
                       │
           ┌───────────┴───────────┐
           ▼                       ▼
┌─────────────────────┐  ┌─────────────────────┐
│ CheckoutDataProvider │  │ ContextDataProvider │
│ (live DB queries)    │  │ (AvailabilityContext)│
└─────────────────────┘  └─────────────────────┘
```

---

## Ziel-Modulstruktur

```
src/commons/availability/
├── availability-rules/
│   ├── index.js                          # öffentliche API
│   ├── types.js                          # JSDoc-Typen / Konstanten
│   ├── booking-amount.js                 # amountBooked, getBookedAmountForBookable
│   ├── capacity-rules.js                 # isOriginAvailable, sweep-Intervalle
│   ├── parent-child-rules.js             # parent exclusive, child additive, ticket-parent
│   ├── event-rules.js                    # eventDate, eventSeats
│   ├── duration-rules.js                 # min/max duration
│   ├── permission-rules.js               # isBookable, allowCheckout
│   ├── max-booking-date-rules.js         # maxBookingAdvance
│   └── providers/
│       ├── availability-data-provider.js # Interface
│       ├── checkout-data-provider.js     # Wraps BookingManager / BookableManager
│       └── context-data-provider.js      # Wraps AvailabilityContext
├── availability-context.js               # (bestehend, evtl. verschieben)
├── capacity-interval-calculator.js       # wird dünn: ruft capacity-rules auf
├── availability-interval-merger.js       # (unverändert)
└── availability-interval-utils.js        # (unverändert)
```

> **Hinweis:** Bestehende Dateien unter `services/availability/` können schrittweise nach `commons/availability/` migriert werden, um Checkout und Calendar gleichermaßen zu bedienen.

---

## Phasenplan

### Phase R1 — Regeln extrahieren & testen (3–4 PT)

**Ziel:** Pure Functions ohne Seiteneffekte, vollständig unit-getestet.

| Task | Beschreibung | Aufwand |
|---|---|---|
| R1.1 | `booking-amount.js`: `sumBookedAmount(bookings, bookableId)` aus Checkout extrahieren | 0,5 PT |
| R1.2 | `capacity-rules.js`: `evaluateOriginCapacity({ bookings, capacity, amount, mode })` | 1 PT |
| R1.3 | `parent-child-rules.js`: Parent exclusive, Child additive, Ticket-Parent combined | 1 PT |
| R1.4 | `event-rules.js`: `isEventBookable(event)`, `hasEventSeats(eventBookings, …)` | 0,5 PT |
| R1.5 | `duration-rules.js`: `isDurationAllowed(bookable, timeBegin, timeEnd)` | 0,25 PT |
| R1.6 | `permission-rules.js`: Wrapper um `CheckoutPermissions` | 0,25 PT |
| R1.7 | Golden-File-Tests pro Regel (min. 3 Cases je Regel) | 0,5 PT |

**Akzeptanzkriterium:** Alle neuen Tests grün; Checkout und V2 noch **unverändert** im Verhalten.

---

### Phase R2 — Data Provider einführen (2–3 PT)

**Ziel:** Einheitliche Schnittstelle für Buchungsdaten.

```javascript
// availability-data-provider.js (Interface)
class AvailabilityDataProvider {
  getBookable() {}
  getParentBookables() {}
  getRelatedBookables() {}
  getConcurrentBookings(bookableId, timeBegin, timeEnd) {}
  getRelatedBookings(bookableId) {}
  getTenant() {}
  getEvent() {}
  getEventBookings() {}
}
```

| Task | Beschreibung | Aufwand |
|---|---|---|
| R2.1 | Interface + `ContextDataProvider` (aus `AvailabilityContext`) | 0,5 PT |
| R2.2 | `CheckoutDataProvider` für `ItemCheckoutService` | 1 PT |
| R2.3 | `checkWindowAvailability(provider, { timeBegin, timeEnd, amount, user })` als Orchestrator | 1 PT |
| R2.4 | Integrationstest: gleicher Input → gleiches Ergebnis über beide Provider | 0,5 PT |

**Akzeptanzkriterium:** `checkWindowAvailability` liefert identisches Ja/Nein wie aktueller `ItemCheckoutService.checkAll()` für repräsentative Fälle.

---

### Phase R3 — ItemCheckoutService refactoren (2–3 PT)

**Ziel:** Checkout-Checks delegieren an `AvailabilityRules`.

| Task | Beschreibung | Aufwand |
|---|---|---|
| R3.1 | `checkAvailability()` → `capacity-rules` + Provider | 0,5 PT |
| R3.2 | `checkParentAvailability()` / `checkChildBookings()` → `parent-child-rules` | 1 PT |
| R3.3 | `checkEventSeats()` / `checkEventDate()` → `event-rules` | 0,5 PT |
| R3.4 | `checkBookingDuration()` → `duration-rules` | 0,25 PT |
| R3.5 | Regression: bestehende Checkout-Tests + manuelle Buchungsflows | 0,75 PT |

**Akzeptanzkriterium:** Kein Verhaltensunterschied beim Checkout; `ItemCheckoutService` wird dünner.

---

### Phase R4 — CalendarServiceV2 anbinden (1–2 PT)

**Ziel:** V2 nutzt dieselben Regelmodule wie Checkout.

| Task | Beschreibung | Aufwand |
|---|---|---|
| R4.1 | `capacity-interval-calculator.js` ruft `capacity-rules` auf (Sweep bleibt, Logik zentral) | 0,5 PT |
| R4.2 | `availability-rules-checker.js` / `availability-duration-filter.js` durch `event-rules` / `duration-rules` ersetzen | 0,5 PT |
| R4.3 | Duplizierte Hilfsfunktionen entfernen | 0,25 PT |
| R4.4 | `compare-availability`-Script: V1 vs. V2 Abweichungen dokumentieren oder V1 deprecaten | 0,25 PT |

**Akzeptanzkriterium:** `npm run compare:availability` zeigt keine inhaltlichen Abweichungen bei Standard-Bookables (außer bewusst dokumentierte V1-Bugs).

---

### Phase R5 — Aufräumen & Rollout (1–2 PT)

| Task | Beschreibung | Aufwand |
|---|---|---|
| R5.1 | V1-Endpunkt als deprecated markieren (Header / Log) | 0,25 PT |
| R5.2 | V2 unter `/availability` promoten (optional, Breaking Change abstimmen) | 0,5 PT |
| R5.3 | Alte duplizierte Dateien löschen | 0,25 PT |
| R5.4 | README / API-Docs aktualisieren | 0,5 PT |

---

## Gesamtaufwand

| Phase | Aufwand | Kumuliert |
|---|---|---|
| R1 Regeln extrahieren | 3–4 PT | 3–4 PT |
| R2 Data Provider | 2–3 PT | 5–7 PT |
| R3 Checkout refactoren | 2–3 PT | 7–10 PT |
| R4 V2 anbinden | 1–2 PT | 8–12 PT |
| R5 Rollout | 1–2 PT | 9–14 PT |

**Empfohlene Reihenfolge:** R1 → R2 → R3 → R4 → R5 (strikt sequentiell, da jede Phase auf der vorherigen aufbaut).

---

## Teststrategie

### Unit-Tests (pro Regelmodul)

- Kapazität: leer, teilweise belegt, voll, überlappende Buchungen mit unterschiedlichen `amount`
- Parent exclusive vs. Child additive
- Ticket-Parent mit gemischten Child-Bookings
- Event in Vergangenheit / Zukunft
- `minBookingDuration` an Segmentgrenzen

### Contract-Tests (Provider)

Gleicher synthetischer Datensatz → `CheckoutDataProvider` und `ContextDataProvider` liefern identische Buchungslisten.

### API-Regression

```bash
npm run compare:availability -- -t <tenant> -b <bookable> -s … -e …
```

Nach R4 sollten Abweichungen nur noch bei bekannten V1-Bugs auftreten.

---

## Risiken & Mitigationen

| Risiko | Mitigation |
|---|---|
| Refactoring bricht Checkout | R3 erst nach R1+R2; umfangreiche Regressionstests |
| Sweep-Logik weicht von Punkt-Check ab | Sweep in `capacity-rules` kapseln; gleiche `evaluate`-Funktion für Einzelfenster |
| Long-Range / nicht-zeitbezogene Bookables | Explizite Testmatrix; Sonderpfade in `booking-amount.js` |
| Scope Creep | Keine neuen Features während Refactoring; Verhalten 1:1 erhalten |

---

## Nicht im Scope

- Performance-Optimierungen über V2 Phase 3 hinaus
- UI-/Frontend-Anpassungen
- V1-Endpunkt sofort entfernen (erst nach R5 und Abstimmung)
- Preis-/Coupon-Logik (gehört zum Checkout, nicht zur Availability-API)

---

## Nächster konkreter Schritt

**Phase R1.1 starten:** `sumBookedAmount` und `isTimeRelatedBookable` aus `item-checkout-service.js` und `capacity-interval-calculator.js` in `availability-rules/booking-amount.js` konsolidieren, mit Tests — ohne Verhalten zu ändern.

---

## Referenzen im Code (Ist-Zustand)

| Datei | Rolle |
|---|---|
| `src/commons/services/calendar-service-v2.js` | V2-Orchestrierung |
| `src/commons/services/calendar-service.js` | V1 (Checkout pro Segment) |
| `src/commons/services/checkout/item-checkout-service.js` | Checkout-Regeln (Referenz) |
| `src/commons/services/availability/availability-context.js` | Request-Scope Cache |
| `src/commons/services/availability/capacity-interval-calculator.js` | Sweep / Kapazität |
| `src/commons/services/availability/availability-rules-checker.js` | Event / Permission |
| `src/commons/services/availability/availability-duration-filter.js` | Min-Dauer |
| `scripts/compare-availability.js` | V1/V2-Vergleich |
