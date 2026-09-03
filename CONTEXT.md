# Smart City Booking Backend

Multi-Tenant-Backend für die Buchung kommunaler Ressourcen (Räume, Flächen, Geräte) inklusive Zahlungsabwicklung und physischem Zugang (Türschlösser, Schließfächer).

## Language

### Custom Fields

**Mail-Sichtbarkeit (eines Custom Fields)**:
Die pro Feld-Definition getroffene Wahl, ob der im Checkout eingegebene Wert im Buchungsdetails-Block aller Buchungs-Mails erscheint — für alle Empfänger gleich, Kunde wie Betreiber. Nur Checkout-Felder können sie tragen; ein leeres Feld mit Mail-Sichtbarkeit erscheint als „nicht angegeben", es fällt nicht weg.
_Avoid_: mailAttach (das sind Datei-Anhänge), Mail-Flag, showInMail (als Sprechbegriff — das ist der Feldname)

### Checkout

**Checkout-Policy (einer Buchung)**:
Die Regel-Lage, unter der eine Buchung entsteht oder geändert wird — _Selbstbuchung_ oder _manuelle Buchung_. Hängt am Vorgang, nicht an der Person; genau ein Wert überquert die Checkout-Schnittstelle, und was er bedeutet, entscheidet allein das Checkout-Modul — nie der Aufrufer durch Flag-Kombinationen.
_Avoid_: manualBooking (Alt-Flag), capacityChecksOnly (Fehlbezeichnung — es gab nie eine Nur-Kapazität-Prüfung), Buchungsmodus, Admin-Flag

**Selbstbuchung**:
Die Checkout-Policy des Storefront-Wegs: alle Buchbarkeits-Prüfungen laufen, automatische Rabatte und Pflicht-Addons werden angewendet. Ein Buchender kann auf seinen eigenen automatischen Rabatt verzichten — mehr Einfluss auf die Policy hat ein Client nicht.
_Avoid_: normale Buchung, Kundenbuchung

**Manuelle Buchung**:
Die Checkout-Policy, bei der die Angaben des Erfassenden autoritativ sind: keine Buchbarkeits-Prüfungen, keine automatischen Rabatte, keine automatisch ergänzten Pflicht-Addons, eingegebene Preise gelten, die Rechnungsberechtigung wird nicht geprüft. Jede Buchungs-Änderung ist eine manuelle Buchung — auch die des Eigentümers an der eigenen Buchung.
_Avoid_: Admin-Buchung (auch Eigentümer-Updates sind manuell), Buchung ohne Prüfung

**Manueller Preis (eines Buchungs-Items)**:
Der vom Erfassenden ausdrücklich festgelegte Netto-Stückpreis eines Items einer manuellen Buchung. Ersetzt den Preis, der sich sonst aus Preiskategorien oder externen Anbietern ergäbe; Mehrwertsteuer, Stückzahl und Coupons gelten weiterhin. Bleibt am Item, bis er ausdrücklich entfernt wird — ein Verschieben der Buchung rechnet ihn nicht neu. Nur unter der Checkout-Policy _manuelle Buchung_ wirksam; in einer Selbstbuchung wird er verworfen, nie gespeichert.
_Avoid_: Preisüberschreibung (technischer Jargon), Fixpreis (das ist die Eigenschaft einer Preiskategorie), Kategorie-Trick (der Alt-Weg über manipulierte Preiskategorien)

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
Ein Dokument-Medium mit Verknüpfung zu einer oder mehreren Buchungen — allein diese Verknüpfung zeichnet es aus, es gibt keine eigene Dateiart. Ein aggregierter Beleg ist ein einziges Medium, das alle zugehörigen Buchungen verknüpft — nie eine Kopie je Buchung. Erscheint nicht im Mediathek-Picker; lesbar, wer mindestens eine der verknüpften Buchungen sehen darf (Berechtigte wie Eigentümer). Verliert eine gelöschte Buchung als Verknüpfung und verschwindet mit der letzten — ein Buchungsdokument ohne Buchung gibt es nicht.
_Avoid_: Rechnung (als Oberbegriff — Rechnungen sind eine Sorte Buchungsdokument), Invoice-File, Sammelbeleg-Kopie (aggregierte Belege sind ein Medium, keine Kopien)

**Instanz-Medium**:
Ein Medium ohne Tenant-Zuordnung — instanzweite Inhalte wie Branding und Rechts-Dokumente. Gleiches Datenmodell, keine eigene Entität; _intern_ bedeutet hier „jeder angemeldete Nutzer der Instanz" (es gibt keinen Tenant, dessen Angehörigkeit zählen könnte). Strikt von Tenant-Kontexten getrennt: Instanz-Medien sind nur in Instanz-Kontexten referenzierbar und erscheinen nie in Tenant-Pickern — wer ein Instanz-Bild im Tenant nutzen will, lädt es dort neu hoch. Verwaltet allein vom Instance-Owner.
_Avoid_: globale Datei, Instanz-Datei (das meint den Alt-Bestand der tenant-losen File-Endpoints)

**Storage-Ort (eines Mediums)**:
Der am Medium gespeicherte Ablageort seiner Bytes: ein Provider für das ganze Medium plus je ein Schlüssel für Original und jede Variante. Jedes Lesen folgt dem Storage-Ort des Mediums; die Instanz-Konfiguration bestimmt nur, wohin neue Uploads gehen. Ein Medium wandert nur als Ganzes zu einem anderen Provider, und nachträglich erzeugte Varianten entstehen beim Provider des Mediums, nie beim konfigurierten.
_Avoid_: Storage-Provider (unqualifiziert — das ist die Instanz-Konfiguration), Pfad, URL (das ist die Auslieferungs-Adresse)

**Alt-Pfad (eines Mediums)**:
Der beim Import festgehaltene Speicherpfad der Alt-Welt (public/protected-Baum), über den die dauerhaft bestehende Alt-Route ein Medium auflöst — hostunabhängig, weil gespeicherte Alt-URLs den Host ihrer Upload-Umgebung eingebacken haben. Nur importierte Medien tragen ihn; neu hochgeladene nie. Pro Tenant eindeutig: jede Alt-Datei wird genau ein Medium — auch wenn dieselben Bytes an mehreren Alt-Pfaden liegen, bleibt jeder Fundort sein eigenes Medium (Identität zählt, nicht Inhalt).
_Avoid_: legacyPath (als Sprechbegriff — das ist der Feldname), Legacy-URL (das ist die ganze gespeicherte Adresse, nicht der Pfad)

**Verwendungsnachweis (eines Mediums)**:
Die Liste der Verwendungsstellen, die ein Medium referenzieren — stets on-demand durch Suche über die Referenz-Stellen ermittelt, nie als Rückreferenz am Medium gespeichert. Grundlage sowohl der Anzeige „Wird verwendet in …" als auch der Lösch-Blockade: ein Medium mit Verwendungsnachweis ist nicht löschbar. Löschen ist endgültig — es gibt keinen Papierkorb.
_Avoid_: usedBy (als Feld — existiert nicht), Rückreferenz, Usage-Index

### Zugang

**AccessPoint**:
Ein physischer Zugangspunkt, den die Plattform über einen Provider (z.B. NUKI, Salto, iFBS, Pareva) einer Buchung zuordnet: eine Tür (geteilt, fest konfiguriert) oder eine Schließfachanlage (exklusiv, je Buchung ein Fach zugeteilt). Ein AccessPoint ohne Bedien-Capability ist zulässig — die Plattform muss ihn nicht öffnen können.
_Avoid_: Tür (als Entity-Name), Door, Schloss, Lock, Locker

**Schließfachanlage**:
Ein AccessPoint, dessen Provider je Buchung ein Fach zuteilt: bei iFBS ein Standort mit Fahrradboxen (genau ein Fach je Buchung, iFBS wählt es), bei Pareva ein Produkt einer Schließfachanlage (mehrere Fächer je Buchung, Pareva gibt den Zugangscode selbst an den Buchenden). Die Plattform kennt vor der Buchung nur die Anlage, nie das Fach. Kapazität ist Sache des Bookables, nicht der Anlage.
_Avoid_: Locker, Locker-Unit, Location (als Entity), Schließfach (unqualifiziert — das ist das Fach)

**Fach**:
Das einer Buchung zugeteilte Abteil einer Schließfachanlage. Lebt im Grant der Buchung für die Anlage; bei iFBS trägt es die Boxnummer, an der der Buchende seine Box erkennt.
_Avoid_: Box (als Begriff — iFBS-Jargon), Unit, Locker

**Vormerkung**:
Der Anspruch einer noch unbezahlten Buchung auf ein Fach, vor dem Grant. Wird vom Provider gehalten (iFBS, befristet und erneuerbar) oder von der Plattform (Pareva, durch die gespeicherte Buchung selbst). Scheitert die Vormerkung im Checkout, entsteht die Buchung nicht; scheitert der Grant nach der Zahlung, bleibt die Buchung und der Fall geht an die Verwaltung.
_Avoid_: Hold (als Sprechbegriff), Pre-Reservation, Reservierung (das ist die Buchung)

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

**Zugangsentscheidung**:
Die eine Antwort auf „Darf diese Person die AccessPoints dieser Buchung jetzt bedienen?“: die Zugriffsrolle, welche AccessPoints bedienbar und welche davon aus der Ferne zu öffnen sind, die priorisierten Gründe dagegen und was je AccessPoint an Evidence verlangt wird. Wird aus Buchung, AccessPoints und Zeitpunkt berechnet, nie aus dem Kanal. Die Evidence-Prüfung ist ihr zweiter Schritt, kein eigener Begriff.
_Avoid_: Eligibility (Altname der HTTP-Form), Berechtigungsprüfung, Access-Check

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
Eine Aktion, die ein Client an diesem AccessPoint anbieten darf: `open`, `close`, `getStatus`. Gefiltert aus dem, was die Provider-Klasse deklariert — der Provider selbst ist nie Grund zu verzweigen. Kann leer sein (eine Pareva-Schließfachanlage).
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

**Öffnungsergebnis**:
Die Antwort eines Providers auf ein Öffnen: entweder sofort geöffnet oder ausstehend mit einem Öffnungsvorgang, dessen Fortschritt nachgefragt wird. Kennt keine weiteren Zustände.
_Avoid_: Open-Result, Status (das ist der Schlosszustand), Provider-Antwort

**Öffnungsvorgang**:
Das Handle eines ausstehenden Öffnens, über das der Öffnungsfortschritt erfragt wird. Nur Provider, die asynchron öffnen (Schließfächer), erzeugen einen.
_Avoid_: Process, Box-ID, Booking-ID (des Providers)

**Öffnungsfortschritt**:
Der Stand eines Öffnungsvorgangs: bestätigt, fehlgeschlagen mit Fehlercode, oder noch offen.
_Avoid_: Open-Status, Polling-Antwort

**Schlosszustand**:
Was ein Schloss über sich selbst sagt, in drei voneinander unabhängigen Antworten: offen, verriegelt, Tür offen — jede auch „unbekannt". Batterie, Alarme und Nutzungsfenster gehören nicht dazu.
_Avoid_: Lock-State, State, Status (unqualifiziert), Zustand (unqualifiziert)

**Grant**:
Die beim Provider angelegte Berechtigung einer Buchung für einen AccessPoint: ein Handle, optional ein externer Principal und optional ein Einweg-Geheimnis (der PIN, der einmalig per Mail hinausgeht). Wird an der Buchung gespeichert und beim Widerruf zurückgegeben; provider-spezifische Namen tauchen darin nie auf.
_Avoid_: Berechtigung (unqualifiziert), Autorisierung, Provisionierung (das ist der Vorgang, der einen Grant erzeugt), Access

**Externer Principal (eines Grants)**:
Das Subjekt, das der Provider für einen Grant führt und das mit dem Grant wieder verschwinden muss. Der Salto-Guest ist der externe Principal eines Salto-Grants; ein NUKI-Grant hat keinen.
_Avoid_: Salto-User (unqualifiziert), Nutzer, Account

**Widerruf (eines Grants)**:
Das Zurücknehmen eines Grants beim Provider, mit der Auskunft, ob der externe Principal dabei entfernt wurde. Ein wiederholter Widerruf desselben Grants ist erlaubt und holt nur nach, was fehlt.
_Avoid_: Revoke (als deutsches Nomen), Löschung, Deprovisionierung

### Buchungslebenszyklus

**Buchungszustand**:
Der eine gespeicherte Wert, der sagt, wo eine Buchung in ihrem Leben steht: _angefragt_ (noch nicht bestätigt), _Zahlung offen_ (bestätigt, Preis größer null, unbezahlt), _bestätigt_ (bestätigt und bezahlt, oder bestätigt und kostenlos), _abgelehnt_ (aus „angefragt" heraus storniert) oder _storniert_ (aus „Zahlung offen" oder „bestätigt" heraus storniert). „Bezahlt, aber nicht bestätigt" gibt es nicht. Die drei Flags bestätigt/bezahlt/storniert sind Ableitungen des Zustands, nie seine Quelle.
_Avoid_: isCommitted/isPayed/isRejected (als Sprechbegriffe — das sind die abgeleiteten Flags), Status-Key (das ist die Frontend-Übersetzung), Buchungsstatus (unqualifiziert)

**Lebenszyklus-Übergang**:
Ein benannter Wechsel des Buchungszustands mit seinen Effekten: Aufnahme, Bestätigung, Zahlung, Storno, Wiederherstellung, Änderung und Stornoanfrage. Welcher Übergang aus welchem Zustand erlaubt ist, steht in einer Tabelle; alles andere ist ein Fehler, keine stille Annahme. Ein Übergang gilt immer einer Buchung; eine Gruppenbuchung durchläuft ihre Übergänge als eigener Lebenszyklus über den Übergängen ihrer Mitglieder.
_Avoid_: Aktion, Statuswechsel, Flag setzen, Übergang (unqualifiziert)

**Effekt (eines Übergangs)**:
Eine beobachtbare Nebenwirkung, die ein Lebenszyklus-Übergang auslöst: Vormerkung oder Grant an AccessPoints, ein Buchungsdokument, eine Mail, ein Workflow-Ereignis. Effekte gehören zum Übergang, nie zum Aufrufer; welche laufen und was bei ihrem Scheitern passiert, entscheidet allein der Lebenszyklus.
_Avoid_: Side-Effect, Hook (das ist das Workflow-Ereignis bzw. die Stornoanfrage), Nachbearbeitung

**Auslöser (eines Übergangs)**:
Wer einen Lebenszyklus-Übergang veranlasst hat: _Buchender_, _Verwaltung_, _Zahlung_ (ein Zahlungsanbieter), _Workflow_ (eine Workflow-Aktion) oder _System_. Ein Wert am Übergang, der z.B. die Erstattungsregel des Stornos wählt und Workflow-Schleifen verhindert. Nicht zu verwechseln mit der Zugriffsrolle, die sich auf das Bedienen von AccessPoints bezieht.
_Avoid_: Origin (Altname im Storno), skipWorkflow (das ist die Alt-Kodierung für „Auslöser Workflow"), Herkunft

**Aufnahme (einer Buchung)**:
Der erste Lebenszyklus-Übergang: eine vom Checkout gespeicherte Buchung wird in den Lebenszyklus aufgenommen, mit den Effekten des Zustands, in dem sie ankommt. Der Checkout entscheidet den Anfangszustand (angefragt, Zahlung offen oder bestätigt) und endet mit dem Speichern; bricht die Aufnahme ab, entsteht die Buchung nicht.
_Avoid_: Create (als Übergangsname), Anlegen, Checkout (das ist der Vorgang davor)

**Stornoanfrage**:
Der vom Buchenden geäußerte Wunsch, eine Buchung zu stornieren, der erst mit seiner Bestätigung zum Storno wird. Ein offener Vorgang an einem Buchungszustand, kein eigener Zustand: die Buchung bleibt währenddessen gültig. Nur möglich, wenn die Stornierungsregel der Buchung sie zulässt.
_Avoid_: Reject-Hook (das ist die Speicherform), Kündigung, Stornierung (das ist der Übergang danach)

**Wiederherstellung (einer Buchung)**:
Der Lebenszyklus-Übergang, der eine abgelehnte oder stornierte Buchung in den Zustand zurückholt, den sie vor dem Storno hatte, mit Preis und Positionen von damals; die Erstattung fällt weg, der Zugang wird neu gewährt. Der Zustand vor dem Storno wird beim Storno festgehalten.
_Avoid_: Unreject, Reaktivierung, Rücknahme des Stornos (das ist die Handlung, nicht der Übergang)

**Änderung (einer Buchung)**:
Der Lebenszyklus-Übergang, der den Inhalt einer Buchung ändert — Zeiten, Positionen, Kontaktdaten, Preis —, ohne ihren Zustand zu wechseln: die neue Buchung wird im Zustand der gespeicherten geschrieben, und der Zugang folgt dem Inhalt (bei _bestätigt_ verschoben, bei _angefragt_ oder _Zahlung offen_ neu vorgemerkt). Der Admin-PUT ist ein Plan: erst die Änderung, dann die Übergänge, die die Flags verlangen, jeder für sich und ohne Rücknahme über Übergangsgrenzen.
_Avoid_: Update (als Übergangsname), Bearbeiten, Flag-Kombination speichern

**Gruppenzustand**:
Der Buchungszustand, den alle Mitglieder einer Gruppenbuchung teilen; die Gruppe selbst hat keinen eigenen. Ein Lebenszyklus-Übergang der Gruppe verlangt ihn als Voraussetzung: stehen Mitglieder in verschiedenen Zuständen, findet der Übergang nicht statt und nennt die abweichenden Mitglieder. Der Übergang schreibt und versorgt jedes Mitglied für sich, stellt aber ein Buchungsdokument und eine Mitteilung für die Gruppe aus; scheitert das Schreiben bei einem Mitglied, werden die davor geschriebenen zurückgenommen.
_Avoid_: Gruppenstatus (als gespeicherter Wert — den gibt es nicht), allCommitted/allPaid (das sind Ableitungen über die Flags), Sammelstatus

**Fehlerpolitik (eines Effekts)**:
Was ein gescheiterter Effekt mit seinem Lebenszyklus-Übergang macht: _abbrechen_ (der Übergang findet nicht statt, schon Geschriebenes wird zurückgenommen) oder _protokollieren_ (der Übergang gilt, der Fehler steht im Ergebnis und im Log). Am Effekt festgelegt, für jeden Übergang gleich, nie vom Aufrufer gewählt. Nur das Speichern und die Vormerkung brechen ab; Zugang, Dokument und Mitteilungen werden protokolliert.
_Avoid_: onFailure (als Sprechbegriff), Verschlucken, Rollback (das ist die Handlung beim Abbrechen, nicht die Politik), Retry (gibt es nicht)

**Ausstellung (eines Buchungsdokuments)**:
Der eine Vorgang, in dem ein Buchungsdokument entsteht: Nummer ziehen, erzeugen, ablegen und an alle zugehörigen Buchungen anhängen. Eine Dokumentnummer ohne Anhang gibt es nicht; eine Nummer, die durch einen Fehler beim Erzeugen verloren geht, ist eine erklärte Lücke, keine Doppelvergabe. Die Ausstellung versendet nichts — die Mail ist eine Mitteilung des Übergangs oder der Verwaltung.
_Avoid_: Issuance (als deutsches Nomen), Erzeugen (das ist nur das Rendern), Belegerstellung (unqualifiziert)

**Revision (eines Buchungsdokuments)**:
Eine erneute Ausstellung eines Buchungsdokuments unter derselben Dokumentnummer, fortlaufend gezählt. Ein Nachdruck durch die Verwaltung ist eine Revision, keine Kopie: er entsteht als neues Medium mit derselben Nummer.
_Avoid_: Nachdruck (als Modellbegriff — das ist die Handlung), Reprint, Belegkopie, Duplikat

**Zahlungsaufforderung**:
Die eine Mitteilung, mit der der Mandant den Buchenden zur Zahlung einer Buchung in „Zahlung offen" auffordert. Ihre Form bestimmt der Zahlungsanbieter des Mandanten: ein Zahlungslink, eine ausgestellte Rechnung oder die Ankündigung einer später erstellten Rechnung. Eine Mitteilung, kein Zustand: scheitert sie, bleibt die Buchung in „Zahlung offen". Bucht der Buchende selbst, ist die Antwort des Checkouts – die Zahlungsseite, auf die er weitergeleitet wird – seine Zahlungsaufforderung; die Aufnahme sendet dann keine zweite.
_Avoid_: paymentRequest (als Sprechbegriff), Rechnungsversand (das ist nur eine der drei Formen), Zahlungserinnerung (das gibt es nicht)

**Löschung (einer Buchung)**:
Das harte Entfernen einer Buchung durch die Verwaltung — kein Lebenszyklus-Übergang, denn eine gelöschte Buchung hat keinen Zustand mehr. Läuft über dieselbe Naht wie die Übergänge: der Zugang wird zurückgenommen, die Buchungsdokumente werden entfernt (ein Dokument, das seine Buchung überlebt, könnte niemand mehr erreichen), dann die Buchung. Nicht zu verwechseln mit dem Storno, das die Buchung im Zustand „storniert" behält.
_Avoid_: Delete (als Sprechbegriff), Storno (das ist der Übergang), Entfernen (unqualifiziert)
