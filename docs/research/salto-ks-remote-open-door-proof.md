# Salto KS Remote-Open — Türbeweis (Messung)

Gemessener, scharfer Lauf des im Grilling festgelegten Ablaufs gegen die Accept-Anlage. **Ergebnis dieses Laufs (2026-08-19): die Tür „Tür 01" öffnet über den festgelegten Weg (selbstberechneter OTP) NICHT** — alle Versuche `otp_invalid`.

> **⚠️ Überholt — siehe [Addendum 2026-08-25](#addendum-2026-08-25--gegenbeweis-die-tür-öffnet-über-die-connect-api):** Der Weg ist **bewiesen**. Der Fehlschlag unten war selbstverschuldet (App-Aktivierung rotiert das Secret; echtes `delta` erzeugt eine PIN-Ambiguität), nicht ein Beleg gegen den API-Weg.

|               |                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Lauf          | **2026-08-19 17:09:16 UTC**, ARMED (mit `PATCH …/locking`)                                                                                    |
| Umgebung      | `accept` — API `https://clp-accept-user.my-clay.com`, Identity `https://identity-acc.eu.my-clay.com`                                          |
| Site          | `00d20e57-9ac2-4b76-a65d-7911bfb00da2` (`site_uid` `DE4520168385`)                                                                            |
| IQ „IQ 01"    | `5dfdc54e-8335-11f0-a2ed-6045bd92d38f`                                                                                                        |
| Lock „Tür 01" | `4d77312f-4a87-41db-a97b-f9d948dcc908`                                                                                                        |
| System-User   | Site-User `be523f65-6e55-446c-91a5-337d69bb27a2`, Plattform-User `40c32eb0-62d4-4e16-b60e-5c359dca7f18` (aktiviert seit 2026-08-19 07:05 UTC) |
| Skript        | `.scratch/diag/salto-remote-open-door-proof.js --arm` (untracked, gitignored)                                                                 |
| PIN-Quelle    | Heute Morgen (~07:02 UTC) gemailte 4-stellige IQ-PIN, lokal in gitignorierter Datei; **nicht** in diesem Protokoll                            |
| Secret-Quelle | Bei Erst-`GET …/secret` (vor Aktivierung) erfasstes 16-stelliges Secret, lokal; **nicht** hier                                                |

Maskierung: PIN, Secret und deren Werte erscheinen nirgends. UUIDs unmaskiert. Die abgeleiteten OTPs sind einmalig-abgelaufene Nonces und für die Reproduzierbarkeit mitprotokolliert.

## Frage (aus dem Türbeweis-Ticket)

> Öffnet die Accept-Tür „Tür 01" tatsächlich, wenn das Backend den festgelegten Weg exakt ausführt — und was ist der gemessene Ablauf?

**Antwort: Nein.** Der festgelegte Weg (Secret + gemailte PIN → selbstberechneter OTP nach `MD5(UTC "YYYYmmDDHHMMSS" + secret + PIN)[0:5]` → `PATCH …/locking`) wird von der Anlage mit `otp_invalid` abgewiesen; die Tür bleibt zu, kein `access_by: remote`-Eintrag entsteht. Die Karte scheitert damit **kontrolliert** gemäß der im Ticket festgelegten Abbruchkriterien.

## Gemessener Ablauf (Schritt für Schritt)

| Schritt | Aufruf                                                                                                 | Status                       | Deutung                                                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1       | `GET /v1.2/sites/{site}/iqs/{iq}/secret` (ohne OTP)                                                    | **403**                      | Erwartet: „Cannot get first secret for an already activated Iq." → gespeichertes Secret (16 Zeichen) verwendet                                                                             |
| 2       | `GET /v1.2/sites/{site}/iqs/{iq}/pin?send_email=true`                                                  | **403** `command_forbidden`  | Post-Aktivierung geschlossen — der `send_email`-Weg liefert dem bereits aktivierten System-User keine neue PIN mehr. Für den OTP wurde die heute Morgen gemailte, gespeicherte PIN benutzt |
| 4a      | `PATCH …/locks/{lock}/locking {unlocked, otp}` — Variante _jetzt_, Stamp `20260819170918`, OTP `81a1d` | **400** `3102` `otp_invalid` | —                                                                                                                                                                                          |
| 4b      | dito — Variante _+1 min_, Stamp `20260819171018`, OTP `6ff96`                                          | **400** `3102` `otp_invalid` | ±1-min-Variante deckt Uhr-Drift ab — ebenfalls abgewiesen                                                                                                                                  |
| 4c      | dito — Variante _−1 min_, Stamp `20260819170818`, OTP `e4710`                                          | **400** `3102` `otp_invalid` | —                                                                                                                                                                                          |
| +       | `GET …/iqs/{iq}/secret?otp=…` (frisches Secret, letzter Anlauf)                                        | **403**                      | Frisches Secret post-Aktivierung nicht holbar → Extra-Anlauf entfällt, Weg tot                                                                                                             |
| 5       | `GET /v1.1/sites/{site}/entries?$top=20&$orderby=utc_date_time desc`                                   | **200**                      | 20 Ereignisse; **kein** frischer `lock_opened` / `access_by: remote` mit `user_id 40c32eb0…` — kein Beweis                                                                                 |

**Verdikt des Laufs: `WEG TOT`** — 3/3 Versuche im 25-min-Fenster + Anlauf mit frischem Secret, alle mit OTP-Fehler.

## Beobachtungen

- **Kein `otp_blocked` in diesem Lauf.** Vier OTP-Submissions (3× PATCH + der `secret?otp`) blieben durchweg `otp_invalid`, ohne dass die Anlage sperrte. Frühere Läufe (Contract-Doc §9) meldeten `otp_blocked` teils schon nach 3 Fehlversuchen — das Sperrverhalten ist nicht deterministisch nach fester Zählung, sondern variiert (evtl. pro Command/Endpoint oder Zeitfenster).
- **Schutzregeln haben gegriffen:** genau 3 PATCH-Versuche mit distinkten Zeitvarianten, kein Retry mit neu berechnetem OTP für dieselbe Sekunde, genau ein Extra-Anlauf mit frischem Secret, sauberer Stopp. Kein „blind weiterprobieren".
- **Deckungsgleich mit der Historie** (`salto-ks-api-contract.md` §9, „No remote open ever succeeded"): auch mit der gemailten PIN und der dokumentierten OTP-Formel — derselben, die `PUT …/iqs/{iq}/pin` Sekunden zuvor als gültig akzeptiert — weist `PATCH …/locking` den selbstberechneten OTP ab.

## Bedeutung für die Karte

Der im Grilling festgelegte Beschaffungsweg (Selbstberechnung aus Secret + PIN) ist damit am Türbeweis **widerlegt**: Er öffnet die Accept-Tür nicht. Die Hypothese „OTP-Formel unverändert / self-computed OTP genügt" fällt für diese Anlage. Innerhalb der bewusst gesetzten Grenzen (kein Support/BU, kein Hardware-Reset, kein neuer IQ ohne `otp_enabled`, Core-API nur Quelle) ist der Remote-Open-Weg über die Connect API **kontrolliert gescheitert**.

Offene, aber bewusst außerhalb dieses Tickets liegende Fäden: Warum akzeptiert `PUT …/pin` denselben OTP-Algorithmus, `PATCH …/locking` aber nicht (anderer Validierungspfad? andere Ableitung fürs Schloss?) — siehe Contract-Doc §9. Diese gehören in das Folge-/Spec-Ticket, nicht hierher. _(Beantwortet im Addendum unten.)_

## Addendum 2026-08-25 — Gegenbeweis: die Tür öffnet über die Connect API

**Ergebnis: BEWIESEN / POSITIV.** Das Backend hat „Tür 01" über die Connect API mit selbstberechnetem OTP geöffnet. Der Negativ-Befund vom 2026-08-19 oben bleibt als Messung korrekt, seine Deutung („Weg tot") ist widerlegt.

|             |                                                                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lauf        | **2026-08-25, ~07:25 UTC**, ARMED                                                                                                                                 |
| System-User | Auf ein frisches, nie an IQ 01 aktiviertes Konto umgestellt (`marvin.anders@posteo.com`, Accessor `45c85495-a598-4d1e-ba97-20c657486346`, Rolle mit Remote-Recht) |
| Skript      | `.scratch/diag/salto-bootstrap-experiment.js` (Phasen `api-capture` / `api-activate` / `api-open`, dry by default)                                                |
| Bestätigung | `PATCH …/locking` → **200**; Fern-Öffnung in der Salto-Web-App sichtbar                                                                                           |

### Der funktionierende Weg (rein API, kein App-Secret)

| #   | Aufruf                                                                              | Status                                                         |
| --- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | `GET /v1.2/sites/{site}/iqs/{iq}/secret` ohne OTP (User nie aktiviert)              | 200 → first secret `S`                                         |
| 2   | `GET /v1.2/sites/{site}/iqs/{iq}/pin?send_email=true`                               | 204 → Erst-PIN `P` per Mail                                    |
| 3   | `PUT /v1.2/sites/{site}/iqs/{iq}/pin {otp(S,P), delta:"0000"}`                      | 204, `activated: true` — **Aktivierung per API**, `S` überlebt |
| 4   | `PATCH /v1.2/sites/{site}/locks/{lock}/locking {locked_state:"unlocked", otp(S,P)}` | **200 — Tür öffnet remote**                                    |

### Warum der 08-19-Lauf scheiterte (beide Rätsel gelöst)

1. **App-Aktivierung rotiert das Secret.** Das Secret ist pro Nutzer; eine Aktivierung in der Salto-App handelt ein neues aus, das nur die App kennt. Ein gespeichertes first secret wird dadurch still ungültig — jeder `PATCH …/locking` endet in `otp_invalid`, obwohl die Aktivierung von außen unverändert aussieht. **Kernbedingung: per API aktivieren, NIE per App** (ADR 0002).
2. **Echtes `delta` erzeugt eine PIN-Ambiguität.** Der 08-19-Lauf aktivierte mit `delta: 9751`; danach akzeptierte `PUT …/pin` (Cloud-Validierung) OTPs, die `PATCH …/locking` (IQ-Validierung) ablehnte — die beiden Seiten waren sich über die geltende PIN uneins. `delta:"0000"` (PIN bleibt die gemailte `P`) behebt das; dasselbe `(S, P)` passiert dann beide Endpunkte.

Die OTP-Formel `MD5(UTC "YYYYmmDDHHMMSS" + S + P)[0:5]` gilt unverändert; `PUT …/pin` mit `delta:"0000"` ist zugleich ein nebenwirkungsfreies OTP-Orakel. Integrationsweg: `docs/specs/salto-ks-remote-open.md`; Grundsatzentscheidung: `docs/adr/0002-salto-iq-activation-via-api-only.md`.
