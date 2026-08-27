# Smart City Booking Backend

Multi-Tenant-Backend für die Buchung kommunaler Ressourcen (Räume, Flächen, Geräte) inklusive Zahlungsabwicklung und physischem Zugang (Türschlösser, Schließfächer).

## Language

### Custom Fields

**Mail-Sichtbarkeit (eines Custom Fields)**:
Die pro Feld-Definition getroffene Wahl, ob der im Checkout eingegebene Wert im Buchungsdetails-Block aller Buchungs-Mails erscheint — für alle Empfänger gleich, Kunde wie Betreiber. Nur Checkout-Felder können sie tragen; ein leeres Feld mit Mail-Sichtbarkeit erscheint als „nicht angegeben", es fällt nicht weg.
_Avoid_: mailAttach (das sind Datei-Anhänge), Mail-Flag, showInMail (als Sprechbegriff — das ist der Feldname)

### Mediathek

**Medium**:
Der Datenbank-Eintrag, der eine von der Plattform verwaltete Datei (Bild oder Dokument) beschreibt und die alleinige Quelle der Wahrheit über sie ist — der Storage hält nur Bytes. Trägt die Datei-Fakten (Art, Typ, Größe, Titel, Alt-Text, Uploader, Prüfsumme), aber keine Kontextangaben einzelner Verwendungsstellen. Zwei gleiche Uploads ergeben zwei Medien; bewusste Wiederverwendung läuft über den Mediathek-Picker, nicht über Dedupe. Die Datei eines Mediums ist unveränderlich — ein Austausch ist ein neues Medium, geändert werden nur die Datei-Fakten.
_Avoid_: File/Datei (als Entity-Name), Asset, Bild (unqualifiziert — Medien umfassen auch Dokumente)

**Medien-Referenz**:
Die typisierte Verwendungsstelle einer Datei an einer Entität (Titelbild, Bilderliste, Anhang): verweist entweder auf ein Medium oder auf einen externen Link — genau eines von beidem. Interne Plain-URLs sind kein dritter Weg, sondern Alt-Bestand, den die Migration in Medien-Referenzen überführt. Kontextfelder wie Caption oder Mail-Anhang-Flags gehören zur Referenz bzw. ihrer Verwendungsstelle, nie zum Medium.
_Avoid_: imgUrl (als Sprechbegriff), Bild-URL, Link (unqualifiziert)

**Variante (eines Mediums)**:
Eine tatsächlich erzeugte Größen-/Format-Ausleitung eines Bild-Mediums; Name und Format zusammen identifizieren sie (z.B. thumb/webp). Am Medium stehen nur Varianten, die wirklich existieren — nie per Konvention abgeleitete Pfade.
_Avoid_: Thumbnail (als Modellbegriff), Preset (das ist die Erzeugungs-Konfiguration, nicht die erzeugte Datei)

**Preset (einer Bildvariante)**:
Die benannte Erzeugungs-Vorschrift für Varianten — Name, Zielmaße, Zuschnitt und Format. Frontends wählen Presets nach Anzeige-Kontext, nie nach Pixeln; die Maße sind Sache des Backends. Eine Preset-Änderung wirkt nur auf künftig erzeugte Varianten, Bestand ändert sich allein durch ausdrückliche Regenerierung. Ein Preset, das ein Original nicht verkleinern würde, erzeugt keine Variante.
_Avoid_: Größe/Bildgröße (unqualifiziert), Variante (das ist die erzeugte Datei, nicht die Vorschrift)

**Titelbild (eines Bookables)**:
Die erste Referenz in der Bilderliste eines Bookables — durch die Position bestimmt, nie ein eigenes Feld: Umsortieren der Liste wechselt das Titelbild, eine leere Liste heißt „kein Titelbild". Events haben stattdessen ihr eigens gepflegtes Teaser-Bild.
_Avoid_: Hauptbild, Cover, imgUrl (Alt-Feldname)

**Sichtbarkeit (eines Mediums)**:
Die zweistufige Lese-Einstufung eines Mediums: _public_ (für jedermann lesbar, anonym und cachebar) oder _intern_ (nur für Angehörige des Tenants). Regelt ausschließlich das Lesen — wer ein Medium auswählen, ändern oder löschen darf, bestimmen die Medien-Rechte der Rolle. Für Buchungsdokumente bedeutungslos: deren Zugriff folgt allein aus der Buchungs-Verknüpfung.
_Avoid_: protected (das ist der Alt-Pfad im Storage), accessLevel (Alt-Feldname), eingeschränkt (als dritte Stufe — gibt es nicht)

**Buchungsdokument**:
Ein Dokument-Medium mit Verknüpfung zu einer Buchung — allein diese Verknüpfung zeichnet es aus, es gibt keine eigene Dateiart. Erscheint nicht im Mediathek-Picker; lesbar nur für Buchungs-Berechtigte und den Eigentümer der Buchung.
_Avoid_: Rechnung (als Oberbegriff — Rechnungen sind eine Sorte Buchungsdokument), Invoice-File

**Instanz-Medium**:
Ein Medium ohne Tenant-Zuordnung — instanzweite Inhalte wie Branding und Rechts-Dokumente. Gleiches Datenmodell, keine eigene Entität; _intern_ bedeutet hier „jeder angemeldete Nutzer der Instanz" (es gibt keinen Tenant, dessen Angehörigkeit zählen könnte). Strikt von Tenant-Kontexten getrennt: Instanz-Medien sind nur in Instanz-Kontexten referenzierbar und erscheinen nie in Tenant-Pickern — wer ein Instanz-Bild im Tenant nutzen will, lädt es dort neu hoch. Verwaltet allein vom Instance-Owner.
_Avoid_: globale Datei, Instanz-Datei (das meint den Alt-Bestand der tenant-losen File-Endpoints)

**Storage-Ort (eines Mediums)**:
Der am Medium gespeicherte Ablageort seiner Bytes: ein Provider für das ganze Medium plus je ein Schlüssel für Original und jede Variante. Jedes Lesen folgt dem Storage-Ort des Mediums; die Instanz-Konfiguration bestimmt nur, wohin neue Uploads gehen. Ein Medium wandert nur als Ganzes zu einem anderen Provider, und nachträglich erzeugte Varianten entstehen beim Provider des Mediums, nie beim konfigurierten.
_Avoid_: Storage-Provider (unqualifiziert — das ist die Instanz-Konfiguration), Pfad, URL (das ist die Auslieferungs-Adresse)

**Alt-Pfad (eines Mediums)**:
Der beim Import festgehaltene Speicherpfad der Alt-Welt (public/protected-Baum), über den die dauerhaft bestehende Alt-Route ein Medium auflöst — hostunabhängig, weil gespeicherte Alt-URLs den Host ihrer Upload-Umgebung eingebacken haben. Nur importierte Medien tragen ihn; neu hochgeladene nie.
_Avoid_: legacyPath (als Sprechbegriff — das ist der Feldname), Legacy-URL (das ist die ganze gespeicherte Adresse, nicht der Pfad)

**Verwendungsnachweis (eines Mediums)**:
Die Liste der Verwendungsstellen, die ein Medium referenzieren — stets on-demand durch Suche über die Referenz-Stellen ermittelt, nie als Rückreferenz am Medium gespeichert. Grundlage sowohl der Anzeige „Wird verwendet in …" als auch der Lösch-Blockade: ein Medium mit Verwendungsnachweis ist nicht löschbar. Löschen ist endgültig — es gibt keinen Papierkorb.
_Avoid_: usedBy (als Feld — existiert nicht), Rückreferenz, Usage-Index

### Zugang

**AccessPoint**:
Ein physischer Zugangspunkt (Tür oder Schließfach), den die Plattform über einen Provider (z.B. NUKI, Salto) öffnen und schließen kann.
_Avoid_: Tür (als Entity-Name), Door, Schloss, Lock

**Standort**:
Die optionale physische Verortung eines AccessPoints — Koordinaten, wahlweise ergänzt um eine Adresse. Kein eigenständiges Aggregat.
_Avoid_: Location (als Entity), Site

**Scan-Code**:
Ein opaker, rotierbarer Zufallswert eines AccessPoints, der in der QR-URL an der Tür steckt und beim Scan server-seitig zum AccessPoint aufgelöst wird. Rotation macht alle zuvor gedruckten Codes ungültig.
_Avoid_: Token, QR-ID

**Evidence**:
Ein vom Client beim Öffnen mitgelieferter Nachweis (z.B. QR-Scan, Geoposition), den der Server gegen die konfigurierten Validierungsregeln eines AccessPoints prüft.
_Avoid_: Proof, Beweis

**Zugriffsrolle**:
Die Eigenschaft, in der jemand einen AccessPoint bedient: als _Buchender_, wenn die Buchung ihm gehört oder ihm zugewiesen ist, sonst als _Verwaltung_. Hängt an der Buchung, nicht an der Person und nicht am benutzten Frontend — dieselbe Person ist bei ihrer eigenen Buchung Buchender und bei einer fremden Verwaltung. Ohne Buchung gibt es keine Zugriffsrolle: ein aufgelöster Scan-Code allein bestimmt sie nicht.
_Avoid_: Herkunft, Origin, Surface, Kanal (das ist etwas anderes), Rolle (das sind die Rechte)

**Evidence-Bypass**:
Das Übergehen der Validierungsregeln eines AccessPoints. Steht ausschließlich der Zugriffsrolle _Verwaltung_ zu, weil dort niemand an der Tür steht, der etwas nachweisen könnte; wer als Buchender öffnet, erbringt Evidence wie jeder andere Nutzer. Nicht zu verwechseln mit der davon getrennten Fähigkeit, fremde Buchungen überhaupt zu erreichen.
_Avoid_: Admin-Override, Skip, Bypass (unqualifiziert — es gibt zwei)

**Kanal (eines Öffnungsvorgangs)**:
Wie ein Öffnen ausgelöst wurde — per Scan an der Tür oder aus der Ferne. Selbstauskunft des Clients, rein beschreibend für das Audit und nie Teil der Zugangsentscheidung. Wer eine Entscheidung binden will, nimmt die Zugriffsrolle.
_Avoid_: Herkunft, Origin, Surface

**Validierungsregel**:
Eine pro AccessPoint konfigurierte Evidence-Anforderung, die der Server beim Öffnen zusätzlich zu den festen Buchungsprüfungen auswertet (z.B. QR-Scan). Alle konfigurierten Regeln eines AccessPoints müssen erfüllt sein.
_Avoid_: Validation Rule, Policy, Check

**Scan-Landing-Page**:
Die Frontend-Seite, die sich öffnet, wenn ein Nutzer den QR-Code an einem AccessPoint scannt; sie führt durch Login, Berechtigungsprüfung und Öffnen.

**Tenant-Owner**:
Ein Nutzer, dessen Membership im Mandanten als Owner markiert ist; umgeht alle rollenbasierten Rechteprüfungen des Mandanten und trägt exklusiv die Schreibrechte an AccessPoints (Anlage, Bearbeitung, QR-Druck, Rotation).
_Avoid_: Mandanten-Besitzer, Tenant-Admin

**Projektion (eines AccessPoints)**:
Die eine Form, in der ein AccessPoint nach außen geht — für die Türen einer Buchung wie für einen aufgelösten Scan-Code. Alles, was nur der Server braucht (Provider-Konfiguration, externe IDs, Scan-Codes), bleibt drin.
_Avoid_: DTO, View-Model, Payload (als Entity-Name)

**Capability (eines AccessPoints)**:
Eine Aktion, die ein Client an diesem AccessPoint anbieten darf: `open`, `close`, `getStatus`. Gefiltert aus dem, was die Provider-Klasse deklariert — der Provider selbst ist nie Grund zu verzweigen.
_Avoid_: Feature, Fähigkeit, Provider-Capability (das sind die Deklarationen der Provider-Klasse, nicht die des AccessPoints)

**Salto-Guest**:
Ein Site-User bei Salto KS mit Rolle `site_guest`, den die Plattform pro Buchung anlegt: ohne E-Mail, ohne Einladung, nur mit technischem Alias (`Booking <id> – <Bookable>`) und Ablaufzeitpunkt. Trägt den Salto-generierten PIN einer Buchung; wird beim Revoke aktiv gelöscht, `expires_at` ist nur Sicherheitsnetz. Keine Personendaten des Gastes.
_Avoid_: Salto-User (der Begriff meint auch Admins), Nutzer pro Buchung, Gastkonto

**Access Group (eines AccessPoints)**:
Die von der Plattform angelegte und besessene Salto-Access-Group, die ein Salto-Lock mit seinen Salto-Guests verbindet — eine je AccessPoint, lazy beim ersten Grant erzeugt, ID am AccessPoint gespeichert. Ein Override auf eine bestehende Salto-Gruppe ist denkbar, aber nicht Teil des ersten Schritts.
_Avoid_: Berechtigungsgruppe, Zutrittsgruppe

**Just-in-time-Grant**:
Die Provisionierung einer Berechtigung erst zu Zugangsbeginn (`accessFrom`) durch einen Job — nicht bei Buchungsbestätigung. Nötig, weil Salto KS für Guest und PIN nur ein Ende kennt, keinen Start. Scheitert der Grant, bleibt die Buchung bestehen; die Provisionierung wird als Failure protokolliert, der Admin benachrichtigt und der Job wiederholt.
_Avoid_: Scheduled Provisioning, Vorab-Provisionierung

**Salto-Umgebung**:
Die Wahl `accept` oder `production` in der Salto-Konfiguration eines Tenants. API-Host und Identity-Server ergeben sich daraus; sie sind Salto-Fakten, keine Tenant-Eingaben.
_Avoid_: apiBaseUrl (als Konfig-Feld), Freitext-URL

**Salto-OTP**:
Der zeitbasierte Einmalcode (Saltos „ClayCode"), den Salto KS für Remote-Open an einem IQ mit `otp_enabled` verlangt und den die Plattform selbst berechnet: erste 5 Zeichen von `MD5(UTC "YYYYmmDDHHMMSS" + IQ-Secret + IQ-PIN)`, 3 Minuten gültig, innerhalb des Fensters mehrfach nutzbar (Formel am Türbeweis 2026-08-25 belegt). Nie von einem Menschen eingegeben, nie von Salto zugeschickt. Einmal eingeschaltetes `otp_enabled` ist irreversibel; nur IQs ohne `otp_enabled` brauchen keinen OTP. Nach abgelehntem OTP kein neu berechneter Retry (Gefahr `otp_blocked`, ~20 min Account-Sperre) — maximal ein OTP pro Öffnungsversuch. Nicht zu verwechseln mit dem Keypad-PIN eines Salto-Guests.
_Avoid_: TOTP, SMS-Code, PIN (unqualifiziert), Einmalpasswort

**IQ-Aktivierung**:
Der einmalige, rein API-seitige Vorgang pro IQ, mit dem der System-User des Tenants seine beiden OTP-Zutaten erhält und am IQ aktiviert wird: das IQ-Secret (first secret per `GET …/iqs/{id}/secret` ohne OTP, nur solange der User nie aktiviert war), die IQ-PIN (per `GET …/iqs/{id}/pin?send_email=true` an das Postfach des System-Users gemailt, einmal im Admin-UI erfasst), dann die Aktivierung selbst per `PUT …/iqs/{id}/pin {otp, delta: "0000"}` — die PIN bleibt die gemailte, das Secret überlebt. Läuft im Admin-UI an der Salto-Verbindung, nicht am AccessPoint. Die Salto-App ist für den System-User tabu: eine App-Aktivierung rotiert das Secret weg und macht die gespeicherten Zutaten still ungültig (ADR 0002). Neu nötig nach IQ-Reset oder -Tausch. Ein Salto-AccessPoint an einem nicht aktivierten IQ mit `otp_enabled` kann nicht remote geöffnet werden.
_Avoid_: OTP-Einrichtung, Remote-Freischaltung, IQ-Setup, App-Aktivierung (verboten für den System-User)

**Berechtigungsweg (eines Salto-AccessPoints)**:
Ob ein Gast per Salto-Guest-PIN am Keypad, per Remote-Open aus der Mobile-Key-Seite oder mit beidem hineinkommt. Ergibt sich aus dem Schlosstyp: nur Keypad-Schlösser kennen den PIN-Weg, Remote-Open steht jeder online am IQ hängenden Tür offen. Beim Remote-Open provisioniert die Plattform bei Salto nichts — die Buchung ist die Berechtigung, der System-User öffnet.
_Avoid_: Zugangsart, Öffnungsart, Modus (das ist die Admin-Einstellung `remote | authorization | both`, die den Berechtigungsweg wählt)
