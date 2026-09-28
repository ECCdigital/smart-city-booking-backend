# Issue-Tracker: GitHub ECC, Produkt-Repo

Erzeugt vom Setup der ECC-Fassung (`/setup-matt-pocock-skills`, Vorlage „GitHub ECC, Produkt-Repo“), Stand `ecc-5`. Nicht von Hand ändern: Die Vorlage liegt im Fork `ECCdigital/skills`. Nach einem neuen Stand führst du das Setup neu aus.

Dieses Repo enthält Code eines Produkts. Die Tickets dazu liegen nicht hier, sondern als Issues in `ECCdigital/tickets`, zusammen mit Anforderungen, Karten und Klärungen. Issues dieses Repos sind keine Tickets.

- Jeder `gh`-Befehl an Tickets bekommt `-R ECCdigital/tickets`. Ohne ihn meint `gh` dieses Repo.
- Eine Nummer wie `#42`, `ECCdigital/tickets#42` oder die URL `https://github.com/ECCdigital/tickets/issues/42` meint ein Issue in `ECCdigital/tickets`.
- Die Begriffe der Arbeitsweise (Ticket, Zustand, Definition of Ready, Board) stehen in `CONTEXT.md` von `ECCdigital/tickets`: `gh api repos/ECCdigital/tickets/contents/CONTEXT.md -H "Accept: application/vnd.github.raw"`.

## Ein Ticket

- Ein Ticket ist ein Issue in `ECCdigital/tickets` mit Issue Type Fehler, Feature oder Aufgabe. Ohne Typ ist es eine Anforderung, eine Karte oder eine Klärung.
- **Lesen**: `gh issue view <n> -R ECCdigital/tickets --comments`. Typ, Assignees und Zustand: `gh issue view <n> -R ECCdigital/tickets --json state,issueType,assignees,projectItems`. Der Zustand ist `status.name` des Eintrags im Board „Arbeit“.
- **Vorgabe** ist der Abschnitt `## Definition of Ready` im Ticket-Text, dazu „Was entsteht“ und die Herkunft (Karte und Spec), wenn es sie gibt:
  - Fehler: Schritte zum Reproduzieren und erwartetes Verhalten.
  - Feature: Ziel in einem Satz und Akzeptanzkriterien.
  - Aufgabe: Ergebnis in einem Satz.
- **Zustände** im Board Arbeit, Feld Status: Eingang, Backlog, Bereit, In Arbeit, Review, Erledigt, Verworfen.

## Board Arbeit

Das Board ist das Org-Board, das die Repo-Variable `BOARD` von `ECCdigital/tickets` nennt: `gh variable get BOARD -R ECCdigital/tickets` (heute 11). `gh` braucht dafür den Scope `project`. Scheitert ein Befehl daran, sagst du der Person: `gh auth refresh -s project`.

Einen Zustand setzt du mit `gh project`, jeden Befehl einzeln:

1. Item-Id: `gh project item-add <board> --owner ECCdigital --url https://github.com/ECCdigital/tickets/issues/<n> --format json --jq .id`. Steht das Ticket schon im Board, liefert das denselben Eintrag.
2. Projekt-Id: `gh project view <board> --owner ECCdigital --format json --jq .id`.
3. Feld-Id und Id des Zustands: `gh project field-list <board> --owner ECCdigital --format json --jq '.fields[] | select(.name == "Status") | {id, options: [.options[] | {id, name}]}'`.
4. Setzen: `gh project item-edit --id <item-id> --project-id <projekt-id> --field-id <feld-id> --single-select-option-id <zustand-id>`.
5. Prüfen: `gh issue view <n> -R ECCdigital/tickets --json projectItems`.

Du setzt nur das Feld Status, nur am Ticket, an dem du arbeitest, und nur „In Arbeit“ und „Review“. Bereit, Erledigt, Verworfen und alle anderen Felder setzt ein Mensch. `.github/scripts/board.sh` gibt es nur in `ECCdigital/tickets`, hier nimmst du die Befehle oben.

## Ein Ticket bearbeiten

Gilt für jede Session, die an einem Ticket arbeitet, etwa `/implement <URL des Tickets>`. Die Schritte ergänzen den Skill.

1. **Prüfen**: Lies das Ticket samt Zustand.
   - Ohne Issue Type ist es kein Ticket. Sag das und ende.
   - Ist es geschlossen, Erledigt oder Verworfen, sag das und ende.
   - Steht es nicht auf Bereit, In Arbeit oder Review, oder fehlt die Definition of Ready, sag das. Bereit setzt nur ein Mensch. Du machst nur weiter, wenn die Person es ausdrücklich will.
   - Ist eine andere Person Assignee, nenne sie und frag, bevor du weitermachst.
2. **Übernehmen**, als erste Schreibaktion:
   - Ohne Assignee: `gh issue edit <n> -R ECCdigital/tickets --add-assignee @me`.
   - Zustand „In Arbeit“, wie unter „Board Arbeit“. Steht er schon dort, bleibt er.
3. **Branch** `<n>-<stichwort>`: das Stichwort aus dem Titel, klein, mit Bindestrichen, ohne Umlaute, etwa `42-csv-export`. Bist du auf dem Standard-Branch, legst du ihn von dort an: `git switch -c <n>-<stichwort>`. Bist du schon auf einem Branch für dieses Ticket, bleibst du dort. Den Standard-Branch nennt `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`.
4. **Umsetzen** nach dem Skill, auf diesem Branch. Die Definition of Ready ist die Vorgabe.
   - Was sie nicht deckt oder was ihr widerspricht, fragst du nach.
   - Neue Arbeit, die sich zeigt, ist eine neue Anforderung. Du nennst sie. Will die Person sie anlegen, dann mit einer Zeile Titel, ohne Label, Typ und Assignee: `gh issue create -R ECCdigital/tickets --title "..." --body "..."`. Die Weiche in `ECCdigital/tickets` ordnet sie ein.
   - Bei `/code-review` ist der Fixpunkt der Standard-Branch und die Vorgabe das Ticket.
5. **Pull Request**, wenn die Person ihn will: den Branch pushen, dann `gh pr create --base <standard-branch> --title "..." --body-file <datei>`. Der Text endet mit der Zeile `Closes ECCdigital/tickets#<n>`. Der Merge schließt dann das Ticket.
   - Mehrere Pull Requests zu einem Ticket: Die früheren tragen `Refs ECCdigital/tickets#<n>`, nur der letzte `Closes`. Ist offen, ob es der letzte ist, fragst du.
   - `Closes` wirkt nur, wenn der Pull Request in den Standard-Branch dieses Repos geht. Geht er in einen anderen Branch, schreibst du `Refs` und sagst der Person, dass ein Mensch das Ticket nach dem Merge schließt.
6. **Review**: Mit dem Pull Request, der `Closes` trägt, setzt du den Zustand „Review“. Nach einem Pull Request mit `Refs` bleibt „In Arbeit“.

Danach arbeiten Menschen weiter: Eine andere Person prüft den Pull Request, ein Mensch merged, der Merge schließt das Ticket, und ein Mensch setzt Erledigt. Das Ticket schließt du nicht selbst.

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
