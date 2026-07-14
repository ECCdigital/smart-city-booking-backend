# Agent Instructions — Structure

This folder holds modular agent instructions shared across Codex, Cursor, and Claude Code.

## Layout

```
AGENTS.md                 ← canonical entry (all tools)
CLAUDE.md                 ← Claude Code import (@AGENTS.md)
docs/agents/
  README.md               ← this file
  architecture.md         ← project layout & domain model
  coding-standards.md     ← style & patterns
  api.md                  ← controllers & routes
  testing.md              ← mocha test conventions
  migrations.md           ← DB migration scripts
.cursor/rules/
  *.mdc                   ← Cursor-only glob-scoped rules
```

## Design principles

1. **Single source of truth** — `AGENTS.md` is the canonical file. Tool-specific files only add imports or Cursor glob rules.
2. **Modular depth** — Keep `AGENTS.md` concise; detailed rules live in `docs/agents/`.
3. **No duplication** — Cursor `.mdc` files reference `docs/agents/` instead of copying content.
4. **Human docs stay separate** — `README.md` and `docs/` are for humans; `docs/agents/` is for coding agents.

## Per-tool notes

### Codex

Reads `AGENTS.md` from repo root. For local-only overrides, use `AGENTS.override.md` (gitignored via `.gitignore`).

### Cursor

Reads root `AGENTS.md` plus `.cursor/rules/*.mdc`. Use `.mdc` files only for glob-scoped rules that other tools cannot express.

### Claude Code

Reads `CLAUDE.md`, which imports `AGENTS.md`. For Claude-specific overrides, add content below the `@AGENTS.md` line in `CLAUDE.md`.

## Adding new rules

1. Add detailed content to the appropriate `docs/agents/<topic>.md`
2. Link it from `AGENTS.md`
3. If Cursor needs glob-scoped activation, add a thin `.cursor/rules/<topic>.mdc` that points to the doc
