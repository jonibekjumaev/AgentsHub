# AgentsHub

AgentsHub is a marketplace for AI agents:

- **Creators** publish **products**: listings for AI agents they built.
- **Users** publish **briefs**: a business need for a custom AI agent.
- Members contact each other off-platform, through the email or WhatsApp on their profile. This contact info is shown only to logged-in members.

This backend is a NestJS 10 monorepo with Apollo GraphQL (code-first) and MongoDB (Mongoose). It started as a copy of the Nestar real estate platform and is being converted step by step.

## Documentation

- [`docs/agentshub-er.md`](docs/agentshub-er.md): the database schema. This is the source of truth.
- [`docs/decisions.md`](docs/decisions.md): design decisions (D-01 …)
- [`docs/migration-audit.md`](docs/migration-audit.md): checklist for converting the Nestar code
- [`CLAUDE.md`](CLAUDE.md): architecture, conventions and commands

## Setup

```bash
npm install
```

Create a `.env` file in the repo root:

| Variable | Purpose |
|---|---|
| `PORT_API` | API port (fallback 3000) |
| `PORT_BATCH` | Batch port (fallback 3008) |
| `MONGODB_DEV` | MongoDB URI for development. Database `agentsHub` |
| `MONGODB_PROD` | MongoDB URI for production (used when `NODE_ENV=production`) |
| `SECRET_TOKEN` | JWT secret |
| `ADMIN_NICK` | Required for seeding: nick of the first admin account, created only by the seed script (D-14) |
| `ADMIN_PASSWORD` | Required for seeding: password of the first admin account (D-14). Use a strong value and never commit it |

## Run

```bash
npm run start:dev         # API in watch mode, GraphQL at /graphql
npm run start:dev:batch   # batch (ranking cron jobs) in watch mode
npm run build             # build both apps into dist/
npm run lint              # ESLint with --fix
npm test                  # Jest
```
