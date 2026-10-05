# CLAUDE.md

This file guides Claude Code (claude.ai/code) when working in this repository.

## Project goal

This repo is a **copy of Nestar** (a real estate platform), and it is being converted into **AgentHub**, a marketplace for AI agents (D-01). The original Nestar repo stays untouched.

- **CREATOR** members publish **Products**, which are listings for AI agents they built.
- **USER** members publish **Briefs**, which describe a business need for a custom agent.
- Contact happens off-platform: email/WhatsApp on the profile, shown to logged-in members only (D-07, D-08).

**`docs/agenthub-er.md` is the source of truth** for every schema, DTO, enum and GraphQL type. `docs/decisions.md` records the reasons (D-01 … D-11). If code and the ER doc disagree, fix one of them on purpose and record why in `docs/decisions.md`. New decisions start as **Proposed**. Never delete a decision; mark it **Superseded by D-XX** instead.

The code is still almost entirely Nestar. Main conversions:

- **Properties → Products.** `components/property`, `schemas/Property.model.ts`, `libs/dto/property/*` and `libs/enums/property.enum.ts` become `product`, with `product*` fields.
  - Drop address, square, beds, rooms, barter, rent, location, `constructedAt` and `soldAt` (D-10).
  - Add `productCategory` (`AgentCategory`), `productPricing`, `productDemoUrl` and `productTags`.
  - `productPrice` is conditional on `productPricing` (D-03).
  - `ProductStatus` = `ACTIVE | PAUSED | DELETE`.
- **New Briefs module.** Only USER members can create, update, close or delete briefs. `BriefStatus` = `OPEN | CLOSED | DELETE`. `briefBudget` is optional and > 0 (D-04). `briefDeadline` is optional and must be in the future (D-05).
- **Members.**
  - `MemberType.AGENT` becomes `CREATOR`.
  - `memberProperties` becomes `memberProducts`.
  - Add `memberBriefs`, `memberEmail` and `memberWhatsapp`. The last two are returned only to authenticated requests (D-07).
  - Remove `memberAddress`.
- **Polymorphic enums.**
  - `LikeGroup`: `PROPERTY` → `PRODUCT`.
  - `ViewGroup`, `CommentGroup` and `NotificationGroup`: `PROPERTY` → `PRODUCT`, and add `BRIEF`.
  - Notification `propertyId` becomes `productId`, and `briefId` is added.
- **Shared category enum.** `AgentCategory` is used by both products and briefs (D-09).
- **Batch ranking.** Property and agent ranking become product and creator ranking.
- **Out of scope for the MVP:**
  - offers and chat collections (D-08)
  - `auths`, `boconfigs` and `mobilemessages`
  - multi-currency; all money is USD (D-06)
  - embeddings and Claude API features (D-11)

**Naming trap:** In Nestar, "agent" means a *real-estate agent*, i.e. the member role. Examples: `MemberType.AGENT`, `getAgentProperties`, `aviableAgentSorts`, `batchAgents`, `BATCH_TOP_AGENTS`. In AgentHub, "agent" means an *AI agent*, i.e. the product. Old "agent" identifiers refer to the role and convert to `CREATOR`.

## Commands

| Command | What it does |
|---|---|
| `npm run start:dev` | API app `nestar-api` (default project), watch mode. Port `PORT_API` (fallback 3000). GraphQL at `/graphql` |
| `npm run start:dev:batch` | Batch app `nestar-batch`, watch mode. Port `PORT_BATCH` (fallback 3008) |
| `npm run build` | `nest build` (webpack) into `dist/` |
| `npm run lint` | ESLint with `--fix` |
| `npm run format` | Prettier on `apps/**/*.ts` |
| `npm test` | Jest. There are no unit specs yet |

Known issues, so you don't trip over them:

- `start:prod` runs `dist/apps/nestar/main`, but the app is `nestar-api`.
- `test:e2e` points to `./test/jest-e2e.json`, which does not exist at the root. The per-app configs are in `apps/*/test/`.

Environment variables in `.env`:

- `PORT_API`, `PORT_BATCH`
- `MONGODB_DEV` / `MONGODB_PROD`, chosen by `NODE_ENV === 'production'`
- `SECRET_TOKEN`: the JWT secret; tokens expire after 30 days

## Architecture

This is a NestJS 10 monorepo (`nest-cli.json`, `monorepo: true`) with Apollo GraphQL (code-first, `autoSchemaFile: true`), Mongoose 8, and class-validator.

```
apps/
  nestar-api/src/
    main.ts               global ValidationPipe, LoggingInterceptor, graphql-upload (15MB, 10 files),
                          static /uploads, WsAdapter
    app.module.ts         GraphQLModule (custom formatError), ComponentsModule, DatabaseModule, SocketModule
    components/<name>/    <name>.module.ts, <name>.resolver.ts, <name>.service.ts
                          auth, member, property, board-article, comment, like, view, follow
                          (all registered in components.module.ts)
    schemas/<Name>.model.ts   plain mongoose Schema, default export, { timestamps: true, collection }
                              Notice and Notification schemas exist but have no module yet
    libs/dto/<name>/      <name>.ts         @ObjectType + plural list type { list, metaCounter }
                          <name>.input.ts   @InputType create input + *Inquiry (page, limit, sort, direction, search)
                          <name>.update.ts  @InputType update (requires _id)
    libs/enums/           <name>.enum.ts: string enums + registerEnumType
                          common.enum.ts: Message (error strings), Direction
    libs/config.ts        allowed sort lists (aviable*Sorts), image mime/serial helpers,
                          shapeInToMongoObjectId, $lookup builders (lookupMember,
                          lookupAuthMemberLiked, lookupAuthMemberFollowed, lookupFavorite, lookupVisit, ...)
    libs/types/common.ts  T, ObjectId, StatisticModifier
    socket/               raw `ws` gateway: public broadcast chat, last 5 messages kept in memory
                          (note: D-08 says no in-platform chat in the MVP)
  nestar-batch/src/       @nestjs/schedule cron ranking: rollback 01:00:00, properties 01:00:20, agents 01:00:40
                          imports schemas, DTOs and enums directly from ../../nestar-api/src/...
uploads/{member,property,article}/   local image storage (gitignored)
docs/                     agenthub-er.md (schema source of truth), decisions.md
```

Images are uploaded through `imageUploader` / `imagesUploader` in `member.resolver.ts`, which write to `uploads/<target>/<uuid>.<ext>`.

## Conventions

**Auth** (`components/auth`):

- `AuthGuard`: login required.
- `WithoutGuard`: login optional. `memberId` may be `null`.
- `RolesGuard` + `@Roles(MemberType.X)`: role-restricted endpoints.
- Get the caller with `@AuthMember('_id')`. The guards put `authMember` on `req.body`.

**Resolvers:**

- Start each method by logging `console.log('Query: name')` or `console.log('Mutation: name')`.
- Convert string ids with `shapeInToMongoObjectId`.
- Set `input.memberId` from the auth member, never from client input.
- Admin endpoints are named `*ByAdmin` and sit under a `/** ADMIN */` section.

**Services:**

- Inject models with `@InjectModel('Name')`.
- List queries use `aggregate([{ $match }, { $sort }, { $facet: { list: [$skip, $limit, lookups...], metaCounter: [{ $count: 'total' }] } }])`.
- Throw Nest exceptions with `Message.*`.
- Counters change only through `*StatsEditor({ _id, targetKey, modifier })` using `$inc` (ER business rule 5).
- Soft delete sets `*Status = DELETE` plus `deletedAt`. Hard delete happens only in `remove*ByAdmin`.
- Business rules (D-03/04/05, role ownership, contact visibility) go in services and guards, not in Mongoose schemas.

**Naming:**

- Fields use a collection prefix: `member*`, `product*`, `brief*`, `article*`, `comment*`, and so on.
- Files are kebab-case. Schema files are `PascalCase.model.ts`.
- GraphQL operations are camelCase: `createX`, `getX`, `getXs`, `updateX`, `likeTargetX`, `getAllXsByAdmin`, `updateXByAdmin`, `removeXByAdmin`.
- Existing misspellings (`aviable*Sorts`, `getFavorities`) are part of the current API. Don't fix them as a side change.

**Formatting:**

- Prettier settings: tabs, single quotes, trailing commas, semicolons, `printWidth` 120.
- Some existing comments are in Uzbek. Leave them as they are.

## Working rules for the conversion

- Read the relevant section of `docs/agenthub-er.md`, and any linked decision, before you touch a schema, DTO or enum.
- Rename across all layers **in one step**, so both apps keep compiling and no Nestar leftovers remain (D-01, D-10). That means:
  - schema, DTOs and enums
  - service and resolver
  - `libs/config.ts` sorts and lookups (for example `aviablePropertySorts`, `aviableOptions`, `lookupFavorite`, `lookupVisit`)
  - `like` / `view` service helpers (`getFavoriteProperties`, `getVisitedProperties`)
  - the batch app
- Use the indexes the ER doc suggests. For example, the Nestar property unique index becomes unique `{ memberId, productTitle }`.
