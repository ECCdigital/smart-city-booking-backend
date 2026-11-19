# Issue-Tracker: GitHub Portolan, Produkt-Repo

Erzeugt vom Setup der Skills (`/setup-matt-pocock-skills`, Vorlage „GitHub Portolan, Produkt-Repo“), Stand `ecc-12`. Nicht von Hand ändern: Die Vorlage liegt im Fork `ECCdigital/skills`. Nach einem neuen Stand führst du das Setup neu aus.

Dieses Repo enthält Code eines Produkts. Die Tickets dazu liegen nicht hier, sondern als Issues in `ECCdigital/tickets`, zusammen mit Anforderungen, Karten und Klärungen. Issues dieses Repos sind keine Tickets.

- Jeder `gh`-Befehl an Tickets bekommt `-R ECCdigital/tickets`. Ohne ihn meint `gh` dieses Repo.
- Eine Nummer wie `#42`, `ECCdigital/tickets#42` oder die URL `https://github.com/ECCdigital/tickets/issues/42` meint ein Issue in `ECCdigital/tickets`.
- Die Begriffe der Arbeitsweise (Ticket, Zustand, Definition of Ready, Board) stehen in `GLOSSARY.md` von `ECCdigital/tickets`: `gh api repos/ECCdigital/tickets/contents/GLOSSARY.md -H "Accept: application/vnd.github.raw"`.
- Der **Ablauf** ist der Schalter `ablauf` der Einstellungs-Datei von `ECCdigital/tickets`: `gh api repos/ECCdigital/tickets/contents/einstellungen.json -H "Accept: application/vnd.github.raw" --jq '.ablauf // "v1"'` gibt `v1` oder `v2` aus, ohne Eintrag gilt `v1`. Nennt die Repo-Variable `EINSTELLUNGEN` eine andere Datei (`gh variable get EINSTELLUNGEN -R ECCdigital/tickets`), liest du diese statt `einstellungen.json`. Fehlt `EINSTELLUNGEN`, gilt noch die alte Repo-Variable `ZUORDNUNG`, solange sie gesetzt ist. Unter-Tickets gibt es nur mit Ablauf `v2`. Mit `v1` hat jedes Ticket seinen eigenen Zustand im Board, wie bisher.

## Ein Ticket

- Ein Ticket ist ein Issue in `ECCdigital/tickets` mit Issue Type Fehler, Feature oder Aufgabe. Ohne Typ ist es eine Anforderung, eine Karte oder eine Klärung.
- **Lesen**: `gh issue view <n> -R ECCdigital/tickets --comments`. Typ, Assignees und Zustand: `gh issue view <n> -R ECCdigital/tickets --json state,issueType,assignees,projectItems`. Der Zustand ist `status.name` des Eintrags im Board.
- **Vorgabe** ist der Abschnitt `## Definition of Ready` im Ticket-Text, dazu „Was entsteht“ und die Herkunft (Karte und Spec), wenn es sie gibt:
  - Fehler: Schritte zum Reproduzieren und erwartetes Verhalten.
  - Feature: Ziel in einem Satz und Akzeptanzkriterien.
  - Aufgabe: Ergebnis in einem Satz.
  - Mit Ablauf `v2` dazu die erweiterte Form: **Testfälle**, **Seams und Schnittstellen**, **Nicht-Ziele**, **Prüfung von Ende zu Ende**, **Betroffene Repos**, **Vorbild im Code** und **Weg** (`Agent` oder `lokal`). Die Testfälle schreibst du als Tests, die Seams sind ihr Ort, die Nicht-Ziele baust du nicht, und das Vorbild zeigt, wie es hier gemacht wird.
- **Zustände** im Board, Feld Status: mit Ablauf `v1` Eingang, Backlog, Bereit, In Arbeit, Review, Erledigt, Verworfen. Mit Ablauf `v2` Eingang, In Klärung, Wartet auf Freigabe, Backlog, Bereit, In Arbeit, Review, Erledigt, Verworfen.

## Board

Das Board ist das Org-Board, das die Repo-Variable `BOARD` von `ECCdigital/tickets` nennt: `gh variable get BOARD -R ECCdigital/tickets`. Im Text heißt die Nummer `<board>`. `gh` braucht dafür den Scope `project`. Scheitert ein Befehl daran, sagst du der Person: `gh auth refresh -s project`.

Einen Zustand setzt du mit `gh project`, jeden Befehl einzeln:

1. Item-Id: `gh project item-add <board> --owner ECCdigital --url https://github.com/ECCdigital/tickets/issues/<n> --format json --jq .id`. Steht das Ticket schon im Board, liefert das denselben Eintrag.
2. Projekt-Id: `gh project view <board> --owner ECCdigital --format json --jq .id`.
3. Feld-Id und Id des Zustands: `gh project field-list <board> --owner ECCdigital --format json --jq '.fields[] | select(.name == "Status") | {id, options: [.options[] | {id, name}]}'`.
4. Setzen: `gh project item-edit --id <item-id> --project-id <projekt-id> --field-id <feld-id> --single-select-option-id <zustand-id>`.
5. Prüfen: `gh issue view <n> -R ECCdigital/tickets --json projectItems`.

Du setzt nur das Feld Status, nur am Ticket, an dem du arbeitest, und nur „In Arbeit“ und „Review“. Mit Ablauf `v2` ist das an einem Unter-Ticket sein Haupteintrag, und dort nur „In Arbeit“. Bereit, Erledigt, Verworfen und alle anderen Felder setzt ein Mensch. `board.sh` gibt es hier nicht, du nimmst die Befehle oben.

**Unter-Ticket**, nur mit Ablauf `v2`: Ist das Ticket Sub-Issue eines Tickets, gibt `gh api repos/ECCdigital/tickets/issues/<n>/parent --jq '"\(.number) \(.type.name)"'` dessen Nummer und Typ aus, ohne übergeordnetes Issue endet der Aufruf mit 404. Ist der Typ nicht `null`, ist es ein Unter-Ticket: Es hat keinen Zustand und kommt nie ins Board. Du setzt dort keinen Zustand und nimmst es nicht auf (kein `item-add`). Den Zustand liest du an seinem Haupteintrag, der Nummer aus diesem Aufruf. Bereit am Haupteintrag gilt für alle seine Unter-Tickets. Review am Haupteintrag setzt die Auswertung, sobald das letzte Unter-Ticket geschlossen ist. Mit Ablauf `v1` prüfst du das nicht: Jedes Ticket ist ein eigener Eintrag im Board, auch wenn es Sub-Issue eines anderen Issues ist.

## Ein Ticket bearbeiten

Gilt für jede Session, die an einem Ticket arbeitet, etwa `/implement <URL des Tickets>`. Die Schritte ergänzen den Skill.

1. **Prüfen**: Lies das Ticket samt Zustand und den Ablauf.
   - Ohne Issue Type ist es kein Ticket. Sag das und ende.
   - Ist es geschlossen, Erledigt oder Verworfen, sag das und ende.
   - Steht es nicht auf Bereit, In Arbeit oder Review, oder fehlt die Definition of Ready oder ein Teil der erweiterten Form, sag das. Mit Ablauf `v2` gilt an einem Unter-Ticket (siehe „Board“) der Zustand seines Haupteintrags. Bereit setzt nur ein Mensch. Du machst nur weiter, wenn die Person es ausdrücklich will.
   - Ist eine andere Person Assignee, nenne sie und frag, bevor du weitermachst.
2. **Übernehmen**, als erste Schreibaktion:
   - Ohne Assignee: `gh issue edit <n> -R ECCdigital/tickets --add-assignee @me`.
   - Zustand „In Arbeit“, wie unter „Board“. Steht er schon dort, bleibt er. Mit Ablauf `v2` setzt du an einem Unter-Ticket dort keinen. Steht sein Haupteintrag auf Bereit, setzt du den Haupteintrag auf „In Arbeit“, wie unter „Board“ mit dessen Nummer. Steht er auf In Arbeit oder Review, bleibt er.
3. **Branch** `<n>-<stichwort>`: das Stichwort aus dem Titel, klein, mit Bindestrichen, ohne Umlaute, etwa `42-csv-export`. Bist du auf dem Standard-Branch, legst du ihn von dort an: `git switch -c <n>-<stichwort>`. Bist du schon auf einem Branch für dieses Ticket, bleibst du dort. Den Standard-Branch nennt `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`.
4. **Umsetzen** nach dem Skill, auf diesem Branch. Die Definition of Ready ist die Vorgabe.
   - Was sie nicht deckt oder was ihr widerspricht, fragst du nach.
   - Neue Arbeit, die sich zeigt, ist eine neue Anforderung. Du nennst sie. Will die Person sie anlegen, dann mit einer Zeile Titel, ohne Label, Typ und Assignee: `gh issue create -R ECCdigital/tickets --title "..." --body "..."`. Die Weiche in `ECCdigital/tickets` ordnet sie ein.
   - Mit Ablauf `v2` gilt an einem Unter-Ticket für Fehler: Verursacht oder verfehlt die Anforderung den Fehler, wird er ein neues Unter-Ticket ihres Haupteintrags, damit er vor Erledigt behoben wird. Du schlägst es vor. Will die Person es, legst du es mit Typ Fehler und Definition of Ready (Schritte zum Reproduzieren, erwartetes Verhalten, dazu die erweiterte Form samt Weg wie unter „Vorgabe“) an und hängst es an: `gh api repos/ECCdigital/tickets/issues -f title="..." -F body=@<datei> -f type=Fehler --jq '"\(.number) \(.id)"'`, dann `gh api --method POST repos/ECCdigital/tickets/issues/<haupteintrag>/sub_issues -F sub_issue_id=<id>` mit der zweiten Zahl, nicht der Nummer. Ein alter Fehler, der nur jetzt auffällt, ist eine neue Anforderung wie oben. Eine Störung ist immer eine neue Anforderung, ein eigener Haupteintrag, nie ein Unter-Ticket.
   - Bei `/code-review` ist der Fixpunkt der Standard-Branch und die Vorgabe das Ticket.
5. **Pull Request**, wenn die Person ihn will: den Branch pushen, dann `gh pr create --base <standard-branch> --title "..." --body-file <datei>`. Mit Ablauf `v1` endet der Text mit der Zeile `Closes ECCdigital/tickets#<n>`. Der Merge schließt dann das Ticket.
   - Mehrere Pull Requests zu einem Ticket: Die früheren tragen `Refs ECCdigital/tickets#<n>`, nur der letzte `Closes`. Ist offen, ob es der letzte ist, fragst du.
   - `Closes` wirkt nur, wenn der Pull Request in den Standard-Branch dieses Repos geht. Geht er in einen anderen Branch, schreibst du `Refs` und sagst der Person, dass ein Mensch das Ticket nach dem Merge schließt.
   - Mit Ablauf `v2` endet der Text immer mit `Refs ECCdigital/tickets#<n>`, nie mit `Closes`, auch in den Standard-Branch und auch an einem Ticket ohne Haupteintrag, etwa einem Fehler: Erledigt setzt und schließt dort ein Mensch nach dem Merge.
   - **An einem Unter-Ticket** (Ablauf `v2`) schließt die Auswertung das Unter-Ticket, sobald seine Definition of Done erfüllt ist: `ci-ok` grün, Approval eines anderen Menschen, Vorwärts-Merge in jedes neuere `version/…` und den Standard-Branch, die Kästchen der PR-Vorlage gehakt. Fehlt etwas, nennt der Kasten des Haupteintrags die Lücke.
   - **Kästchen der PR-Vorlage**: Hat das Repo eine (`.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `docs/pull_request_template.md` oder `pull_request_template.md` auf der Basis), übernimmst du ihre Kästchen samt Überschrift leer in den Text, denn `--body-file` umgeht die Vorlage. Abhaken tut die Person, nie du. Sag ihr, dass sie Doku und Migrationshinweis und die offenen Punkte vor dem Merge abhakt.
6. **Review**: Mit Ablauf `v1` setzt du mit dem Pull Request, der `Closes` trägt, den Zustand „Review“. Nach einem Pull Request mit `Refs` bleibt „In Arbeit“. Mit Ablauf `v2` setzt du am Ticket ohne Haupteintrag „Review“, sobald sein Pull Request steht, mit mehreren erst mit dem letzten. An einem Unter-Ticket setzt du keinen, auch nicht am Haupteintrag.

Danach arbeiten Menschen weiter: Eine andere Person prüft den Pull Request, ein Mensch merged, mit Ablauf `v1` schließt der Merge das Ticket, mit `v2` ein Mensch, und ein Mensch setzt Erledigt. Das Ticket schließt du nicht selbst. Mit Ablauf `v2` schließt die Auswertung ein Unter-Ticket nach seiner Definition of Done (siehe „Pull Request“), es bekommt kein Erledigt. Ist das letzte Unter-Ticket geschlossen, prüft eine Hauptentwickler:in außer der treibenden den Haupteintrag gegen Spec und Akzeptanzkriterien, und ein Mensch schließt ihn.

## Pull requests as a triage surface

**PRs as a request surface: no.** Anforderungen kommen als Issues in `ECCdigital/tickets` herein.

## When a skill says "publish to the issue tracker"

Hier entstehen keine Specs und keine Tickets. Specs und Tickets entstehen aus einer Karte in `ECCdigital/tickets`, lokal in einem Klon davon mit `/to-spec` und `/to-tickets`. Läuft so ein Skill hier, sag das und frag, ob stattdessen eine Anforderung entstehen soll (siehe „Umsetzen“).

## When a skill says "fetch the relevant ticket"

`gh issue view <n> -R ECCdigital/tickets --comments`. Bei `/code-review` steht die Nummer im Text des Pull Requests oder in Commits als `ECCdigital/tickets#<n>`.

## Wayfinding operations

Karten und Klärungen liegen in `ECCdigital/tickets`. `/wayfinder` läuft in einem Klon von `ECCdigital/tickets` nach dessen `docs/agents/issue-tracker.md`. Hier liest du Karten und Klärungen nur: `gh issue view <n> -R ECCdigital/tickets --comments`.

## Triage

Triage-Labels gibt es nicht. Die Weiche in `ECCdigital/tickets` ersetzt `/triage`. Verlangt ein Skill ein Triage-Label, setzt du keins.
