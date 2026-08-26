# Agent Instructions — Smart City Booking Backend

Instructions for AI coding agents (Codex, Cursor, Claude Code). Human docs live in `README.md` and `docs/`.

## Project

Node.js/Express REST API for multi-tenant resource booking (rooms, sports facilities, makerspaces). MongoDB via Mongoose. GPL-3.0.

| Area           | Path                     | Purpose                               |
| -------------- | ------------------------ | ------------------------------------- |
| Business logic | `src/commons/`           | Entities, managers, services, schemas |
| HTTP layer     | `src/platform/`          | Controllers, routers, auth            |
| Rule engine    | `src/rule-engine/`       | JSON-logic booking rules              |
| Migrations     | `migrations/`            | One-off DB migration scripts          |
| Tests          | `tests/`                 | Mocha unit/integration tests          |
| API docs       | `src/docs/`, `docs/api/` | OpenAPI YAML                          |

See [docs/agents/architecture.md](docs/agents/architecture.md) for layout and data model.

## Ecosystem

This repo is the **backend API only**. Frontends live in separate repositories:

| Component      | Repository                                                                                     | Role                                            |
| -------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Admin UI**   | [smart-city-booking-vue-app](https://github.com/ECCdigital/smart-city-booking-vue-app)         | Administration, configuration, JS web interface |
| **Storefront** | [smart-city-booking-store-front](https://github.com/ECCdigital/smart-city-booking-store-front) | Public booking UI (v4)                          |

Do not assume frontend code is in this repo. API changes may require coordinated updates in those repos.

## Commands

```bash
npm install          # install dependencies
npm run dev          # dev server (nodemon, needs MongoDB)
npm test             # mocha tests
npm run lint:check   # eslint
npm run lint:fix     # eslint --fix
npm run format:check # prettier --check
npm run format:write # prettier --write
```

Run `npm test` and `npm run lint:check` before finishing a task. Fix lint issues you introduce.

## Coding standards

- **Written language:** English for all code, comments, commit messages, PR titles/descriptions, and changelog entries
- **Programming language:** JavaScript (CommonJS `require`/`module.exports`), ECMAScript 2022
- **Style:** Prettier + ESLint — match surrounding code
- **DRY:** Reuse existing managers, services, and utilities; extract shared logic only when duplication is real — avoid premature abstractions
- **Scope:** Minimal, focused diffs; no drive-by refactors
- **Errors:** Use classes from `src/errors/` (`BadRequestError`, `NotFoundError`, …)
- **Logging:** `bunyan` with `process.env.LOG_LEVEL`
- **Tenancy:** Most data is scoped by `tenantId` — always respect tenant boundaries
- **Secrets:** Never commit `.env`, credentials, or real tokens

Details: [docs/agents/coding-standards.md](docs/agents/coding-standards.md)

## Domain-specific guides

| Topic                     | File                                                       |
| ------------------------- | ---------------------------------------------------------- |
| Architecture & data model | [docs/agents/architecture.md](docs/agents/architecture.md) |
| API controllers & routes  | [docs/agents/api.md](docs/agents/api.md)                   |
| Tests                     | [docs/agents/testing.md](docs/agents/testing.md)           |
| Migrations                | [docs/agents/migrations.md](docs/agents/migrations.md)     |

## Guardrails

- Do **not** change version branches (`version/3.x`, `version/4.x`) unless explicitly asked
- Do **not** commit without being asked
- Do **not** add dependencies without good reason
- Prefer extending existing managers/services over duplicating logic
- Changes require a changelog entry in `docs/CHANGELOG.md`. Keep it short.
- Frontend repos are separate — Admin UI: [smart-city-booking-vue-app](https://github.com/ECCdigital/smart-city-booking-vue-app), Storefront: [smart-city-booking-store-front](https://github.com/ECCdigital/smart-city-booking-store-front)

## Tool setup

| Tool            | Entry point                               |
| --------------- | ----------------------------------------- |
| **Codex**       | Reads this file (`AGENTS.md`) natively    |
| **Cursor**      | Reads `AGENTS.md` + `.cursor/rules/*.mdc` |
| **Claude Code** | Reads `CLAUDE.md` → imports this file     |

Structure overview: [docs/agents/README.md](docs/agents/README.md)
