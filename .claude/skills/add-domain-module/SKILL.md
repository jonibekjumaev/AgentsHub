---
name: add-domain-module
description: Checklist for adding a new domain module (schema, enums, DTOs, service, resolver, seed, docs) to the AgentsHub API, using the product module as the reference. Use when starting a new collection/module such as Brief (Step 7), or when adding a list, update or status flow to a module and you need the rules settled in Step 2.5 and Step 6.
---

# Add a domain module

Reference implementation: the **product** module. Read the real files instead of copying code from here:

- `apps/agentshub-api/src/schemas/Product.model.ts`
- `apps/agentshub-api/src/libs/enums/product.enum.ts`, `agent-category.enum.ts`
- `apps/agentshub-api/src/libs/dto/product/product.ts` / `product.input.ts` / `product.update.ts`
- `apps/agentshub-api/src/components/product/product.service.ts` / `product.resolver.ts` / `product.module.ts`
- `apps/agentshub-api/src/libs/config.ts` (sorts, limits, `escapeRegex`, `lookupMember`, `excludeMemberSecrets`)
- `apps/agentshub-api/src/libs/utils.ts` (`describeDbError`, `isDuplicateKeyError`, `normalizeTags`)
- `scripts/seed/seed.ts`, `scripts/seed/seed-data.ts`

Below, `<x>` is the field prefix (`brief`), `<X>` the class name (`Brief`).

## 0. Workflow (CLAUDE.md, D-20)

- **Plan first** (CLAUDE.md, working rules). Before editing, post a short plan (files, rules with S/B/D numbers, open questions, verification) and wait for approval.
- **Split the step into parts, one part = one commit.** Never mix renames, features and bug fixes in one commit. A bug found on the way is its own `fix: <what>` commit (and an audit item if it is not fixed now).
- Commit message style: `feat: … (Step N part M)`, `fix: … (B17)`; add `!` when the GraphQL contract changes.
- Don't commit until verification passed and the user asked for it.

## 1. ER and decisions check (always first)

- Read the collection in `docs/agentshub-er.md` (fields, `NN`, suggested indexes, enums, business rules) and every decision it links (for briefs: D-04, D-05, D-09, D-16 principle, ER rule 2 and 5).
- Read the module's step in `docs/migration-audit.md` (Step 7 for briefs).
- If the code needs to differ from the ER doc, or a rule is undecided (visibility, allowed status changes, who may do what), stop and add a **Proposed** decision to `docs/decisions.md` first. Never delete a decision; mark it *Superseded by D-XX*.

## 2. Schema — `schemas/<X>.model.ts`

- Plain `new Schema({...}, { timestamps: true, collection: '<x>s' })`, default export. Follow `Product.model.ts`.
- Enum fields: `{ type: String, enum: <Enum> }`; status gets `default` (e.g. `OPEN`).
- Counters `{ type: Number, default: 0 }`; `memberId` `{ type: Schema.Types.ObjectId, required: true, ref: 'Member' }`; `deletedAt` (and e.g. `closedAt`) as `Date`.
- Conditional rules (D-03/D-04/D-05) are **not** in the schema; leave a comment pointing to the service.
- Add exactly the ER-suggested indexes with `<X>Schema.index(...)`. Mongoose never drops old indexes: changing one on an existing collection needs a migration in `scripts/migrations/`.

## 3. Enums — `libs/enums/<x>.enum.ts`

- String enum + `registerEnumType(E, { name: 'E' })`. `BriefStatus` and `AgentCategory` (shared, D-09) already exist.
- New error strings go in `Message` (`libs/enums/common.enum.ts`).

## 4. GraphQL output type — `libs/dto/<x>/<x>.ts`

- `@ObjectType() <X>` + plural `<X>s { list, metaCounter: [TotalCounter] }`.
- Enum fields use `@Field(() => <Enum>)`, never `String` (Step 6 audit). Optional fields `nullable: true`; ids `@Field(() => String)`.
- `/** from aggregation */` section: `memberData?: Member`; `meLiked` only if the target can be liked (briefs can't).

## 5. Inputs — `<x>.input.ts` and `<x>.update.ts`

- **Create input:** `@IsNotEmpty()` on required fields, length limits as named constants in `libs/config.ts` (like `productDescMinLength`). `memberId?: ObjectId` without `@Field` (set by the resolver).
- **Ids:** every id taken from the client in a search/input gets `@IsMongoId()` (B16), so a malformed id is `BAD_REQUEST`, not a 500 in `shapeInToMongoObjectId`.
- **Inquiries** (`<X>sInquiry`, `My<X>sInquiry`, `All<X>sByAdmin` inquiry): `page`/`limit` `@Min(1)`, `sort` `@IsOptional() @IsIn(aviable<X>Sorts)`, `direction: Direction`.
- **Nested search:** `@IsNotEmpty() @ValidateNested() @Type(() => <Search>)` on every `search` field (B16; without it no rule inside `search` runs). Same for nested ranges (`PricesRange`). `text` gets `@MaxLength(searchTextMaxLength)`. Enum lists `@IsEnum(E, { each: true })` + `@ArrayMaxSize`.
- Shared filters across the public/own/admin lists: an abstract `@InputType({ isAbstract: true })` base like `ProductFilters`.
- Don't expose filters the service ignores (B16 removed `CRISearch.memberStatus/memberType`).
- **Update input:** `_id` required. For every field that is required in the schema (incl. `*Status`), use `@ValidateIf((o) => o.<f> !== undefined)` + a type check (`@IsString()`/`@IsEnum()`) instead of `@IsOptional()` — `@IsOptional` lets `null` through to `$set` (B11, D-15/B2 pattern). Keep `@IsOptional()` only where `null` means "clear" (e.g. budget, deadline), and say so in a comment.
- Server-only fields (`deletedAt`, `closedAt`) are plain properties without `@Field`.

## 6. Config — `libs/config.ts`

- `aviable<X>Sorts` allow-list (keep the misspelled prefix). Every list sorts by `{ [sort]: direction, _id: -1 }`: the `_id` tie-breaker keeps pages stable (Step 6 part 13). Optional sort fields (budget, deadline, price) must put empty values **last in both directions** — see `shapeSortStages` (D-04 for briefs).
- Any new member `$lookup` must use `excludeMemberSecrets` as its `pipeline`, like `lookupMember` (S16): `select: false` doesn't apply to `aggregate`.

## 7. Service — `components/<x>/<x>.service.ts`

- `@InjectModel('<X>')`; other modules' data only through their services (`MemberService`, `ViewService`, …).
- **Create:** run the business checks (D-04/D-05: one private `check…Rule()` per decision, the only place it's checked), `create`, then the member counter via `memberService.memberStatsEditor`. Catch: log `describeDbError(err)` (B13, never the raw error), duplicate key → `ConflictException` (B15 part 2), else `BadRequestException(CREATE_FAILED)`.
- **Text search:** `new RegExp(escapeRegex(text), 'i')` (S8). Never put raw client text into a regex.
- **Lists:** `aggregate([{ $match }, ...sortStages, { $facet: { list: [$skip, $limit, lookupMember, { $unwind: '$memberData' }], metaCounter: [{ $count: 'total' }] } }])`. Status filters go in `$match` **before** `$facet`, so `metaCounter` is right (D-16).
- **Visibility** (D-16 principle, applied per module): write one `is<X>Visible(doc, memberId, memberType)` like `isProductVisible` and use it everywhere a single item or its children (comments, views) are read. Public lists show only the public status; the owner's list shows everything except `DELETE`; admin lists show all. A hidden item answers **exactly like a missing one**.
- **Views:** record a view only for logged-in non-owners on a publicly visible item (D-22, D-16), then `<x>StatsEditor({ targetKey: '<x>Views', modifier: 1 })`.
- **Updates:** one private `apply<X>Update(search, input)` shared by owner (`search` includes `memberId`) and admin (D-29). Load with `{ ...search, <x>Status: { $ne: DELETE } }`; check the transition with a `checkStatusChange()` table (same status = no change, illegal → `BadRequestException`); set `deletedAt`/`closedAt` on the matching transition; then **compare-and-set**: `findOneAndUpdate({ ...search, <x>Status: stored.<x>Status }, …)`. No match → `NotFoundException(UPDATE_FAILED)`. Decrement the member counter only if this write moved it to `DELETE` (Step 6 part 15).
- Never pass an object to `findByIdAndUpdate`/`findByIdAndDelete`: it drops the filter (B10, Step 6 part 1). Use `findOne*`.
- **Admin remove:** hard delete only items already `DELETE` (`findOneAndDelete({ _id, <x>Status: DELETE })`, D-28); no counter change there.
- **Counters:** only through `<x>StatsEditor({ _id, targetKey, modifier })` with `$inc` (ER rule 5). Never from client input; never a `$set` on a counter.
- **Exceptions (B15):**
  | Case | Class → code |
  |---|---|
  | missing, hidden, or someone else's item (read, update, like/comment target) | `NotFoundException` → `NOT_FOUND` (don't reveal others' items with 403) |
  | duplicate unique key | `ConflictException` → `CONFLICT` |
  | invalid input / rule (D-03/04/05, bad status change, self-action) | `BadRequestException` |
  | not logged in / inactive caller | `UnauthorizedException` |
  | real server faults, stats editor after a checked target, unreachable `$facet` guard | `InternalServerErrorException` |
- No `console.log` of filters, inputs, results or DB errors (B13, S16). The interceptor never logs bodies; keep it that way.

## 8. Resolver — `components/<x>/<x>.resolver.ts`

- Each method starts with `console.log('Query: name')` / `'Mutation: name'` (nothing else).
- Guards: role-restricted writes `@Roles(MemberType.USER) @UseGuards(RolesGuard)` (briefs: ER rule 2); public reads `WithoutGuard` (caller may be `null`); personal reads `AuthGuard`. Guards already reject blocked/deleted members (B17).
- `input.memberId = memberId` from `@AuthMember('_id')`; pass `@AuthMember('memberType')` where visibility needs the admin check.
- String id args → `shapeInToMongoObjectId` (after `@IsMongoId` where it comes from an input).
- Admin methods `*ByAdmin` under `/** ADMIN */`, `@Roles(MemberType.ADMIN)`.

## 9. Module registration

- `<x>.module.ts`: `MongooseModule.forFeature([{ name: '<X>', schema }])`, `AuthModule`, `MemberModule`, `ViewModule` (as needed); export the service.
- Add it to `components/components.module.ts`.
- Dependents (comments, views, notifications for BRIEF) are Step 8, not this step.

## 10. Seed fixtures — `scripts/seed/`

- Add fixtures to `seed-data.ts` and create them in `seed.ts` **through the service** (never `insertMany`), covering every status and the optional-field variants (with/without budget, deadline).
- Add the collection to `removeSeedData` and to the counter fix-ups (member counter, views, comments).
- Run `npm run seed` twice to confirm it is idempotent.

## 11. Docs

- `docs/agentshub-er.md`: only if a field/index/enum changed — and then with a decision.
- `docs/migration-audit.md`: tick the step's items with a short **Done in Step N part M:** note; add any bug found as a new S/B item.
- Step 12 table: one row per client-visible change (new operations, error codes, input rules).
- `docs/decisions.md`: new or updated decisions (Proposed → Accepted only by the user).
- `CLAUDE.md`: only if commands or architecture changed.

## 12. Verification (before every commit)

- `npm run build` and `npx nest build agentshub-batch` → 0 errors; `npm run lint`.
- Start the API; check the generated schema (types, enums as enums, no leftover fields).
- Direct `ValidationPipe` cases for each input rule: `null` on required update fields, malformed ids, 101-char `search.text`, bad enums.
- Live/Postman: create, read as owner/other/guest/admin, each status transition (incl. a repeated `DELETE`), counters before/after, error codes (`NOT_FOUND`, `CONFLICT`, `BAD_REQUEST`), sort with empty optional values.
- Check the API log: no request/response bodies, tokens, passwords or duplicate-key values.
- Report what was checked and how; don't claim checks that weren't run.
