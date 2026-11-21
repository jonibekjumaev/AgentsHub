# AgentsHub — Design Decisions

> One entry per decision: context, decision, reason, consequence.
> Status values: **Accepted** = decided by the project owner; **Proposed** = drafted, waiting for owner review.
> When a decision changes, do not delete it. Mark it **Superseded by D-XX** and add a new entry.

---

## D-01 — Start from a copy of Nestar

**Status:** Accepted

- **Context:** AgentsHub needs Nestar-scale features: members, listings, social features and an admin area.
- **Decision:** Copy the Nestar codebase into a new repo and convert it, instead of starting from scratch. The original Nestar repo stays untouched.
- **Reason:** Auth, GraphQL setup, upload, likes/views/comments, batch jobs and the frontend shell are already working. The work is converting the domain, not building infrastructure again.
- **Consequence:** Nestar leftovers (names, enums, unused pages) must be removed on purpose. Step 2 (audit) is the checklist for that.

## D-02 — One member type per account

**Status:** Accepted

- **Decision:** `memberType` is `USER`, `CREATOR` or `ADMIN`. It is chosen at signup and cannot be changed by the member.
- **Reason:** Keeps permissions simple: a member's type decides what they can create.
- **Consequence:** A person who wants to both sell agents and post briefs needs two accounts. This can be revisited after the MVP.

## D-03 — `productPrice` depends on `productPricing`

**Status:** Accepted

- **Context:** Not every agent has a fixed price. Free agents have no price, and custom work is negotiated off-platform.
- **Decision:** `productPrice` is optional in the schema. The service validates it against `productPricing`:

  | productPricing | productPrice                                                  |
  | -------------- | ------------------------------------------------------------- |
  | `FREE`         | must be empty (null)                                          |
  | `ONE_TIME`     | required, > 0                                                 |
  | `SUBSCRIPTION` | required, > 0, meaning price per month                        |
  | `CUSTOM`       | must be empty (null). The price is discussed with the creator |

- **Reason:** A required price would force fake values like `0` for free agents. Filtering by price would then mix "free" and "price unknown". Keeping the rule in one service method gives one place to test it.
- **Consequence:** Validation runs on create **and** update. On update, the check uses the final pricing/price combination, not only the fields sent in that request. Price filters on the list page only include `ONE_TIME` and `SUBSCRIPTION` products.

## D-04 — `briefBudget` is optional

**Status:** Accepted

- **Context:** Business owners often do not know what an AI agent costs.
- **Decision:** `briefBudget` is optional. If it is given, it must be > 0.
- **Reason:** A required budget would make users guess or type a random number, and creators would get misleading data. An empty budget means "open to offers", and the UI shows it that way.
- **Consequence:** Budget sorting and filtering must handle empty values. Briefs without a budget appear last when sorted by budget.

## D-05 — `briefDeadline` is optional and must be in the future

**Status:** Accepted

- **Decision:** `briefDeadline` is optional. If it is given, it must be later than the current time when the brief is created or updated.
- **Reason:** Many requests have no hard date. A past deadline is a data error, not a valid state.
- **Consequence:** A brief whose deadline has passed is not closed automatically in the MVP. A batch job that closes expired briefs can be added later as its own decision.

## D-06 — One currency for the MVP

**Status:** Accepted

- **Decision:** All money fields (`productPrice`, `briefBudget`) are in USD. There is no currency field.
- **Reason:** The target audience is international freelancers and clients. A currency field adds conversion and display logic that the MVP does not need.
- **Consequence:** Adding multi-currency later means adding a `*Currency` field and migrating existing data to `USD`.

## D-07 — Contact info visible only to logged-in members

**Status:** Accepted

- **Decision:** `memberEmail` and `memberWhatsapp` are returned only for authenticated requests. Guests receive them as `null`.
- **Reason:** Protects creators and users from scraping and spam.
- **Consequence:** This must be enforced in the API, not only hidden in the UI. The implementation approach is chosen in step 9 of the migration plan.

## D-08 — Contact happens off-platform

**Status:** Accepted. **Partly superseded by D-19** (the existing community chat is kept), **D-48** (offers and invites on briefs) **and D-49** (1:1 chat on an offer). Contact details and money stay off the platform.

- **Decision:** No in-platform offers or chat in the MVP. Members contact each other through the email/WhatsApp shown on profiles.
- **Reason:** Keeps the MVP at Nestar scale. Real-time chat is deferred.
- **Consequence:** There is no `offers` or `messages` collection.

## D-09 — One shared category enum for products and briefs

**Status:** Accepted

- **Decision:** `productCategory` and `briefCategory` both use `AgentCategory`.
- **Reason:** A brief in `SALES` should match products in `SALES`. Two separate enums would drift apart over time.
- **Consequence:** Changing a category affects both collections at once.

## D-10 — Removed Nestar-only collections and fields

**Status:** Accepted

- **Decision:** These are removed from the MVP:
  - collections `auths`, `boconfigs` and `mobilemessages`
  - real-estate fields such as address, square, beds, rooms, barter, rent, location and constructedAt
  - `soldAt`
- **Reason:** They have no meaning for AI agent listings. An agent is not "sold out", so `soldAt` does not apply.
- **Consequence:** Frontend filters and batch jobs that use these fields must be removed in the same step as the schema change.

## D-11 — AI features come last

**Status:** Accepted

- **Decision:** Semantic search and other Claude API features are built only after the core platform works end to end.
- **Reason:** AI features depend on stable data, such as product descriptions and categories.
- **Consequence:** The schema does not include embedding fields yet. They will be added in their own decision when that phase starts.

---

> D-12 … D-20 come from the open questions in `docs/migration-audit.md`. Each lists options and a recommendation; the project owner picks one and changes the status to **Accepted**.

## D-12 — Rename the `nestar-*` apps

**Status:** Accepted

- **Context:** The apps are still called `nestar-api` and `nestar-batch`. The name appears in:
  - `nest-cli.json`
  - both `tsconfig.app.json` files (`outDir`)
  - the `package.json` scripts
  - the batch app's `../../nestar-api/src/...` imports (6 lines in `batch.module.ts` and `batch.service.ts`)
  - `dist/`
  - `CLAUDE.md`

  D-01 says Nestar leftovers must be removed on purpose. (Audit: Step 3.)
- **Options:**
  - **A. Rename to `agentshub-api` / `agentshub-batch` in step 3.**
    - Pro: No Nestar name in any path. It's done once, before other edits pile up, and every later step already uses the final paths.
    - Con: Touches all the config files listed above. Local IDE/run configs break. `git mv` is needed to keep file history readable.
  - **B. Keep the folder names; rename only what users see** (package name, hello strings, DB name).
    - Pro: Smallest diff, nothing to rewire.
    - Con: A permanent Nestar name in every path, which goes against D-01. Future readers keep hitting the "agent vs. agent" naming confusion.
  - **C. Rename at the end, after step 10.**
    - Pro: Domain-conversion diffs are not mixed with file moves.
    - Con: Every step's commits use paths that later change. The rename touches files that were just edited, and old paths stay in docs until the end.
- **Recommendation:** **A.** Step 3 edits these config files anyway. The batch imports are few and get rewritten in step 10 regardless. Doing the move first keeps every later diff about the domain only.
- **Decision:** Option A. Rename `apps/nestar-api` → `apps/agentshub-api` and `apps/nestar-batch` → `apps/agentshub-batch` in step 3, before any domain change (enums, schemas, DTOs). The rename covers:
  - the folders (via `git mv`)
  - `nest-cli.json` project names and paths
  - both `tsconfig.app.json` `outDir` values
  - the `package.json` scripts
  - the batch app's `../../nestar-api/src/...` imports
  - the paths in `CLAUDE.md`
- **Consequence:** Existing `dist/apps/nestar-*` output is stale and must be deleted and rebuilt. Local IDE/run configs that point to the old paths need updating. `docs/migration-audit.md` still uses the old paths (`apps/nestar-api/src/` = `api/`). Read them as the new names after step 3.

## D-13 — Fresh database vs. migrating Nestar data

**Status:** Accepted

- **Context:** `MONGODB_DEV` and `MONGODB_PROD` in `.env` both point to the `Nestar` database. Running the converted code against it would change the original data, which goes against D-01. The data in it is real-estate test data: properties, plus likes, views and comments on them. (Audit: Step 3.)
- **Options:**
  - **A. New empty `agentsHub` database, filled by a small seed script.**
    - Pro: Nestar data stays untouched. No migration script to write or test. No documents in old shapes.
    - Con: Test accounts and articles are lost. A seed script (creators, users, products, briefs) is needed for development.
  - **B. Copy the Nestar database to `agentsHub`, then run a migration script.** The script would:
    - change `AGENT` → `CREATOR`
    - `$rename memberProperties → memberProducts`, then reset it to 0
    - `$unset memberAddress`
    - drop `properties`, and drop likes/views/comments/notifications with group `PROPERTY`
    - recompute the member counters

    Trade-offs:
    - Pro: Keeps members, articles and follows.
    - Con: The script has to be written and verified. `memberLikes`/`memberViews`/`memberRank` may hold values earned in the real-estate context. Uploaded property images become orphans.
  - **C. Keep using the `Nestar` database.**
    - Pro: No setup.
    - Con: Changes or corrupts the original Nestar data, which D-01 forbids. Listed only for completeness.
- **Recommendation:** **A.** The existing data is real-estate test data with no value for AgentsHub, and there are no production users yet. A seed script is also reusable for tests and demos.
- **Decision:** Option A.
  - `MONGODB_DEV` points to a new, empty database named **`agentsHub`**.
  - The production database name is decided at deploy time.
  - No Nestar data is migrated. A seed script fills the dev database with creators, users, products and briefs.
- **Consequence:**
  - The `Nestar` database is no longer used by this repo, and `MONGODB_PROD` must not point to it either.
  - MongoDB database names are case-sensitive, so `agentsHub` must be spelled exactly that way in every URI.
  - The seed script is new work, scheduled together with the step that first needs data.

## D-14 — Which member types can be chosen at signup

**Status:** Accepted

- **Context:** `MemberInput.memberType` (`member.input.ts:23–25`) accepts any `MemberType`, including `ADMIN`. Anyone can register as an admin. D-02 says the type is chosen once at signup, but does not say which types are allowed. Today the field is optional, and the schema default is `USER`. (Audit: Step 5.)
- **Options:**
  - **A. Validate in the DTO with `@IsIn([MemberType.USER, MemberType.CREATOR])`.**
    - Pro: One line. Rejects the request before it reaches the service.
    - Con: The GraphQL schema still lists `ADMIN` as a valid value for the argument, because the enum type is shared. Only the error message tells clients otherwise.
  - **B. Use a separate GraphQL enum `SignupMemberType { USER, CREATOR }` for the input.**
    - Pro: The schema itself shows the allowed values, so frontend codegen can't offer `ADMIN`.
    - Con: A second enum to keep in sync with `MemberType`, plus a mapping in the service.
  - **C. Check it in `MemberService.signup`.**
    - Pro: Follows the "business rules in services" convention.
    - Con: Easier to miss when adding another signup path. The error comes later than validation.
- **Sub-question:** Should `memberType` become **required** at signup, instead of silently defaulting to `USER`? D-02 says it is "chosen", which suggests the member makes an explicit choice.
- **Recommendation:** **A**, with `memberType` required. It's the smallest change that closes a privilege-escalation hole. Admins are created directly in the database or promoted through `updateMemberByAdmin`.
- **Decision:** Option A, with these rules:
  - **Signup:** `MemberInput.memberType` is **required** (`@IsNotEmpty()`, non-nullable `@Field`) and validated with `@IsIn([MemberType.USER, MemberType.CREATOR])`. `ADMIN` can never be chosen through the API.
  - **Updates:** neither `MemberUpdate` nor `MemberUpdateByAdmin` contains `memberType`, so the type cannot change after signup (D-02).
    - Today `MemberUpdate` already has no `memberType`.
    - `MemberUpdateByAdmin` does (`member.update.ts:48–50`) and must drop it.
    - Once a field is removed from the input class, GraphQL rejects it as an unknown input field before the resolver runs.
  - **First admin:** created only by the seed script (D-13), using `ADMIN_NICK` and `ADMIN_PASSWORD` from `.env`. The seed must hash the password the same way `AuthService.hashPassword` does.
    - **Amended when the seed was written:** the seed refuses to run in production, so the admin has its own command, `npm run create-admin` (`scripts/create-admin.ts`).
      - It is allowed in production (`NODE_ENV=production` uses `MONGODB_PROD`).
      - It reads `ADMIN_NICK`, `ADMIN_PASSWORD` and `ADMIN_PHONE` (E.164, D-25). A missing key → exit with an error naming it.
      - It creates the admin only if no member has `ADMIN_NICK` yet, through `MemberService.signup` (so the password is hashed by `AuthService.hashPassword`) after checking the signup DTO rules except `memberType`. An existing admin is never changed, reset or deleted. If the nick belongs to a non-admin member, it exits with an error.
      - `npm run seed` calls the same logic: it creates the admin if missing, otherwise skips it. Seed cleanup never deletes an `ADMIN` member.
      - It runs with `ts-node` (a devDependency), so it needs a checkout with dev dependencies installed.
  - This replaces the recommendation's note about promoting admins through `updateMemberByAdmin`. That path no longer exists.
- **Validation pipe:** **Yes.** A global `ValidationPipe` is enabled in `apps/nestar-api/src/main.ts:11` (`app.useGlobalPipes(new ValidationPipe())`), so `@IsIn` on the signup input is enforced. It has no options (`whitelist` is off), so excluding `memberType` from updates relies on the field being absent from the GraphQL input types, not on the pipe.
- **Verification:** after the fix,
  - `signup` with `memberType: ADMIN` is rejected with a validation error, and no member is created.
  - `signup` without `memberType` is rejected.
  - Sending `memberType` to `updateMember` or `updateMemberByAdmin` fails with a GraphQL "field not defined" error, and the stored type is unchanged.
  - `signup` with `USER` and with `CREATOR` still succeeds.
- **Consequence:**
  - Changing a member's type, including promoting someone to admin, is only possible directly in the database.
  - A creator who also wants to post briefs needs a second account (D-02).
  - `memberPhone` is required and unique in the schema, so the seeded admin also needs a phone value. The seed script must either use a fixed placeholder or read an extra key; decide this when the seed script is written. **Answered:** an extra key, `ADMIN_PHONE` (E.164), read by `npm run create-admin`.
  - When the code fix lands is decided by D-20.

## D-15 — Default `memberImage`

**Status:** Accepted

- **Context:** The schema default is `''` (`Member.model.ts:48`). The ER doc says `memberImage` is NN with a "default image path". Only `/uploads` is served statically, and `uploads/` is gitignored. (Audit: Step 5.)
- **Options:**
  - **A. Keep `''` and let the frontend show a placeholder. Update the ER doc note.**
    - Pro: No asset hosting on the server. No path stored in every document.
    - Con: Every client must handle the empty value, and the ER doc needs a correction.
  - **B. Store a fixed path to a committed asset** (e.g. `uploads/member/default.svg` with a `.gitignore` exception, or a new static folder).
    - Pro: The API always returns a usable URL, which matches the ER doc as written.
    - Con: Needs a gitignore exception or a new static route. The path is copied into every member document, so changing the default later needs a data migration.
  - **C. Store `''`/null in the DB, but resolve a default path when reading** (in the service, or a GraphQL field resolver).
    - Pro: The API always returns a URL, and the default can change without a migration.
    - Con: Extra logic, and it must also cover members embedded through `$lookup` (`memberData`, `followerData`, …), which skip any field resolver on the service side.
- **Recommendation:** **A.** The frontend already needs placeholder handling for missing images elsewhere. Baking a path into every document creates migration work later for no real gain in the MVP.
- **Decision:** Option A.
  - `memberImage` stays a required (NN) string with default `''`. An empty string means "no image".
  - The frontend shows a placeholder when `memberImage` is `''`. The database never stores a placeholder path.
- **Reason:** The placeholder is a presentation concern. Storing its path would couple the data to frontend assets, and changing the placeholder later would need a data migration.
- **Consequence:**
  - **"Required" here means NN, not Mongoose `required: true`.** The field is always present because of `default: ''`, and GraphQL exposes it as non-null `String` (`member.ts:33`). Do not add Mongoose `required: true`: its validator rejects empty strings, so the `''` default would fail on every signup.
  - `MemberUpdate` / `MemberUpdateByAdmin` accept `memberImage` as optional. An explicit `null` would be `$set` into the document and then break the non-null GraphQL field. "Remove image" must send `''`, and the service should reject or convert `null`.
  - `docs/agentshub-er.md` is updated: the note now says empty means no image.
  - Every client must handle `''` (audit Step 12).

## D-16 — What `PAUSED` means for products

**Status:** Accepted

- **Context:** `ProductStatus` adds `PAUSED`, but nothing defines how it behaves. Current Nestar logic:
  - `getProperty` and `updateProperty` only match `ACTIVE` (`property.service.ts:55,84`), so a paused product could never be re-activated.
  - The member counter is decremented on `SOLD`/`DELETE`.
  - `getFavorities` and `getVisited` don't filter by status at all, so they would also return paused and deleted products.

  (Audit: Step 6.)
- **Options:**
  - **A. `memberProducts` counts only `ACTIVE`** (−1 on pause, +1 on resume, −1 on delete from `ACTIVE`).
    - Pro: The profile count equals the number of visible listings. Creator ranking only rewards live listings.
    - Con: The counter changes on every `ACTIVE ↔ PAUSED` transition, plus delete-from-paused. More edge cases, and a higher risk of the counter drifting.
  - **B. `memberProducts` counts all non-deleted products (`ACTIVE` + `PAUSED`).**
    - Pro: The counter changes only on create and delete, so there are few transitions and little risk of drift.
    - Con: The profile count can be higher than what visitors see. Ranking (D-17) rewards paused listings.
  - **C. `PAUSED` = "unlisted"**: hidden from lists, but still reachable by direct link and still in favorites. Counter as in B.
    - Pro: Existing links and favorites keep working.
    - Con: The meaning is vague ("paused" but still viewable), and views/likes keep accruing on a paused listing.
- **Visibility under A or B:**
  - hidden from `getProducts` and from favorites/visited for everyone except the owner
  - `getProduct` returns it only to the owner
  - `getCreatorProducts` shows it to the owner
  - `updateProduct` matches `productStatus ≠ DELETE`, so the product can be resumed
- **Recommendation:** **B** with the visibility rules above. The counter logic stays as simple as Nestar's, and favorites/visited need a status filter anyway (an existing gap).
- **Decision:** Option B, with these rules:
  - **Visibility:** a `PAUSED` product is visible only to its owner and to admins. It is excluded from:
    - public lists and search (`getProducts`)
    - other members' profiles (`getProducts` with a `memberId` filter)
    - rankings (batch)
    - favorites and visited (`getFavorities`, `getVisited`)

    `getProduct` returns it only when the caller is the owner or an `ADMIN`. Everyone else gets `NO_DATA_FOUND`, as if it did not exist.
  - **Interactions:** likes, views and comments are not allowed on a `PAUSED` product:
    - `likeTargetProduct` rejects it.
    - `getProduct` records no view and doesn't increment `productViews`, even for the owner.
    - `createComment` rejects a `PRODUCT` comment whose target is not `ACTIVE`.
  - **Transitions:**
    - The owner can switch `ACTIVE → PAUSED` and `PAUSED → ACTIVE`, and can delete from either state.
    - `DELETE` is final.
    - Owner updates match `productStatus ≠ DELETE`, not only `ACTIVE`.
  - **Counter:** `memberProducts` counts all non-deleted products (`ACTIVE` + `PAUSED`). It changes only on create (+1) and delete (−1, whether from `ACTIVE` or `PAUSED`), never on pause or unpause.
  - **Favorites/visited:** `getFavorities` and `getVisited` return only `ACTIVE` products. This fixes an existing bug and applies regardless of this decision.
  - **Comment reads:** `getComments` on a `PRODUCT` target follows the product's visibility.
    - If the product is `PAUSED`, comments are returned only to the owner and admins.
    - Everyone else gets the same result as for a missing product: `NO_DATA_FOUND`.
- **Principle:** child records inherit the visibility of their parent. Whoever cannot see a product cannot see its comments, likes or views either. Apply the same rule to any future child record (e.g. notifications pointing to a product).
- **Known trade-off:** a public profile count (`memberProducts`) can be higher than the number of products a guest sees. Creator ranking (`memberProducts*5`) also counts paused listings. Both are acceptable for the MVP. *(The creator-ranking part no longer applies: D-22 removes `memberProducts` from the creator rank.)*
- **Consequence / notes for implementation:**
  - **Filter position:** the favorites/visited status filter must run **before** `$facet`, so `metaCounter` counts only the `ACTIVE` products returned.
  - **Unlike is blocked too:** because likes are rejected on paused products, a member can't remove an existing like while the product is paused. The like is hidden anyway, since favorites only show `ACTIVE`.
  - **`getComments` needs the target type.** Today `CommentsInquiry.search` holds only `commentRefId`, so the service can't tell whether the target is a product. To apply the visibility rule, the search needs the `commentGroup`, and the resolver needs the caller's `memberType` (for the admin check), not only `_id`. Without the group, a paused product with zero comments would return an empty list instead of `NO_DATA_FOUND`, which breaks "same result as missing".
  - **Behaviour change for missing products:** `getComments` on a missing or deleted product currently returns an empty list. Under this rule it returns `NO_DATA_FOUND`.
  - **Rank rollback:** the nightly rollback should reset `productRank` for all non-deleted products, not only `ACTIVE` ones. Otherwise a reactivated product keeps the rank it had before it was paused until the next rollback.

## D-17 — Should `productComments` count in product ranking?

**Status:** Accepted

- **Context:** The batch ranks products as `likes*2 + views*1` (`batch.service.ts:48`). Products also have `productComments`. Likes and views are unique per member (unique index), but comments are not. The comment counter is also never decremented: `removeCommentByAdmin` and deleting via `updateComment` leave it as is. (Audit: Step 10.)
- **Options:**
  - **A. Keep `likes*2 + views*1`.**
    - Pro: Same as Nestar and already working. Cannot be inflated by one member.
    - Con: Ignores discussion as a signal of interest.
  - **B. Add comments, e.g. `likes*2 + comments*2 + views*1`.**
    - Pro: Rewards products that get discussion.
    - Con: One member can spam comments to raise a rank, and the counter only goes up today.
  - **C. Add the number of *unique commenters*, computed by aggregation in the batch.**
    - Pro: Rewards discussion and resists spam.
    - Con: The batch has to run an extra aggregation over `comments`, which is slower and more code.
- **Recommendation:** **A** for the MVP. Adding a non-unique counter makes ranking easy to game. Revisit with C after the comment counter decrement is fixed.
- **Decision:** Option A. Product ranking uses only likes and views, never comments.
- **Principle:** a ranking signal must not be inflatable by a single member.
  - Likes and views are unique per `{ refId, memberId }`. `Like.model.ts:26` and `View.model.ts:26` have unique indexes on `{ memberId, likeRefId }` / `{ memberId, viewRefId }`.
  - Comments are not unique: `Comment.model.ts` has no index, so one member can comment any number of times.
  - The comment counter never decreases on delete.
- **Formula today** (checked in `apps/nestar-batch/src/batch.service.ts`):
  - Product rank (line 48): `propertyLikes * 2 + propertyViews * 1`, computed only for `propertyStatus: ACTIVE` products with `propertyRank: 0` (lines 40–43). Fields used: `propertyLikes` and `propertyViews`. `propertyComments` is **not** used.
  - The formula already matches this decision. Step 10 only renames the fields to `productLikes * 2 + productViews * 1`. No weights or fields change.
- **Scope:** this decision covers product ranking only. Creator ranking is decided in D-22, which applies the same principle.
- **Consequence:**
  - Option C (counting unique commenters) can replace this later as a new decision that supersedes D-17.
  - Product ranking never reads `productComments`, so the missing decrement on comment delete doesn't affect ranking.

## D-18 — Like/View index order and `notificationDesc` vs. the ER doc

**Status:** Accepted

- **Context:** The code differs from the ER doc in two places (audit: Step 8):
  1. The Like and View unique indexes are `{ memberId, likeRefId }` / `{ memberId, viewRefId }`, while the ER doc says `{ likeRefId, memberId }` / `{ viewRefId, memberId }`. Uniqueness is the same either way. What differs is which queries can use the index prefix:
     - `getFavorities` and `getVisited` match on `memberId`, so memberId-first serves them.
     - "Who liked this target" would need refId-first, but no such query exists yet.
     - The toggle/existence checks use both fields, so either order works for them.
  2. `notificationDesc` is optional in the schema but NN in the ER doc. There is no notification module yet.
- **Options:**
  - **A. Change the code to match the ER doc** (refId-first indexes, `notificationDesc` required).
    - Pro: The code matches the source of truth, with no doc edits.
    - Con: Favorites/visited queries lose their index prefix and scan more as data grows. Existing indexes must be dropped and rebuilt. Every notification needs a description, even when the title says enough.
  - **B. Change the ER doc to match the code** (memberId-first indexes, `notificationDesc` optional).
    - Pro: Indexes match the queries that actually run. Nothing to rebuild.
    - Con: An ER doc edit plus a note here explaining why.
  - **C. Keep memberId-first unique indexes and add refId-first secondary indexes. Decide `notificationDesc` separately.**
    - Pro: Serves both kinds of query.
    - Con: Extra write cost and storage for an index that no current query uses.
- **Recommendation:** **B.** Indexes should follow real query patterns. A required description adds nothing for short notifications like "X liked your product".
- **Decision:** decided in two parts, field by field. It is not a blanket "the doc follows the code".
  1. **Like/View unique index order: keep the code.** The indexes stay `{ memberId: 1, likeRefId: 1 }` (`Like.model.ts:26`) and `{ memberId: 1, viewRefId: 1 }` (`View.model.ts:26`). `docs/agentshub-er.md` is updated to match.
     - **Reason:** MongoDB uses a compound index by prefix. With `memberId` first, the same index serves both:
       - the favorites/visited queries, which match by `memberId` (`like.service.ts:48`, `view.service.ts:32`)
       - the "already liked/viewed" checks, which match both fields (`like.service.ts:18,41`, `view.service.ts:26`)
     - No current query filters by `likeRefId` / `viewRefId` alone, so a refId-first index would serve nothing extra.
  2. **Required vs. optional, per field:**
     - **`notificationDesc`: optional.** The title can be enough ("X liked your product"). The **ER doc** is fixed (NN removed), and `Notification.model.ts:29–31` stays as it is.
     - **`productDesc`: required.** A listing without a description is useless to buyers, and semantic search (D-11) will rely on it later. The **code** is fixed in step 6 (schema `required: true`, plus `ProductInput` validation). The ER doc (NN) stays as it is.
- **Principle:** when code and docs disagree, choose what is right for the product, not whichever was written first.
- **Consequence:**
  - **Future refId-only queries:** if a query that filters by `likeRefId` / `viewRefId` alone is added later (e.g. "who liked this product", or cleaning up likes when a product is removed), add a separate secondary index for it in that step.
  - **Updates must not clear `productDesc`:** `ProductUpdate` keeps `productDesc` optional, but must not allow clearing it.
    - `@IsOptional()` lets `null` through, and the service would `$set` it.
    - Reject `null` and empty strings on update, the same pattern as `memberImage` in D-15.
  - **GraphQL type:** the `Product` output type exposes `productDesc` as non-null `String`.

## D-19 — Keep or remove the WebSocket chat

**Status:** Accepted

- **Context:** `api/socket/` runs a public broadcast chat (registered in `app.module.ts`, with `WsAdapter` in `main.ts`). D-08 says there is no in-platform chat in the MVP. The gateway also broadcasts `memberData` (the full JWT payload) to every connected client, guests included. Once `memberEmail`/`memberWhatsapp` are added, that leaks contact details and breaks D-07. `@nestjs/platform-socket.io` is installed but not used. (Audit: Step 8.)
- **Options:**
  - **A. Remove it**: delete `socket/`, the `WsAdapter`, and the unused WebSocket dependencies.
    - Pro: Matches D-08, removes the D-07 leak and a guest-writable endpoint, and the code is smaller.
    - Con: Working code is removed, and it has to be rebuilt (or restored from git history) if chat comes back.
  - **B. Disable it**: stop importing `SocketModule` but keep the files.
    - Pro: Easy to turn back on.
    - Con: Dead code and a Nestar leftover. The leak returns as soon as someone re-enables it.
  - **C. Keep it running and repurpose it later** (e.g. live notifications). Strip contact fields from `memberData` now.
    - Pro: Real-time infrastructure is ready for future features.
    - Con: Contradicts D-08 unless D-08 is superseded. It must be fixed for D-07 now, and guests can still post.
- **Recommendation:** **A.** D-08 already rules chat out, the gateway would break D-07, and git history keeps the code if a later decision brings real-time features back.
- **Current chat** (checked in code; paths under `apps/nestar-api/src/`):
  - **Wiring:** `SocketGateway` in `socket/socket.gateway.ts`, registered by `SocketModule` (`app.module.ts:12,41`). It runs on the API's own HTTP server through `WsAdapter` (`main.ts:7,20`), with `@WebSocketGateway({ transports: ['websocket'], secure: false })` (`socket.gateway.ts:28`). There is no separate port or path.
  - **Who can connect:** anyone. `handleConnection` (55–73) accepts every connection. If there is no token, or it is invalid, `retrieveAuth` returns `null` (50–52) and the client joins as a guest.
  - **How the member is identified:**
    - The JWT comes from the `?token=` query string of the connection URL (46–47) and is checked with `AuthService.verifyToken` (49). That is a signature check only, with no database lookup.
    - The decoded payload is kept per socket in `clientsAuthMap` (32, 58).
    - The token payload is the **whole member document except `memberPassword`** (`auth.service.ts:24–28`).
  - **What is broadcast:**
    - On connect, an `info` event (`totalClients`, `action: 'joined'`, `memberData`) goes to **all** clients (63–70). The new client then gets `getMessages` with the stored history (72).
    - On disconnect, an `info` event (`action: 'left'`) goes to everyone except the leaver (83–90).
    - On `message`, `{ event: 'message', text, memberData }` goes to all clients (93–104).
    - In every case `memberData` is the **full token payload** (18, 24, 66, 86, 96). Today that already exposes `memberPhone`, `memberStatus`, counters, etc. to guests. After Step 5 it would expose `memberEmail` / `memberWhatsapp` too.
  - **Storage:** in memory only. `messagesList` keeps the last 5 messages (33, 101–102). They are lost on restart and not shared between server instances. No database collection exists.
  - **Limits:** none.
    - **Guests can send messages:** `handleMessage` doesn't check `authMember`, so guest messages get `memberData: null`.
    - **No input checks:** the payload is not checked for type, emptiness or length (94–96).
    - **No rate limit.**
    - **Full text is logged:** every message is logged in full (99).
- **Decision:** **Keep the WebSocket chat** as the community chat (closest to option C, without the "repurpose" part). This partly supersedes D-08. It is kept only under these conditions:
  1. **Public fields only:** broadcast payloads contain only `_id`, `memberNick`, `memberImage` and `memberType`. They never contain `memberEmail`, `memberWhatsapp`, `memberPhone` or the full token payload (D-07). This applies to `message`, `info` (joined/left) and the `getMessages` history.
  2. **Authenticated senders:** the token is verified on connection, and only authenticated members can send messages. Guests can only read.
  3. **Message validation:** the text must be a string. It is trimmed, must not be empty, and is at most 500 characters.
  4. **Rate limit:** at most 1 message per second per member. Count it per member `_id`, not per socket, so opening several connections doesn't bypass it.
  5. **Plain text in the frontend:** messages are rendered as plain text, never as HTML.
  6. **Scope:** this is the existing community chat only. A 1:1 creator–user chat is not part of the MVP and needs its own decision later.
  7. **Member status checked on connection:** after verifying the token, load the member from the database by the token's `_id`.
     - If the member is missing, or `memberStatus` is not `ACTIVE` (`BLOCK` or `DELETE`), treat the connection as a guest: read-only, with no sender identity stored.
     - The public fields from condition 1 come from this database record, not from the token. That way a changed nick or image shows up without a new login.
- **Reason:** owner decision: the community chat already works and adds value. The conditions remove its security problems: the D-07 leak, guest spam, unbounded input, XSS, and blocked members still posting.
- **Accepted risks:**
  - **The token is in the connection URL** (`?token=`, `socket.gateway.ts:46–47`). This is accepted for the MVP.
    - **Reason:** the browser WebSocket API cannot send an `Authorization` header, so the URL is the practical way to pass the token at connection time.
    - **Mitigation:** never log the socket connection URL, in application code or anywhere else the team controls. The current code doesn't log it: it only parses it at line 46, and the logs show just the nick. Keep it that way. When deploying behind a reverse proxy, make sure its access logs don't record the query string of the socket endpoint.
  - **The status check runs only at connection time.** A member who is blocked while connected can keep sending until they disconnect. This is accepted for the MVP, because sessions are short-lived and reconnecting re-runs the check.
- **Consequence:**
  - **History stays in memory** (the last 5 messages), unchanged for the MVP. It is lost on restart and not shared between server instances. Persisting messages needs a separate decision, which would fully supersede D-08.
  - **`SocketModule` needs member access** for condition 7. Today it imports only `AuthModule` (`socket.module.ts`), so it must also get the `Member` model or `MemberService`.

## D-20 — When to fix the existing bugs found in the audit

**Status:** Accepted

- **Context:** The audit marks about a dozen `(bug)` items. They fall into two groups:
  - **Bugs in code the migration rewrites anyway:**
    - `removePropertyByAdmin`
    - the property enum fields exposed as `String`
    - the `updateProperty` ACTIVE-only match
    - `memberAdress`
  - **Bugs in code that survives the migration mostly unchanged:**
    - `Like.model` uses `ViewGroup`
    - the `MembersInquiry` search type
    - `ADMIN` allowed at signup
    - the upload path traversal
    - the comment counter targets the author
    - `createComment` doesn't validate the target
    - the board-article `meLiked` lookup
    - unescaped search regex
    - the broken batch e2e spec
- **Options:**
  - **A. Fix each bug in its own commit, inside the migration step that touches the file.**
    - Pro: Each file is opened once per step, and each fix is a small commit that is easy to review or revert.
    - Con: A step's changes mix bug fixes with conversion work. Bugs in files no step touches (board-article lookup, regex escaping) need a home. Security fixes wait until their step comes up.
  - **B. A separate step before the migration (e.g. "step 2b") that fixes all bugs on the current Nestar code.**
    - Pro: The conversion steps become pure renames and reshapes. Fixes can be checked against known Nestar behaviour.
    - Con: Wasted work on code that is about to be rewritten or deleted (e.g. `PropertyStatus.SOLD` paths, property DTOs). Files get touched twice.
  - **C. Hybrid.**
    - Bugs in code that survives the migration: fix them in a separate pre-migration step, one commit per bug.
    - Bugs in code being rewritten: fix them inside the step that rewrites it.
    - Pro: Security fixes (admin signup, path traversal) land first. No effort is spent on code that is about to disappear.
    - Con: Two rules to follow, and each bug needs a quick check of which group it belongs to (the audit lists already make that clear).
- **Recommendation:** **C.** The two security bugs shouldn't wait several steps, and fixing code that a later step replaces is wasted effort. Either way, use one commit per bug, so each fix can be reviewed and reverted on its own.
- **Decision:** Option C (hybrid).
  - **Step 2.5: pre-migration fixes**, a new step that runs before step 3. It fixes:
    - bugs in code that survives the migration (code that later steps only rename, or don't touch)
    - **all security holes**, wherever they are

    Security holes go first, in this order:
    1. admin signup (D-14)
    2. upload path traversal
    3. chat leaking member fields (D-19)
  - **Bugs in code that a later step rewrites** are fixed inside that step.
  - **One commit per fix:** every bug fix is its own commit, with the message format `fix: <what>`. A fix is never mixed with renames or migration changes.
  - **Verification for every fix:** each fix states what to run or call and the expected result (e.g. "signup with `memberType: ADMIN` → validation error"). It is checked before the commit.
- **Reason:** Security holes are closed before several migration steps go by, and no effort is spent fixing code that is about to be replaced. Separate `fix:` commits keep each fix reviewable and revertible, and they keep the migration diffs about the migration only.
- **Consequence:**
  - `docs/migration-audit.md` has a **Step 2.5** section listing each fix with its file:line, the fix and the verification. The remaining `(bug)` items stay in their steps, marked "fix in its own commit".
  - **Code that is fixed now and renamed later:** Step 2.5 fixes use today's names (e.g. `MemberType.AGENT`, `PropertyStatus.ACTIVE`, the `property` upload target). The later rename steps carry them over, so those steps must keep the fix intact (each affected step has a note).
  - This also sets when the code fixes for D-14, D-15 (`memberImage: null`), D-19 and D-22 (self-engagement on profiles) land: in Step 2.5.

## D-21 — Project name and naming rules

**Status:** Accepted

- **Context:** Several names were in use for the same project: "AgentHub" (in the docs), "Petoria" (`AGENTS.md`, `SKILLS.md`) and "Nestar" (code, config, database). One canonical name, with a fixed spelling for each context, prevents new drift.
- **Decision:** The project name is **AgentsHub**. Spell it like this:

  | Context | Spelling | Example |
  |---|---|---|
  | Prose, docs, UI | `AgentsHub` | "AgentsHub is a marketplace for AI agents." |
  | kebab-case (apps, packages, folders) | `agentshub` | `agentshub-api`, `agentshub-batch` |
  | PascalCase (classes) | `AgentsHub…` | `AgentsHubBatchModule` |
  | MongoDB dev database | `agentsHub` | `MONGODB_DEV=…/agentsHub` |

- **Reason:** The repo folder is already called `AgentsHub`. A single table removes guesswork when naming new files, classes and services.
- **Consequence:**
  - Docs were updated to these spellings, and the ER doc was renamed to `docs/agentshub-er.md`.
  - Code, config and `.env` still use the Nestar names until step 3 (D-12, D-13).
  - "Nestar" stays only where it refers to the original project, e.g. "copied from Nestar".
  - "AgentHub", "Petoria" and other variants should not be used anywhere.

## D-22 — Creator ranking

**Status:** Accepted

- **Context:** The batch ranks creators (Nestar: agents) as `memberProperties * 5 + memberArticles * 3 + memberLikes * 2 + memberViews * 1` (`apps/nestar-batch/src/batch.service.ts:66`). `memberProperties` (→ `memberProducts`) and `memberArticles` count the creator's **own** posts, so a creator can raise their rank alone just by posting more. This breaks the principle from D-17.
- **What `memberLikes` and `memberViews` count today** (checked in code): engagement the member **received**, but only on their **profile**.
  - `memberViews`: `MemberService.getMember` (`apps/nestar-api/src/components/member/member.service.ts:87–116`) records a `ViewGroup.MEMBER` view and runs `$inc: { memberViews: 1 }` on the **viewed** member (`search._id = targetId`, lines 88–89 and 101–105). This happens only when the viewer is logged in (line 99).
  - `memberLikes`: `MemberService.likeTargetMember` (`member.service.ts:148–164`) toggles a `LikeGroup.MEMBER` like and calls `memberStatsEditor({ _id: likeRefId, targetKey: 'memberLikes' })` (line 160). That is the **liked** member, not the liker.
  - No other code writes these fields; the only references are the schema, DTO, sort lists and batch. Likes and views on a creator's products go only to `propertyLikes` / `propertyViews` (`apps/nestar-api/src/components/property/property.service.ts:65,218`) and never roll up to the owner's `memberLikes` / `memberViews`.
  - Both are unique per `{ refId, memberId }` (D-17), so one other member adds at most +1 like and +1 view.
- **Options:**
  - **A. Keep the Nestar formula** (renamed to `memberProducts * 5 + memberArticles * 3 + memberLikes * 2 + memberViews * 1`).
    - Pro: No change.
    - Con: The two biggest weights are self-inflatable, which goes against D-17's principle.
  - **B. Use only engagement received from other members:** `memberLikes * 2 + memberViews * 1`.
    - Pro: Follows the principle. A one-line formula change, and the counters already exist.
    - Con: Reflects profile engagement only (see the consequences below).
  - **C. Like B, plus engagement received on the creator's products** (the sum of `productLikes` / `productViews` over their `ACTIVE` products).
    - Pro: Rewards creators whose products are popular, not only their profile.
    - Con: An extra aggregation over `products` per creator in the batch.
- **Decision:** Option B. Creator rank uses only engagement received from other members, never the creator's own post counts (`memberProducts`, `memberArticles`). Same principle as D-17: a ranking signal must not be inflatable by a single member.
  - Formula: **`memberLikes * 2 + memberViews * 1`**.
- **Consequence:**
  - **Step 10:** `batchCreators` drops `memberProducts` and `memberArticles` from the formula. `memberProducts` stays as a profile counter (D-16) but is not a ranking signal.
  - **Profile-only signal:** the rank reflects engagement on the creator's *profile*, not on their products. A creator with popular products but few profile visits ranks low. Option C would close this gap; it can be adopted later as a new decision that supersedes D-22.
  - **Self-engagement is counted** (existing bug):
    - Neither `getMember` (line 99) nor `likeTargetMember` (line 148) checks that the caller is not the target, so a creator can add +1 view and +1 like to their own profile. The unique index caps it at +1 each.
    - The same applies to a creator's own products (`property.service.ts:61` view; `likeTargetProperty` at 206 has no owner check).
    - Excluding self-views and self-likes fully satisfies the principle. Track this as a bug under D-20.
  - **Creator rank no longer depends on product status,** so the D-16 trade-off that "creator ranking counts paused listings" no longer applies.

## D-23 — How contact visibility (D-07) is enforced

**Status:** Accepted

- **Context:** D-07 says guests get `memberEmail` / `memberWhatsapp` as `null` and leaves the approach to Step 9. A `Member` reaches responses through many paths: `getMember`, `Members.list`, member-returning mutations, and every `$lookup` that embeds `memberData` / `followerData` / `followingData` (audit Step 9 lists them). The route guards don't help: they set `authMember` on `req.body` only for guarded operations, and `signup` / `login` have none.
- **Options:**
  - **A. One field resolver per contact field** on a `@Resolver(() => Member)` class.
    - Pro: GraphQL runs it for every `Member` object however it was loaded, so existing and future queries are covered with no per-query code.
    - Con: Runs once per `Member` per field, so the token check must be cached per request.
  - **B. A response serializer / interceptor** that walks the result and nulls the fields for guests.
    - Pro: Also one place.
    - Con: Has to know every nesting shape; it walks the whole result instead of only the selected fields.
  - **C. `$project` per query / lookup.**
    - Con: Easy to miss a path. Rejected by the audit.
- **Decision:** Option A. `MemberContactResolver` (`components/member/member-contact.resolver.ts`) resolves `memberEmail` and `memberWhatsapp`.
  - It reads the `Authorization` header from the GraphQL context request and checks it with `AuthService.verifyToken`. It never trusts `req.body.authMember`, which a client can set on unguarded operations.
  - A valid token is not enough: the caller's **current `memberStatus` in the database must be `ACTIVE`**. The resolver loads it with one `exists({ _id, memberStatus: ACTIVE })` query.
  - The token check and the status lookup run **once per request**: the pending promise is cached in a `WeakMap` keyed by the request, so 50 members in a list share one verification and one DB read.
  - A missing, invalid or expired token, or a member who is `BLOCK`, `DELETE` or no longer exists, means guest (`null`), never an error.
- **Open questions, answered:**
  - **Blocked / deleted members with a valid token** get `null`, the same as guests. After S9 the token has no `memberStatus`, so the status is read from the database (once per request, see above). This is the same rule as the chat connection check (S4: `findOne({ _id, memberStatus: ACTIVE })`). It is stricter than the route guards, which still accept any valid token; changing the guards is out of scope here.
  - **Own data in `signup` / `login`:** the request has no token yet, so the contacts come back `null`. Accepted: one rule with no exceptions, and the client loads them with `getMember` and the new `accessToken` afterwards. `signup` can't set contacts anyway (`MemberInput` has no contact fields). `updateMember` is called with a token, so an `ACTIVE` caller gets their own contacts back.
- **Consequence:** Every request that returns contact fields with a token costs one extra `members` read (by `_id`, so it uses the primary index). New queries that return a `Member` need nothing extra. Code outside GraphQL (JWT payload, socket `memberData`) must keep omitting the contacts (S9, S3).

## D-24 — How a member's password is changed

**Status:** Accepted

- **Context:** `memberPassword` is a field of both update inputs, `MemberUpdate` (`updateMember`) and `MemberUpdateByAdmin` (`updateMemberByAdmin`). Both services `$set` the input as it is, and only `signup` hashes the password. So a changed password is stored as plain text, and the member can't log in afterwards (audit S11). Hashing it in the update would fix the storage, but two problems would remain:
  - `updateMember` would change the password with only a token, without the current password.
  - An admin could set any member's password and would know it.
- **Options:**
  - **A. Keep `memberPassword` in both update inputs, and hash it in the services.**
    - Pro: The smallest change; no new mutation.
    - Con: No re-authentication, so a stolen or forgotten-open session is enough to take over the account. Admins still choose and know members' passwords.
  - **B. Remove `memberPassword` from both update inputs, and add a dedicated `changePassword` mutation that requires the current password. No admin password setting.**
    - Pro: Re-authentication, and admins never know a password. Password handling lives in one method.
    - Con: A breaking API change, and the MVP has no way to recover a forgotten password.
- **Decision:** Option B.
  - `memberPassword` is removed from `MemberUpdate` and `MemberUpdateByAdmin`.
  - New mutation `changePassword(input: { currentPassword, newPassword })` for the logged-in member. It:
    - verifies the current password with bcrypt;
    - validates the new password with the same rules as signup;
    - hashes the new password and saves it.
  - There is no admin password setting in the MVP.
- **Reason:**
  - **Re-authentication:** changing the password is the most sensitive account action. A valid token alone (possibly stolen, or on a shared device) must not be enough; the member proves they know the current password.
  - **Admins must not know passwords:** an admin who sets a password knows it and can log in as that member, and members can't tell. The admin's tools (status, block) are enough for moderation.
  - **One place for password rules:** hashing and validation live in one service method, so an update path can't store a password unhashed again.
- **Consequence:**
  - `updateMember` / `updateMemberByAdmin` with `memberPassword` fail GraphQL validation (a frontend change; Step 12 table).
  - **No password recovery in the MVP:** a member who forgets their password can't reset it, and admins can't either. A reset flow (e.g. an emailed one-time link) needs its own decision later.
  - **Existing tokens stay valid:** the JWT has no password or version claim (S9), so changing the password doesn't log out other sessions until their tokens expire (30 days). Revoking tokens on a password change would need its own decision.
  - Dev members whose password was set through the old update path hold a plain-text value and can't log in. They are found with a read-only check (`memberPassword` not a bcrypt hash).

## D-25 — Phone number format

**Status:** Accepted

- **Context:** `memberPhone` is required and unique (`Member.model.ts`), but it has no format rule. Signup accepts any non-empty string, and the update inputs accepted any string, including `''` (audit B12). `memberWhatsapp` already uses E.164 since Step 5 part 2. The Nestar dev data holds Korean local numbers like `010…`.
- **Options:**
  - **A. Korean local format (`010…`).**
    - Pro: Matches the existing Nestar dev data.
    - Con: AgentsHub is international; a local format can't hold other countries' numbers. **Rejected.**
  - **B. International E.164 (`+`, country code, digits only, 8–15 digits), the same rule as `memberWhatsapp`.**
    - Pro: Works for every country. One format for both phone fields. Unambiguous.
    - Con: Existing dev numbers don't match.
  - **C. No format, only non-empty.**
    - Pro: No change for anyone.
    - Con: Junk values, and the same number in different spellings (`+998 90…`, `99890…`) passes the unique index as different values. **Rejected.**
- **Decision:** Option B. `memberPhone` uses E.164: `+`, a country code without a leading 0, digits only, 8–15 digits in total (e.g. `+998901234567`). It is the same rule, and the same shared regex constant, as `memberWhatsapp`. It is checked at signup and in both member update inputs.
- **Reason:**
  - **AgentsHub is international:** creators and users come from any country.
  - **One format for both phone fields:** `memberPhone` and `memberWhatsapp` follow one rule, and one constant enforces it.
  - **The unique index really prevents duplicates:** E.164 has one canonical spelling per number (no spaces, dashes or local prefixes), so the same number can't be registered twice in different spellings.
  - **SMS / OTP services expect E.164,** so phone verification can be added later without converting numbers.
- **Consequence:**
  - **Existing dev members with `010…` numbers keep working:** login uses the nick, not the phone, and reads don't validate the stored value. They must send an E.164 number the next time they update their phone.
  - **The seed script** creates E.164 numbers.
  - Clients must send the number already in E.164. The API checks the format but doesn't reformat (no stripping of spaces or dashes).

## D-26 — Password policy

**Status:** Accepted

- **Context:** Passwords must be 5–12 characters at signup, at login and in `changePassword` (`@Length(5, 12)`). Five characters is too weak, and the 12-character maximum blocks passphrases and the long random passwords that password managers generate (audit S13). Passwords are hashed with bcrypt, which only uses the first **72 bytes** of the input and silently ignores the rest.
- **Options:**
  - **A. Keep 5–12 characters.**
    - Con: Too weak, and it blocks passphrases and password managers. **Rejected.**
  - **B. Min 8 characters, max 72 bytes, no composition rules.**
    - Pro: Allows passphrases and generated passwords. The maximum matches what bcrypt actually uses.
    - Con: Existing passwords of 5–7 characters no longer meet the rule. Handled below: login doesn't check length.
  - **C. Composition rules** (an upper-case letter, a digit and a symbol are required).
    - Con: Pushes people towards predictable patterns (`Password1!`) and against passphrases; current guidance (e.g. NIST SP 800-63B) advises against them. **Rejected.**
- **Decision:** Option B.
  - **New passwords** (`signup.memberPassword` and `changePassword.newPassword`): at least **8 characters** and at most **72 bytes** in UTF-8, with no composition rules.
  - **Existing passwords** (`login.memberPassword` and `changePassword.currentPassword`): only a non-empty check. Login doesn't apply the length rule, so every existing password keeps working.
- **Reason:**
  - **Length matters more than composition:** a long passphrase is stronger and easier to remember than a short mixed one.
  - **Max in bytes, not characters:** bcrypt's limit is 72 bytes. A longer password would be silently truncated, so two different passwords sharing the first 72 bytes would both log in. Rejecting it is clearer than truncating it.
  - **Login stays permissive:** the rule applies only when a password is set, so no existing member is locked out.
- **Consequence:**
  - **Existing members with 5–7 character passwords** still log in. They must choose a password that meets the new rule the next time they change it.
  - **Non-Latin passwords:** 72 bytes is fewer than 72 characters (e.g. 36 Cyrillic letters, 18 emoji). The error message says so.
  - **Login has no upper length limit.** bcrypt's work doesn't grow with input length (it only uses the first 72 bytes), and the request body size limit still applies (NestJS / Express default: 100 kB for JSON).
  - The limits are constants in `api/libs/config.ts`, with one message each for "too short" and "too long".

## D-27 — Login must not reveal whether a nick exists

**Status:** Accepted

- **Context:** `login` answered differently depending on the account (audit B15):
  - an unknown nick, a `DELETE` member or a member without a stored password → `NO_MEMBER_NICK`;
  - a wrong password → `WRONG_PASSWORD`;
  - a `BLOCK` member → `BLOCKED_USER`, checked **before** the password.

  So anyone could find out whether a nick has an account and whether it is blocked, without knowing any password. There was also a timing leak: for an unknown nick, bcrypt never ran, so the answer came noticeably faster. Nicks themselves are public (`getMember`, `getCreators`), so what this protects is account status and the login surface (no list of "nicks worth guessing passwords for").
- **Options:**
  - **A. Keep the separate messages.**
    - Pro: Slightly more helpful for a member who mistyped their nick.
    - Con: User enumeration through the message, the timing and the blocked status. **Rejected.**
  - **B. One message for every failed login, a constant-time path, and the block status only after a correct password.**
    - Pro: The response and its timing are the same for an unknown nick and a wrong password. A blocked member still learns why they can't log in, but only once they prove they own the account.
    - Con: A member who mistyped their nick gets a less specific message. One extra bcrypt compare (~60–100 ms) per failed login with an unknown nick.
- **Decision:** Option B.
  - An unknown nick, a `DELETE` member, a member without a stored password and a wrong password all return `UnauthorizedException(INVALID_CREDENTIALS)` ("Wrong member nick or password!", code `UNAUTHENTICATED`).
  - `login` always runs one bcrypt compare. When there is no usable stored hash, it compares against a fixed dummy hash (`dummyPasswordHash` in `api/libs/config.ts`, same cost as `bcrypt.genSalt()`'s default, 10).
  - `BLOCK` is checked only after the password matches → `ForbiddenException(BLOCKED_USER)` (code `FORBIDDEN`).
- **Reason:** Different messages and different response times leak the same fact. Fixing only one leaves the other open. Checking the block status after the password keeps it private from strangers without hiding it from the account owner.
- **Consequence:**
  - `NO_MEMBER_NICK` is removed. `WRONG_PASSWORD` stays for `changePassword`, where the caller is already authenticated.
  - If the bcrypt cost of `hashPassword` changes, `dummyPasswordHash` must be regenerated with the same cost, or the timing difference returns.
  - `signup` still answers `USED_MEMBER_NICK_OR_PHONE` for a taken nick. That's unavoidable for a unique, public nick and is not covered by this decision.
  - Frontend: show the one login error message; there is no separate "unknown nick" state any more (Step 12 table).

## D-28 — Which board articles an admin can hard-delete

**Status:** Accepted

- **Context:** `removeBoardArticleByAdmin` hard-deleted an article only while it was `ACTIVE`, in one call (audit B15). This had three problems:
  - the author's `memberArticles` was never decremented, so it stayed one too high for good (only the update to `DELETE` decrements it);
  - an article already set to `DELETE`, by its owner or an admin, could never be removed;
  - it was the opposite of `removeProductByAdmin`, which removes only products already set to `DELETE` (Step 6 part 1).
- **Options:**
  - **A. Same rule as products:** only `DELETE` articles can be removed. An admin first runs `updateBoardArticleByAdmin` → `DELETE`, then `removeBoardArticleByAdmin`.
    - Pro: One rule for every admin remove. The counter stays correct with no extra code, because the decrement already happens on the soft delete. A live article can't be wiped by a single call. Soft-deleted articles can finally be purged.
    - Con: Moderation takes two calls. An admin UI that removed `ACTIVE` articles directly stops working.
  - **B. One-step hard delete of `ACTIVE` or `DELETE` articles,** decrementing `memberArticles` when the removed article was `ACTIVE`.
    - Pro: Fast one-call moderation (e.g. spam). Old `DELETE` articles can be removed too.
    - Con: A different rule from products. A live article can be wiped irreversibly by one call. The counter logic needs two branches.
- **Decision:** Option A.
- **Reason:** One rule for every admin remove is easier to reason about and to build an admin UI for. The two-step flow makes the irreversible step deliberate, and it keeps the counter correct by reusing the existing decrement instead of adding a second one.
- **Consequence:**
  - `removeBoardArticleByAdmin` matches `{ _id, articleStatus: DELETE }`. An `ACTIVE` article returns `NOT_FOUND` (`REMOVE_FAILED`).
  - No counter change in the remove itself.
  - Admin UI: soft-delete first, then remove (Step 12 table).
  - Comments and likes on a hard-deleted article (or product) are left behind. Cleaning them up is a separate issue, not covered here.

## D-29 — Which product status changes an admin can make

**Status:** Accepted

- **Context:** D-16 defines the owner's status changes (`ACTIVE ↔ PAUSED`, `ACTIVE | PAUSED → DELETE`, `DELETE` final) but not the admin's. `updateProductByAdmin` matched only `ACTIVE` products, so an admin could not touch a paused product, and `PAUSED` could not be set at all until Step 6 part 15.
- **Options:**
  - **A. The same transitions as the owner** (pause, resume, delete), on any non-deleted product.
    - Pro: One transition table for both paths. An admin can take a listing offline temporarily (`PAUSED`) instead of deleting it, and the owner can see and fix it.
    - Con: An admin can resume a product the owner paused.
  - **B. Admins may only delete,** and edit fields.
    - Pro: Pausing stays the owner's choice.
    - Con: Moderation has only the irreversible option.
- **Decision:** Option A.
- **Reason:** Moderation needs a reversible step. Sharing the owner's rules keeps one code path and one counter rule.
- **Consequence:**
  - `updateProduct` and `updateProductByAdmin` share one update path: they match `productStatus ≠ DELETE` (a deleted product → `NOT_FOUND` `UPDATE_FAILED`, the same as a missing one) and apply the D-16 transitions.
  - Sending the current status again is no change, not an error. Any other transition → `BAD_REQUEST` `INVALID_PRODUCT_STATUS_CHANGE`.
  - `memberProducts` of the owner is decremented only on a change to `DELETE` (D-16), whoever makes it.
  - The write is pinned to the status that was read, so a concurrent change (e.g. two `DELETE`s) makes the later call fail with `NOT_FOUND` `UPDATE_FAILED` and the counter is decremented once.
  - Admins have no separate "locked by admin" state: an owner can resume a product an admin paused. If that becomes a problem, add a moderation state as a new decision.

## D-30 — Brief lifecycle and visibility

**Status:** Accepted

- **Context:** The ER doc defines `BriefStatus` (`OPEN`, `CLOSED`, `DELETE`) and `closedAt`, and ER rule 2 says only `USER` members create, update, close or delete briefs. Nothing defines who can see a `CLOSED` brief, whether it can be reopened, what an admin may change, or what `memberBriefs` counts. D-16 and D-29 answer these questions for products only. (Audit: Step 7.)
- **Options:**
  - **A. `CLOSED` is public and reversible.** A closed brief stays readable by link, drops out of the default public list, and the owner can reopen it.
    - Pro: Shared links and creators' bookmarks keep working, and creators can see the need was filled. A user who closed a brief by mistake, or whose deal fell through, reopens it instead of re-posting.
    - Con: Two visibility levels for non-deleted briefs (public list vs. direct link), and one more transition to check.
  - **B. `CLOSED` is owner/admin-only and final**, like a `PAUSED` product that can't be resumed.
    - Pro: The simplest rule: everyone else sees only `OPEN`.
    - Con: Links to a closed brief break (`NO_DATA_FOUND`). Reopening means re-posting, which loses views and comments.
- **Decision:** Option A, with these rules:
  - **Visibility** (one `isBriefVisible()` check, used everywhere a brief or its child records are read; D-16 principle):
    - `OPEN` and `CLOSED`: visible to everyone, guests included, through `getBrief`.
    - `DELETE`: visible to nobody through `getBrief`, the owner and admins included. Admins see deleted briefs only in `getAllBriefsByAdmin`. A hidden brief answers exactly like a missing one (`NOT_FOUND` / `NO_DATA_FOUND`).
    - `getBriefs` (public, also used for other members' profiles) returns only `OPEN` by default. An optional `search.briefStatus` accepts `OPEN` or `CLOSED`; `DELETE` is rejected (`BAD_REQUEST`).
    - `getMyBriefs` (owner) returns `OPEN` and `CLOSED`; asking for `DELETE` → `BAD_REQUEST`, as in `getCreatorProducts`.
    - `getAllBriefsByAdmin` returns every status.
  - **Transitions** (the same table for `updateBrief` and `updateBriefByAdmin`, as in D-29):
    - `OPEN → CLOSED` sets `closedAt`.
    - `CLOSED → OPEN` (reopen) unsets `closedAt`. The deadline rule applies to reopening (D-31).
    - `OPEN | CLOSED → DELETE` sets `deletedAt`.
    - `DELETE` is final: updates match `briefStatus ≠ DELETE`, so a deleted brief → `NOT_FOUND` `UPDATE_FAILED`, like a missing one.
    - Sending the current status again is no change, not an error (as in D-29). Any other transition → `BAD_REQUEST`.
    - The write is pinned to the status that was read, so a concurrent change (e.g. two `DELETE`s) makes the later call fail with `NOT_FOUND` `UPDATE_FAILED`.
  - **Editing:** the fields of a `CLOSED` brief can be edited, like a paused product's.
  - **Counter:** `memberBriefs` counts `OPEN` + `CLOSED`. It changes only on create (+1) and on a change to `DELETE` (−1, from either status, whoever makes it), never on close or reopen.
  - **Views:** a view is recorded only on an `OPEN` brief, only for a logged-in member who is not the owner (D-22), and it increments `briefViews` once per member (D-18 unique index). Opening a `CLOSED` brief records no view.
  - **Admin remove:** `removeBriefByAdmin` hard-deletes only briefs already `DELETE`, with no counter change (D-28 principle).
- **Reason:** Closing a brief means "this need is filled", not "this is private". Keeping it readable costs nothing and keeps links working, while the default list stays focused on open needs. The transition table, counter rule and compare-and-set write reuse the product rules (D-16, D-29), so there is one pattern for both modules.
- **Consequence:**
  - `Message.BRIEF_ALREADY_CLOSED` is no longer needed (same status = no change) and is removed if nothing uses it (Step 7 part 2). A new message covers an invalid brief status change.
  - **Step 8:** comments on a brief follow `isBriefVisible()` for reads. New comments are allowed only on an `OPEN` brief; the comments of a `CLOSED` brief stay readable.
  - **Frontend (Step 12 table):** show a "closed" badge and hide the comment box on closed briefs; the owner gets close / reopen / delete buttons; the admin UI removes a brief in two steps (soft delete, then remove).
  - A brief is not closed automatically when its deadline passes (D-05).

## D-31 — When `briefDeadline` is checked on update

**Status:** Accepted

- **Context:** D-05 says a deadline must be later than the current time "when the brief is created or updated". Read literally, every update re-checks the stored deadline, so once the deadline has passed the owner could not even fix a typo in the title or close the brief. D-30 also adds reopening, which can bring back a brief whose deadline has passed.
- **Options:**
  - **A. Check every update** against the final deadline (stored value merged with the input).
    - Pro: No brief is ever saved with a past deadline.
    - Con: A brief with a passed deadline can't be edited, closed or deleted without also changing the deadline. Closing and deleting must not depend on the deadline.
  - **B. Check only when the input sets `briefDeadline`, and when reopening.**
    - Pro: Ordinary edits, closing and deleting always work. A brief can't come back to `OPEN` with a past deadline.
    - Con: An `OPEN` brief can still have a past deadline after time passes (already accepted by D-05, which has no auto-close).
- **Decision:** Option B. This clarifies D-05; it does not supersede it.
  - `createBrief`: `briefDeadline`, if given, must be in the future.
  - Update with a `briefDeadline` value in the input: it must be in the future. `null` clears it and is always allowed.
  - Update that reopens (`CLOSED → OPEN`): the **final** deadline (the input value if sent, otherwise the stored one) must be empty or in the future. A user reopening a brief whose deadline has passed sends a new deadline or `null` in the same call.
  - Any other update doesn't look at the stored deadline.
  - Error: `BAD_REQUEST` `DEADLINE_IN_PAST`. The check lives in one service method (`checkDeadlineRule`), used by create and by the shared owner/admin update path.
- **Reason:** The rule exists to stop data errors at the moment a date is entered or a brief goes live again, not to lock old briefs.
- **Consequence:**
  - "Now" is the server time at the moment of the request; there is no grace period.
  - The same rule applies to `updateBriefByAdmin`.
  - **Frontend (Step 12 table):** when reopening a brief whose deadline has passed, ask for a new deadline (or none) and send it with the status change.

## D-32 — Which database the e2e tests use

**Status:** Accepted

- **Context:** Step 11 adds an API e2e smoke suite. It signs up members, creates products and briefs, and blocks a member, so it writes data. The only databases so far are the dev database `agentsHub` on Atlas (D-13), which holds the seed data and manual test data, and the production database. The batch e2e spec booted the real batch module against `MONGODB_DEV`, so it connected to the dev database too.
- **Options:**
  - **A. `mongodb-memory-server`:** a throwaway `mongod` per test run, on this machine.
    - Pro: Never touches Atlas or the dev data. Every run starts empty, so tests don't depend on leftovers or clean up after themselves. Works offline after the first download.
    - Con: A new devDependency. The first `npm install` on each machine downloads a `mongod` binary (about 650 MB on Windows). The binary's MongoDB version may differ from Atlas.
  - **B. A separate test database on the Atlas cluster** (e.g. `agentsHubTest` through a `MONGODB_TEST` key), with a name check.
    - Pro: The same MongoDB version as dev. No binary download.
    - Con: Needs the network and credentials. Test data lives on the shared cluster, and a typo in the URI points the suite at real data. Runs need cleanup.
  - **C. A local `mongod` or Docker container** started by hand.
    - Pro: Real MongoDB, chosen version.
    - Con: An extra manual step on every machine; the tests fail if it isn't running.
- **Decision:** Option A. Both e2e suites (`npm run test:e2e`, `npm run test:e2e:batch`) run on `mongodb-memory-server`, with these rules:
  - **One database per run:** a Jest `globalSetup` (`apps/agentshub-api/test/e2e/global-setup.ts`) starts the in-memory `mongod` on `127.0.0.1`; `globalTeardown` stops it. The batch config reuses the same files.
  - **The test values win over `.env`:** a Jest `setupFiles` module (`test/e2e/e2e-env.ts`) runs before each test file's imports and sets `MONGODB_DEV` (and `MONGODB_PROD`) to the in-memory URI, `NODE_ENV=test` and a throwaway `SECRET_TOKEN`. The app still loads `.env` through `ConfigModule.forRoot()`, which never overrides a variable that is already set.
  - **Refuse to run otherwise:** the setup throws before the app is imported unless the URI is `mongodb://` with only `127.0.0.1` / `localhost` hosts. After connecting, the app helper (`test/e2e/e2e-app.ts`) and the batch spec check the live connection's host again and close the app if it isn't local.
  - **The same pipeline as production:** the e2e app is built with `configureApp(app)` (`apps/agentshub-api/src/app.setup.ts`), which `main.ts` also calls, so the `ValidationPipe` and `LoggingInterceptor` can't drift between the two.
- **Reason:** The e2e suites write data, so they must never be able to reach the dev or production data. An in-memory database that is created and thrown away per run gives that by construction. The two host checks make a misconfiguration fail loudly instead of quietly writing to Atlas. The binary download is a one-time cost per machine.
- **Consequence:**
  - **MongoDB version:** the binary is the package default (MongoDB 8.2.6 with `mongodb-memory-server` 11.3.0), not pinned to the Atlas version. The code needs 5.0+ (`$lookup` with `localField` + `pipeline`, S16). Pin it with the package's version setting if a version difference ever matters.
  - **First install:** `npm install` downloads the binary into `node_modules/.cache/mongodb-memory-server` (about 650 MB download, 74 MB unpacked on Windows). CI, if added later, should cache that folder.
  - **The batch e2e spec no longer needs `.env` or the dev database.**
  - **Unit tests (`npm test`) use no database at all:** services get mocked models (`apps/agentshub-api/test/utils/mock-model.ts`).

## D-33 — How the client learns who is logged in, and why a request was refused

**Status:** Accepted

- **Context:** The client needs the current member after a page reload. The token only holds `_id`, `memberType` and `memberNick` (S9), and `checkAuth` returns only a string (`Hi <nick>`). So the frontend guide told the client to take `_id` from the token and call `getMember` with it, which means decoding the JWT. `getMember` is the public profile path: it also returns `BLOCK` members, so a reload doesn't reveal that the member was blocked. Separately, a blocked member gets `FORBIDDEN` with the message `"You have been blocked!"` (B17, D-27), but a wrong role also gets `FORBIDDEN`. The client could only tell "log out" from "hide the button" by comparing the message text.
- **Options:**
  - **Current member:**
    - **A. A guarded `getMe: Member` query.**
      - Pro: No token decoding on the client. It goes through `AuthGuard`, so a blocked, deleted or expired session fails like every other logged-in call (B17).
      - Con: One more query.
    - **B. Keep `getMember(<token _id>)`.**
      - Con: The client must decode the JWT, and a blocked member's own profile still loads.
  - **Blocked reason:**
    - **A. `extensions.reason = 'MEMBER_BLOCKED'`** next to the unchanged code and message.
    - **B. A new error code** (e.g. `MEMBER_BLOCKED` instead of `FORBIDDEN`).
      - Con: Breaks clients that already handle `FORBIDDEN`.
    - **C. Keep matching the message.**
      - Con: Breaks on any change of wording.
- **Decision:** Option A for both.
  - **`getMe: Member`:** guarded by `AuthGuard`. `MemberService.getMe` reads `{ _id, memberStatus: ACTIVE }` and throws `UNAUTHENTICATED` (`NOT_AUTHENTICATED`) if nothing matches. That only happens when the status changes between the guard and the read.
    - No view, `meLiked` or `meFollowed`.
    - No `accessToken`: tokens still come only from `signup`, `login` and `updateMember`.
    - The member's own `memberEmail` / `memberWhatsapp` come from `MemberContactResolver` like everywhere else (D-23). The caller passed the guard as `ACTIVE`, so they are set. There is no special owner rule.
    - Blocked and deleted members are handled by the guard only (B17). `getMe` has no logic of its own for them.
  - **Blocked reason:**
    - A blocked member is refused with `memberBlockedException()` (`libs/errors.ts`), the only place that builds this error. It is used by `AuthService.authenticate` (every guarded operation) and by `MemberService.login` (correct password only, D-27).
    - The error keeps code `FORBIDDEN` and message `BLOCKED_USER`, and adds `extensions.reason = 'MEMBER_BLOCKED'` (`ErrorReason` in `common.enum.ts`). `ErrorReason` is a plain TS enum, not a GraphQL enum, because error extensions are not part of the schema.
    - The exception body keeps Nest's default `statusCode` / `error` keys. `@nestjs/apollo` maps an exception to `FORBIDDEN` only when its body has `statusCode`; without it the client gets `INTERNAL_SERVER_ERROR`.
  - **`formatError`** moves to `libs/format-error.ts` (`formatGraphqlError`) so it can be unit-tested. It passes `originalError.reason` to the client only when it is a string, and never passes any other key of the exception body (allow-list).
- **Reason:** The client gets its own member, including its contacts, from one call that fails exactly when the session is no longer valid. A stable machine-readable reason lets the client log out a blocked member without depending on the message text, and nothing existing clients rely on changes.
- **Consequence:**
  - **Frontend:** after a reload, call `getMe`. Log out on `UNAUTHENTICATED`, or on `FORBIDDEN` with `reason === 'MEMBER_BLOCKED'`. The D-23 advice to load one's own contacts with `getMember` after login is replaced by `getMe`; D-23 itself is unchanged.
  - **Only blocked members have a reason for now.** Other errors have no `reason`. New reasons are added to `ErrorReason` and need no change in `formatError`.
  - **Not in this decision:** the WebSocket chat doesn't re-check blocked members on open connections. That stays on the Step 13 list.

## D-34 — Legacy Nestar documents and errors that outlive a request

**Status:** Accepted

- **Context:** In the client walk-through (Step 13a), `getAllMembersByAdmin` met Nestar-era members: `memberType: "AGENT"` and no `memberBriefs`. GraphQL answered with field errors (`Enum MemberType cannot represent value: AGENT`, `Cannot return null for non-nullable field Member.memberBriefs`), and then the whole API process exited. Cause (B22): graphql-js 16 completes list items one by one; when one item fails synchronously while other items still have async fields running, those fields' later rejections are never awaited. Node 15+ exits on an unhandled rejection. The Step 6 mongosh migrations had not reached every document (they also hard-code `getSiblingDB('agentsHub')`, so a shell connected elsewhere matches 0 documents).
- **Options:**
  - **Process:**
    - **A. A process `unhandledRejection` handler that logs and keeps running.**
      - Pro: One request's orphaned promise can't take the API down for everyone. The client already got its GraphQL error.
      - Con: A real bug that leaves a rejection unhandled is only logged, not fatal.
    - **B. Keep Node's default (exit) and rely on a process manager to restart.**
      - Con: Every request in flight fails, and a bad document crashes the API on every list that reaches it.
    - **C. Make every list field resolver defensive.**
      - Con: Many places, and the graphql-js behaviour stays.
  - **Data:** a one-off script that fixes the documents (A), or defaults in the GraphQL output types (B, hides bad data).
- **Decision:**
  - **Process: option A.** `registerProcessHandlers()` (`libs/process-handlers.ts`) is the first call of both `main.ts` files. It logs `Unhandled promise rejection: <stack>` (redacted, S15) through Nest's `Logger` and does not exit. Uncaught **synchronous** exceptions keep Node's default exit, because the process state can't be trusted after one.
  - **Data: option A.** `npm run migrate:legacy` (`scripts/migrate-legacy.ts`, rules in `apps/agentshub-batch/src/maintenance/legacy-data.ts`):
    - connects with the app's own `MONGODB_DEV` and prints the database name and host first;
    - is a **dry run by default**: per collection and per rule, how many documents would change; `--apply` writes. Dev only;
    - checks every non-null field of the GraphQL output types of members, products, briefs, board articles and comments, plus the `likes` / `views` groups. Safe values are filled (counters → 0, `memberType AGENT → CREATOR`, `PROPERTY → PRODUCT`, `memberProperties → memberProducts` without overwriting a count, `memberAddress` removed, `productStatus SOLD → PAUSED`, missing `productCategory` → `OTHER`, missing `productPricing` → `ONE_TIME` with a price / `CUSTOM` without, D-03, missing timestamps → the `_id` time);
    - never guesses a value it can't know (a missing title, nick or `memberId`, an unknown enum value): those are listed by `_id` as problems to fix by hand.
- **Reason:** The API must survive bad data, and the data must still be fixed at the source, so lists show every member instead of failing.
- **Consequence:** Re-runnable: a dry run after `--apply` reports 0. Back up the collections before `--apply`. The old mongosh files under `scripts/migrations/` stay as the record of Step 6.

## D-35 — Text limits for comments, chat, articles and member descriptions

**Status:** Accepted

- **Context:** The Nestar limits were short: comments 1–100, chat messages 1–500, article content 3–250, and `memberDesc` had none. In the client walk-through a 100-character comment felt too short for a review of an agent, and forum posts need room.
- **Decision:** One place in `libs/config.ts` (`TEXT LIMITS`), used by the DTOs and the chat gateway:

  | Field | Before | Now |
  |---|---|---|
  | `commentContent` (create and update) | 1–100 | 1–1000 |
  | chat message (after trim) | 1–500 | 1–3000 |
  | `articleContent` (create and update) | 3–250 | 3–3000 |
  | `articleTitle` | 3–50 | unchanged |
  | `memberDesc` (`updateMember`, `updateMemberByAdmin`) | no limit | max 500; `null` still clears it |

- **Reason:** Long enough for real use, short enough to keep lists readable and to bound what one request stores. 3000 matches `productDesc` and `briefContent`.
- **Consequence:** Validation stays in the DTOs (`BAD_REQUEST` with the field name), not in the Mongoose schemas. The chat message `INVALID_CHAT_MESSAGE` now says 1 to 3000. The client constants follow (comment 1000, chat 3000, article 3000).

## D-36 — Upload errors and orphan uploads

**Status:** Accepted

- **Context:** `imageUploader` / `imagesUploader` answered a file over the size limit with `INTERNAL_SERVER_ERROR` `Upload failed!`, so the client showed "something went wrong" for a user mistake. An image is uploaded before the form that uses it is saved, so a cancelled form leaves a file that nothing references, and nothing ever removed those.
- **Decision:**
  - **Errors:** one helper, `saveUpload()` (`libs/upload.ts`), used by both uploaders. User mistakes are `BAD_REQUEST` with a stable message: unknown target `Bad Request`, no file name `Upload failed!`, wrong type `Please provide jpg, jpeg or png images!`, too big (graphql-upload's 413) `Image must be at most 15 MB!` (new `FILE_TOO_LARGE`). Only a server fault (disk, permissions) is `INTERNAL_SERVER_ERROR` `Upload failed!`. `imagesUploader` keeps its `(file N: name)` suffix and stays all-or-nothing.
  - **Orphans:** `npm run clean:uploads` (`scripts/clean-uploads.ts`, rules in `apps/agentshub-batch/src/maintenance/orphan-uploads.ts`). Dry run by default, `--apply` deletes. A file is an orphan when it is in `uploads/member|product|article/`, no member (`memberImage`), product (`productImages`, any status) or article (`articleImage`, any status) references it, and it is older than 24 h. `uploads/property/` (D-13) is never touched.
- **Reason:** The client can show the right message, and disk use stays bounded without risking a file a form is about to save.
- **Consequence:** It is a manual script, not a nightly job, until there is production storage (it reads the local `uploads/` folder of the machine it runs on). Allowed in production; it prints the database first.

## D-37 — Rank position and the like response

**Status:** Accepted

- **Context:** `productRank` and `memberRank` are nightly scores (D-17, D-22). The client wants to show "#3", and only knew the position inside the page it had loaded. After a like, the client also wrote `meLiked` into its cache itself, because the like mutations returned the target without it.
- **Decision:**
  - **Position:** new nullable fields `Product.productRankPosition: Int` and `Member.memberRankPosition: Int`. The nightly batch writes them after the ranking step: 1, 2, 3… among `ACTIVE` products / `ACTIVE` creators with a rank > 0, ordered by rank DESC, then newest `_id`. The rollback step removes them, so an unranked document has `null`. Additive, no breaking change.
  - **Like response:** `likeTargetProduct`, `likeTargetMember` and `likeTargetBoardArticle` return the target with `meLiked` filled for the caller: one entry after a like, `[]` after an unlike (from the toggle's own result, no extra read).
- **Reason:** One source for the position, the same for every page and client; the like button can trust the response.
- **Consequence:** The position is as of the last nightly run: a product paused during the day keeps its number until the next run, like its rank.

## D-38 — Comments of a deleted member

**Status:** Accepted

- **Context:** In the client walk-through, a member was deleted by an admin, but their comments still showed their nick and picture as a link to their profile, and that profile answers 404 (`getMember` returns only `ACTIVE` and `BLOCK` members). A link that always ends in 404 is a dead link, and the deleted member's nick and image keep being published.
- **Options:**
  - **A. Keep the comment, hide the author** (Reddit `[deleted]`, Stack Overflow anonymous user, GitHub `@ghost`).
    - Pro: Q&A threads under briefs and products keep their context: the answers to a question still make sense. The deleted member's public data is no longer shown.
    - Con: Anonymous comments stay on the page.
  - **B. Hide the deleted member's comments too.**
    - Pro: Simple.
    - Con: Answers lose the question they answer; the target's comment counter no longer matches what is shown.
- **Decision:** Option A, decided in the API, not only in the UI.
  - The same rule everywhere a member is joined to an item: every member `$lookup` in `libs/config.ts` (`lookupMember`, `lookupFollowingData`, `lookupFollowerData`, `lookupFavorite`, `lookupVisit`) starts with `excludeDeletedMember`, and every `$unwind` after it is `unwindKeepingItem(...)` (`preserveNullAndEmptyArrays`), so the item stays.
  - So `memberData` (comments, products, briefs, articles, favorites, visited, admin lists), `followerData` and `followingData` are `null` for a deleted member; the id fields (`memberId`, `followerId`, …) stay.
  - Single reads (`getProduct`, `getBrief`, `getBoardArticle`) take the author from `MemberService.getAuthorData`, which returns `null` for a deleted member instead of `getMember`'s `NOT_FOUND`, so these pages still open.
  - A `BLOCK` member is unchanged: shown as before, and their profile still opens.
  - Not decided here: whether the products and briefs of a deleted member should stay listed at all.
- **Reason:** No dead links, no public data of a deleted member, and threads stay readable.
- **Consequence:** The client shows "Deleted member" without a link when `memberData` is `null`. Counters are unchanged: the comments still exist.

## D-39 — Follows of a deleted member

**Status:** Accepted

- **Context:** After D-38, a deleted member still appeared in follow lists as "Deleted member", and the followers / following counts of the members on the other side still counted them. In follow lists that reads as noise: other platforms drop deleted accounts from follower lists and their counts.
- **Decision:** When an admin sets `memberStatus: DELETE` (`updateMemberByAdmin`), `MemberService.removeAllFollowsOf` runs:
  - every follow of the member is removed, in both directions;
  - for each removed follow the other member's counter drops by 1: someone who followed the deleted member → their `memberFollowings`; someone the deleted member followed → their `memberFollowers`;
  - the deleted member's own `memberFollowers` / `memberFollowings` become 0;
  - each follow is removed with its own `findOneAndDelete`, and its counter moves only when that call removed it, so a concurrent `unsubscribe` can't lower a counter twice. Re-runnable.
  - Members deleted before this rule: `npm run cleanup:follows` (dry run by default, `--apply` writes) runs the same method for each of them.
- **Reason:** Follow lists show only members you can visit, and the counts match the lists.
- **Consequence:** Follows are not restored if a deleted member is ever set back to ACTIVE (no admin action does that today). D-38 still applies to follows left in the database some other way: `followerData` / `followingData` are null for them, and the client leaves such rows out.

## D-40 — Admins are not part of the follow graph

**Status:** Accepted

- **Context:** In the client walk-through an admin could follow members, and members could follow an admin. An admin has no public profile (`/members/<admin>` is 404 in the client), so following one leads nowhere, and an admin's follows show up in members' follower lists and counts as if the admin were a regular member.
- **Decision:**
  - `subscribe` is `@Roles(USER, CREATOR)` with `RolesGuard`: an admin gets `FORBIDDEN` `ONLY_SPECIFIC_ROLES_ALLOWED`.
  - Following an admin → `NOT_FOUND` `NO_DATA_FOUND`, the same answer as a missing member (the client never offers it).
  - `unsubscribe` stays open to every logged-in member, so nothing that already exists gets stuck.
  - Follows from before this rule: `npm run cleanup:follows` (D-39's script, now also for admins) removes every follow of an admin, both directions, and fixes the other side's counters with `MemberService.removeAllFollowsOf`.
- **Reason:** Follows are between members who publish (creators) and members who look for them (users). An admin moderates; their account is not a profile.
- **Consequence:** The client hides the Follow button from admins. Admin likes on members (`likeTargetMember`) are not changed here.

## D-41 — Uploaded images are re-encoded on the server

**Status:** Accepted

- **Context:** Uploads were stored as sent. A 10 MB phone photo stayed 10 MB on disk; `next/image` had to decode it for every new size (slow first loads, a busy CPU, and in dev a laggy page); the original was served wherever `next/image` isn't used; and phone photos carry EXIF, often with the GPS position of where they were taken.
- **Options:**
  - **A. Re-encode on the server at upload (`sharp`):** one place, every client benefits, the stored file is known to be small and clean.
  - **B. Compress in the browser before upload:** less upload traffic, but every client has to do it, and the server would still store whatever arrives.
  - **C. Only rely on `next/image` / a CDN:** still stores and serves the originals and keeps the metadata.
- **Decision:** Option A. `saveUpload()` streams every upload through sharp (`imageTransformer` in `libs/upload.ts`):
  - `rotate()` applies the EXIF orientation, then the image is resized to at most **1600 px** on its longer side (`fit: inside`, never enlarged) and written as **WebP, quality 80**. sharp writes no metadata, so EXIF and GPS are gone.
  - The stored name is always `<uuid>.webp` (`getStoredImageName`), whatever was uploaded. `jpg` / `jpeg` / `png` stay the accepted types.
  - Bytes sharp can't read (a fake or broken image whose mime type claimed jpg / png) → `BAD_REQUEST` `INVALID_IMAGE` ("The file is not a readable image!"). The first stream to fail decides the answer: the upload (413 → `FILE_TOO_LARGE`, other read errors → `INTERNAL_SERVER_ERROR`), sharp (`INVALID_IMAGE`), or the disk (`INTERNAL_SERVER_ERROR`).
  - The upload limit goes from 15 MB to **10 MB** per file (`uploadMaxFileSize`): enough for a full-resolution phone photo, and what is stored is far smaller anyway.
  - Bytes don't bound memory: a 4.5 MB JPEG in the dev data was 10924 × 16384 = 179 MP (~700 MB decoded). sharp gets `limitInputPixels: 50 000 000` (`imageMaxInputPixels`; a 45 MP camera photo passes) and refuses larger images from their header, before decoding → `BAD_REQUEST` `IMAGE_TOO_MANY_PIXELS` ("Image must be at most 50 megapixels!").
  - Images stored before this: `npm run optimize:uploads` (dry run by default, `--apply` writes) re-encodes files over 1600 px, with metadata, or over 500 KB, in place, keeping their name and format, so no document changes. Run on the dev data: 8 files, 35.7 MB → 1.2 MB; originals kept in `uploads/_backup-d41/` until checked (delete them then: `/uploads` is served publicly and they still carry EXIF/GPS).
- **Reason:** Small, upright, metadata-free images for every client, from one place on the server — what most image-heavy sites do.
- **Consequence:** A new dependency, `sharp` (prebuilt binaries per platform; run `npm install` on each machine). Uploads cost a little CPU on the API once, instead of `next/image` decoding the originals again and again. Supersedes the 15 MB limit of D-36; the rest of D-36 stands.

## D-42 — "Who viewed your profile", with private browsing

**Status:** Accepted

- **Context:** Every signed-in visit of a profile is already stored in `views` (`viewGroup: MEMBER`, `viewRefId` = profile, `memberId` = visitor), but only used to count `memberViews`. Members asked to see who visited them. A visitor does not expect to be named to the profile owner, so this is a privacy decision, not only a query.
- **Options:**
  - **A. Only a count and a split** (e.g. "12 members, 5 creators"): no names, little privacy risk.
  - **B. Names, with a private-browsing setting** (LinkedIn style): the owner sees visitors; a member can browse privately and is then only counted.
  - **C. Names without any opt-out.**
- **Decision:** Option B, kept small for the MVP:
  - New `Member.memberBrowsePrivately` (default `false`), set with `updateMember`. Only the member themself reads it (`MemberContactResolver`); everyone else gets `null`, so nobody can tell who browses privately.
  - New query `getProfileVisitors(input: OrdinaryInquiry): ProfileVisitors` for USER and CREATOR (`RolesGuard`; admins have no public profile). It returns `list { _id visitor visitedAt }`, `metaCounter` and `privateCount`: visits of the caller's profile in the last **90 days** (`profileVisitorsWindowDays`), latest visit first. Deleted visitors are left out (D-38) and so are admins. Visitors with `memberBrowsePrivately` are only counted in `privateCount`.
  - The private check uses the visitor's **current** setting, not the setting at the time of the visit (simpler; accepted for the MVP). Turning private browsing off therefore reveals earlier visits again, within the 90 days.
  - Private browsers can still see their own visitors (no LinkedIn-style reciprocity rule in the MVP).
  - An ADMIN's views are never recorded, on profiles, products, briefs and articles (`ViewService.recordView`): moderation must not inflate counters or appear as a visit.
  - `visitedAt` is the view's `updatedAt`, which only means "the latest visit" since B24.
- **Reason:** The data exists already; the opt-out keeps the feature honest towards visitors at a small cost (one field, one check). Option A would answer less, option C would expose people who never agreed to it.
- **Consequence:** A new index `views { viewRefId: 1, viewGroup: 1, updatedAt: -1 }`. Existing members have no `memberBrowsePrivately` field, which reads as `false`; no migration. The privacy policy page should say that signed-in visits of a profile are shown to its owner unless private browsing is on.

## D-43 — Live filter counts for the agents catalog (`getProductFacets`)

**Status:** Accepted

- **Context:** The new `/agents` page shows a count next to every category and pricing option, and disables options with 0 results, so a visitor never filters into an empty page. `getProducts` only returns the page and one total (`metaCounter`); it cannot say how many products each option would show.
- **Options:**
  - **A. A new public query `getProductFacets`** that counts every option in one aggregation.
  - **B. The client asks `getProducts` once per option** (`limit: 1`, read `metaCounter`): 12 requests on every filter change.
  - **C. No counts:** plain chips, empty results are possible (the empty state handles them).
- **Decision:** Option A.
  - `getProductFacets(input: PIsearch): ProductFacets`, public (`WithoutGuard`), the same filters and validation as `getProducts.search`, over `ACTIVE` products only (D-16).
  - `ProductFacets { categories: [CategoryFacet] pricing: [PricingFacet] }`, each `{ value count }`. Every enum value is listed, in enum order, with `0` when nothing matches.
  - **Each group ignores its own filter:** the category counts apply every filter except `categoryList`, the pricing counts every filter except `pricingList`. A selected option therefore never hides its siblings, and the counts read as "what you get if you also pick this".
  - `pricesRange` keeps its D-03 meaning: only `ONE_TIME` / `SUBSCRIPTION` products match it, so with a price range `FREE` and `CUSTOM` count 0, and the category counts respect the paid part of `pricingList` (as `getProducts` does).
  - One aggregation: the filters both groups share go into the first `$match` (it can use an index; a `$facet` sub-pipeline cannot), then each `$facet` branch adds the other group's filter and groups.
  - The client asks `getProducts` and `getProductFacets` as two separate queries. The counts do not depend on `page` or `sort`, so changing those reuses the cached counts.
- **Reason:** One small request per filter change instead of twelve, and the counting rule lives next to `shapeMatchQuery`, so the counts can never disagree with the list.
- **Consequence:** No schema change; the existing `{ productCategory: 1, productStatus: 1 }` index serves the first `$match`. "All" in the client is the sum of the category counts (every product has exactly one category).

## D-44 — /briefs filters, live counts and the "open now" badge

**Status:** Accepted

- **Context:** The new `/briefs` page (an Upwork-style feed) filters by budget type and hides briefs past their deadline, sorts by "most discussed" and "deadline soonest", shows live counts next to every option (as `/agents` does, D-43), and has a hero badge: "{N} briefs open now, {total} in posted budgets". `getBriefs` has none of these filters, `briefComments` is not a sort, and nothing counts or sums briefs. A brief also stays `OPEN` after its deadline passes: nothing closes it.
- **Options for the past-deadline problem:**
  - **A. A query rule:** "past deadline" means `briefDeadline <= now`; lists and counts can leave those briefs out on request. No data changes.
  - **B. A scheduled job** that sets expired briefs to `CLOSED`.
  - **C. Both.**
- **Decision:** Option A now; B stays open (it changes a member's brief without their action, and reopening rules, D-31, would need a second look).
  - **Filters** (`BriefFilters`, so the public, owner and admin lists all take them):
    - `budgetTypeList: [BriefBudgetType]`, with `BriefBudgetType = FIXED | OPEN_TO_OFFERS`, a GraphQL enum only (not stored). `FIXED` = `briefBudget` is a number, `OPEN_TO_OFFERS` = it is not (D-04). Both types, or none, = no filter.
    - `BISearch.hidePastDeadline: Boolean` (public list only): leaves out `OPEN` briefs whose `briefDeadline` is not later than now; no effect on `CLOSED` briefs.
  - **Sorts:**
    - `briefComments` joins `aviableBriefSorts` ("most discussed"); ties are broken by `briefViews`, then the newest `_id`.
    - `briefDeadline` `ASC` ("deadline soonest") lists upcoming deadlines first (soonest first), then passed ones (most recently passed first), then briefs without a deadline. A plain ascending date put long-passed deadlines on top. `DESC` is unchanged.
  - **Counts:** `getBriefFacets(input: BISearch): BriefFacets`, public. `{ categories budgetTypes statuses }`, each `[{ value count }]`, every value in enum order (statuses: `OPEN`, `CLOSED`; never `DELETE`), `0` when nothing matches. Each group ignores its own filter, as in D-43: categories use every filter but `categoryList`, budget types every filter but `budgetTypeList`, statuses every filter but `briefStatus`. `hidePastDeadline` applies to the `OPEN` count only. One aggregation: `memberId` and `text` in the first `$match`, the rest in the `$facet` branches. `briefStatus: DELETE` → `BAD_REQUEST`, as in `getBriefs`.
  - **Badge:** `getOpenBriefStats: OpenBriefStats { openNow: Int, budgetTotal: Float }`, public, site-wide (no filters). Both numbers come from the same briefs: `OPEN` and not past their deadline. `budgetTotal` sums their fixed budgets (USD, D-06), rounded to cents; open-to-offers briefs add nothing.
- **Reason:** The same counting rule as `getBriefs`, next to `shapeMatchQuery`, so counts never disagree with the list. The badge is its own query because it ignores the visitor's filters; mixing it into the facets would make one aggregation answer two different questions.
- **Consequence:** No schema change, no migration. `{ briefCategory: 1, briefStatus: 1, createdAt: -1 }` keeps serving the lists. "Past deadline" is computed against the server clock at request time; the client shows the same state from `briefDeadline` and its own clock. Search still matches `briefTitle` only (S8); descriptions come with semantic search (D-11).

## D-45 — /creators: agent counts, filters, live counts and the hero line

**Status:** Accepted

- **Context:** The new `/creators` page shows profile cards with each creator's agent count, their 2 best agents and the categories they build in, filters by category ("builds agents for"), "only creators with agents" and "following", sorts by followers, agents and name, shows live counts on the filters, and a hero line "{N} creators, {M} agents listed" with 5 faces. `getCreators` returned members only, searched the nick only, and had none of these filters. The design also reported "14 agents on profiles, 13 on /agents".
- **The "14 vs 13" difference is not counter drift:** `memberProducts` counts `ACTIVE` + `PAUSED` on purpose (D-16, option B), `/agents` shows `ACTIVE` only. One paused agent explains it.
- **Options:**
  - **A. Count on read:** join each creator's `ACTIVE` products in the aggregation (`$lookup`), and derive the count, the top 2 and the categories from them.
  - **B. More stored counters** (`memberActiveProducts`, categories) updated on every product create, status change and delete.
- **Decision:** Option A; `memberProducts` keeps its D-16 meaning (owner dashboard).
  - `getCreators` adds, per creator: `memberActiveProducts`, `memberCategories` (unique, best-ranked agent's category first), `memberTopProducts` (2 best by `productRank`, then likes, then newest; type `CreatorProduct`: id, title, category, pricing, price) and `meFollowed`.
  - `CRISearch` adds `categoryList` (a creator matches when one of their `ACTIVE` agents is in a listed category), `withAgentsOnly`, `followingOnly` (a guest follows nobody: empty list, no database call). `text` now matches `memberNick`, `memberFullName`, `memberDesc` and the `ACTIVE` agent titles.
  - New sorts: `memberFollowers`, `creatorProducts` (`ACTIVE` agents), `creatorName` (`memberFullName`, or `memberNick` without one, lower-cased). Counter sorts break ties by `memberRank`, everything by the newest `_id`. The default stays `createdAt`.
  - `getCreatorFacets(input: CRISearch): CreatorFacets`, public: `categories` (per category, every filter but `categoryList`), `all` (the same creators counted once: a creator builds in several categories, so "All" is not their sum), `withoutAgents` (what `withAgentsOnly` hides), `following` (every filter but `followingOnly`). Same rule as D-43 / D-44: each group without its own filter.
  - `getCreatorStats: CreatorStats`, public, site-wide: `creators` (`ACTIVE`), `agents` (their `ACTIVE` agents: the number `/agents` shows), `faces` (5 best-ranked creators with an agent).
  - `CategoryFacet` moves to `libs/dto/facet.ts` (shared by products, briefs and creators; `product.ts` re-exports it), which avoids a member ↔ product DTO import cycle.
- **Reason:** No new counter that can drift; the numbers on the cards come from the same `ACTIVE` products `/agents` lists. One request renders a full card.
- **Consequence:** The creators list joins products for every `ACTIVE` creator before paging: fine at MVP size, served by `{ memberId: 1, productStatus: 1 }`. If creators grow into the thousands, revisit with a stored counter (option B) or a materialized view. Search over agent titles is a regex; semantic search replaces it later (D-11).

## D-46 — /community: wider search, "most discussed", topic counts and writers

**Status:** Accepted

- **Context:** The new `/community` page has a topic bar with live counts, a "Most discussed" sort, a search over the title, the text and the author, a hero with the number of articles and writers, and an "Active writers" sidebar. `getBoardArticles` searched `articleTitle` only, `articleComments` was not a sort, and nothing counted articles or writers. Ties in a counter sort (most articles have 0 likes or comments) had no tie-breaker, so a page could repeat or skip an article.
- **Options for the author search:**
  - **A. Two steps:** find the matching member ids first (nick, full name), then match `memberId: { $in }` next to the title and content.
  - **B. Join every article's author** (`$lookup`) before the `$match`.
- **Decision:** Option A.
  - `BAISearch.text` matches `articleTitle`, `articleContent`, or an author (not deleted) whose `memberNick` or `memberFullName` contains it. Escaped, case-insensitive regex (S8); blank text is no filter. `MemberService.findMemberIdsByName` returns the ids.
  - `articleComments` joins `aviableBoardArticleSorts` ("most discussed"). `getBoardArticles` breaks every sort's ties by the newest `_id`.
  - `getArticleFacets(input: BAISearch): ArticleFacets { categories [{ value count }], all }`, public. Every topic in enum order, `0` when nothing matches; the counts ignore `articleCategory` itself and apply `memberId` and `text` (D-43 rule). An article has one topic, so `all` is the sum.
  - `getCommunityStats: CommunityStats { articles, writers, topWriters [{ memberData articles likes }] }`, public, site-wide. `articles`: every `ACTIVE` article (what the unfiltered feed lists; D-38 keeps a deleted or blocked author's articles listed). `writers` and `topWriters`: `ACTIVE` members only, so a blocked or deleted member is never promoted. Ranked by the likes on their `ACTIVE` articles, then the number of articles, then the newest article; 5 writers (`communityTopWritersLimit`).
- **Reason:** One shared match builder (`articleSearchMatch`) for the list and the counts, so they never disagree. Option A keeps the `$match` first and needs no join per article; the member query is small.
- **Consequence:** No schema change, no migration. The content search is a regex over up to 3000 characters per article: fine at MVP size, replaced by semantic search later (D-11). `boardArticles` had no index; it now has `{ articleStatus: 1, articleCategory: 1, createdAt: -1 }` (the board and the topic counts) and `{ memberId: 1, articleStatus: 1 }` (a member's articles), as briefs do. Mongoose builds them on start (`autoIndex`); the regex search still scans the matched articles. The hero's latest article is `getBoardArticles` with `limit: 1`; the online count stays the socket's `totalClients` (it counts guests too, and there is no presence list on purpose).

## D-47 — Saved briefs ("Save brief")

**Status:** Accepted

- **Context:** The new `/briefs` mockup (`AgentsHub-client/docs/design/agentshub-briefs.html`) gives every brief a bookmark button: a creator looking for work keeps the briefs worth answering and comes back to them. The detail page gets the same button, and the dashboard a "Saved briefs" list. Nothing stores this yet: briefs have no likes (`LikeGroup` has no `BRIEF`), and products' "favorites" are likes.
- **Options for the storage:**
  - **A. Reuse `likes`** with `LikeGroup.BRIEF`, as `getFavorities` does for products.
    - Pro: no new collection; the unique index `{ memberId, likeRefId }` already exists.
    - Con: a like is a public signal (counters, ranking: `productLikes`, `memberLikes`, D-22); a save is a private bookmark the brief's owner never sees. One collection with two meanings makes every like query remember to leave the private rows out.
  - **B. A new `saves` collection** `{ memberId, briefId }`, no counters.
    - Pro: the meaning and the privacy rule are visible in the schema; likes stay untouched.
    - Con: one more schema, module and set of tests.
- **Decision:** Option B. Saves point to briefs only (`briefId`, not a polymorphic `saveRefId` + `saveGroup`): products already have favorites, and nothing else needs saving yet.
  - **Who:** `USER` and `CREATOR` (`RolesGuard`). An `ADMIN` moderates and has no library (D-40 principle) → `FORBIDDEN`. Guests get no button action: the client asks them to log in first.
  - **What can be saved:** a brief `getBrief` can show (D-30 `isBriefVisible()`: `OPEN` or `CLOSED`). A `DELETE` or missing brief → `NOT_FOUND` `NO_DATA_FOUND`. Your own brief → `BAD_REQUEST` `NOT_ALLOWED_REQUEST` (the owner has "My briefs"; D-22 principle).
  - **Operations:** two idempotent mutations instead of a toggle: `saveBrief(briefId): Brief` and `unsaveBrief(briefId): Brief`, both returning the brief with `meSaved`. Saving a saved brief, or unsaving an unsaved one, is no change, not an error. A toggle flips back on a double click or a retried request; "make it saved" does not.
    - `unsaveBrief` removes the save first, then answers like `saveBrief` (`NOT_FOUND` for a brief that is gone), so a bookmark of a deleted brief can still be cleared.
  - **`Brief.meSaved: Boolean`:** `true` / `false` for a logged-in `USER` or `CREATOR` on `getBrief`, `getBriefs` and `getSavedBriefs`; `null` for guests, admins and the other brief lists (the owner's and the admin's lists).
  - **List:** `getSavedBriefs(input: OrdinaryInquiry): Briefs`, `USER` and `CREATOR`. The caller's saves, latest saved first, `OPEN` and `CLOSED` briefs only: a `DELETE` brief drops out and `metaCounter` matches (as `getFavorities` does for paused products, D-16). A closed brief stays listed with its status, so the client shows its "Closed" badge (D-30 keeps closed briefs readable for exactly this).
  - **No counters:** no `briefSaves`, no `memberSaves`. A save never reaches the brief's owner, ranking, or the public numbers.
  - **Cleanup:** `removeBriefByAdmin` (hard delete of a `DELETE` brief) also removes its saves.
- **Reason:** A private bookmark is a different thing from a public like, even when the two rows look alike; keeping them apart keeps the like rules (counters, ranking, D-22) and the privacy rule each in one place.
- **Consequence:** New collection `saves` with a unique index `{ memberId: 1, briefId: 1 }` (one save per member and brief; also the "is it saved" check) and `{ memberId: 1, createdAt: -1 }` (one member's saves, latest first). `SaveModule` (service only, like `LikeModule`) is used by `BriefService`; the resolver methods live in `BriefResolver`. The saves of a deleted member stay (nobody can read them, D-38); the saves of a soft-deleted brief stay until the admin removes the brief. No migration.

## D-48 — Offers on briefs, and invites ("Send offer")

**Status:** Accepted

- **Context:** D-08 kept every contact off the platform: a creator reads a brief and writes to the email/WhatsApp on the user's profile. The platform never sees whether a brief got answers, the user compares offers in their mailbox, and a creator cannot tell whether their offer was seen. The marketplace needs the step between "a brief is posted" and "two people work together", as Upwork does with proposals and offers. Chat comes after offers and is tied to them (its own decision, D-49).
- **Scope:** offers and invites only. No payments, escrow, contracts, milestones or reviews: money still changes hands off the platform (D-08 stays for that). No notifications yet: there is no notification module (D-18); the lists and counters below are enough for the MVP, notifications get their own decision.
- **Options for who may accept:**
  - **A. One accepted offer closes the brief.** Simple, but a user who needs two agents (or a backup creator) has to post the brief twice.
  - **B. Several accepted offers (Upwork).** Accepting does not close the brief; the user closes it when done.
- **Decision:** Option B, plus invites and expiry:
  - **Who:** only a `CREATOR` sends, edits and withdraws offers; only the brief's owner (a `USER`) accepts or declines them and sends invites. An `ADMIN` has no offers (D-40 principle). A blocked or deleted member does nothing here (D-38).
  - **One offer per creator and brief:** one document per `{ briefId, creatorId }`, for its whole life. Sending again after `WITHDRAWN` or `EXPIRED` re-opens the same document instead of adding one, so a creator never has two offers on one brief.
  - **States:**
    - `PENDING` → `ACCEPTED` or `DECLINED` (the brief's owner)
    - `PENDING` → `WITHDRAWN` (the creator)
    - `PENDING` → `EXPIRED` (time, see below)
    - `WITHDRAWN` / `EXPIRED` → `PENDING` (the creator sends it again)
    - `DECLINED` with `BRIEF_CLOSED` → `PENDING` (the creator sends it again after the brief reopened)
    - The brief becomes `CLOSED` or `DELETE` → every `PENDING` offer becomes `DECLINED` with `offerCloseReason: BRIEF_CLOSED`.
    - `ACCEPTED` and `DECLINED` are final, except a `DECLINED` offer with `BRIEF_CLOSED`: its creator may send it again once the owner reopens the brief (otherwise reopening would lock every earlier creator out). Every other move → `BAD_REQUEST` `INVALID_OFFER_STATUS_CHANGE` (its own message, like `INVALID_BRIEF_STATUS_CHANGE`). One `assertOfferTransition()` holds the table.
  - **What an offer says:**
    - `offerPrice`: USD (D-06), > 0, the same rule as `briefBudget` (D-04).
    - `offerDeliveryDays`: whole days, 1–365.
    - `offerMessage`: 20–2000 characters after trimming (`offerMessageMinLength` / `offerMessageMaxLength`, D-35 style). Plain text.
    - `productId` (optional): one of the creator's own `ACTIVE` agents, to show what they already built.
  - **Sending:** only to an `OPEN` brief (also one past its deadline: it stays `OPEN`, D-44). At most **20 offers sent or re-sent per creator in 24 hours** (`offerDailyLimit`) → `BAD_REQUEST`.
  - **Editing:** a `PENDING` offer can be edited by its creator (price, days, message, agent). Each edit restarts the expiry.
  - **Expiry:** a `PENDING` offer expires **14 days** (`offerExpiryDays`) after it was last sent or edited (`expiresAt`). Every read treats `expiresAt <= now` as expired, and `acceptOffer` refuses it, so nothing depends on when the batch runs. A daily job in `agentshub-batch` stores `EXPIRED` and fixes the counters. (Upwork expires client offers after 7 days; our users visit less often, and 30 days would leave stale prices.)
  - **Who sees an offer:** its creator, the brief's owner and an admin. Other creators see only the number: `Brief.briefOffers` counts `PENDING` + `ACCEPTED` offers and changes only in the service (`$inc` on each transition, ER rule 5).
  - **Invites (Upwork "invite to job"):** the brief's owner invites a creator to send an offer: `inviteCreator(briefId, creatorId)`. An invite is a request, not an offer: the price and days still come from the creator. Only for an `OPEN` brief, an `ACTIVE` creator, once per creator and brief (idempotent like D-47), at most **20 invites per user in 24 hours**. The creator lists their invites; an invited creator's offer shows "Invited" to the owner.
  - **API:**
    - Creator: `createOffer(input)`, `updateOffer(input)`, `withdrawOffer(offerId)`, `getMyOffers(input)`, `getMyInvites(input)`; `Brief.meOffer` (the caller's own offer on that brief) and `Brief.meInvited`.
    - Brief owner: `acceptOffer(offerId)`, `declineOffer(offerId)`, `getBriefOffers(input)` (by status, latest first), `inviteCreator(briefId, creatorId)`.
    - Admin: offers and invites of a brief go with it in `removeBriefByAdmin`. No separate moderation in the MVP.
- **Reason:** Offers are the core of a marketplace like Upwork, and they need no real-time transport, so they come first and are useful alone. Several accepted offers match how people hire (Upwork works the same way). One document per creator and brief makes "my offer on this brief" one lookup and rules out duplicates in the schema. Expiry keeps creators from waiting forever and keeps both lists honest.
- **Consequence:**
  - New collection `offers`: unique `{ briefId: 1, creatorId: 1 }`; `{ briefId: 1, offerStatus: 1, sentAt: -1 }` (the owner's list); `{ creatorId: 1, offerStatus: 1, sentAt: -1 }` (my offers); `{ creatorId: 1, sentAt: -1 }` (daily limit); `{ offerStatus: 1, expiresAt: 1 }` (the expiry job).
  - New collection `invites`: unique `{ briefId: 1, creatorId: 1 }`; `{ creatorId: 1, createdAt: -1 }`; `{ userId: 1, createdAt: -1 }` (daily limit).
  - New field `Brief.briefOffers` (default 0; existing briefs read as 0, no migration).
  - Closing or deleting a brief now also declines its `PENDING` offers, in the same service method.
  - D-08 is partly superseded: offers live on the platform, contact details and money still do not.
- **Implementation notes (Phase A, backend):**
  - **Races:** every status change is one conditional write filtered on the status (and expiry) that was checked. The loser of two simultaneous moves (accept vs withdraw, two re-sends) matches nothing and is answered from the offer as it is now. `briefOffers` changes by the counted-status difference of the write that really happened; a re-send of a stored `PENDING` offer past its expiry changes it by 0 (it was still counted).
  - **No transactions:** the offer write and the `$inc` on the brief are two writes. If the second fails, the counter is off by one until fixed by hand; accepted for the MVP (the same as the other counters).
  - **Accept** also checks that the brief is still `OPEN` (the decline on close is logged, not fatal, so this is the safety net) and that the creator is not deleted (D-38).
  - **Daily limit** counts offers by `sentAt`: an offer sent again counts once, at its latest send.
  - **`meOffer` / `meInvited`** are filled on `getBrief` only (the detail page); every list leaves them `null`, so a list never runs one lookup per brief.
  - **Expiry job:** its own cron (01:30), separate from the nightly ranking so neither failure stops the other. One conditional write per offer, pinned to the `expiresAt` it read, then `$inc: -1` on its brief only if that write changed it.
  - `Brief.briefOffers` of a brief stored before D-48 is answered as 0 by a field resolver (`BriefFieldsResolver`), not by a migration.
  - New messages: `BRIEF_NOT_OPEN`, `INVALID_OFFER_PRICE`, `INVALID_OFFER_PRODUCT`, `INVALID_OFFER_STATUS_CHANGE`, `OFFER_ALREADY_PENDING`, `OFFER_EXPIRED`, `OFFER_DAILY_LIMIT`, `INVITE_DAILY_LIMIT`, `INVALID_INVITE_TARGET`.

## D-49 — 1:1 chat on an offer

**Status:** Accepted

- **Context:** D-48 put offers on the platform, but the brief's owner and the creator still leave it to talk (D-08). The community chat (D-19) is public and keeps no history. Members need a private conversation about one offer: questions before accepting, details after. Planned with D-48: the chat is tied to an offer, not open between any two members.
- **Options for who may start a conversation:**
  - **A. Either side.** A creator could write to every brief owner: the same spam the offer limits stop.
  - **B. Only the brief's owner, on an offer they received (Upwork's "interview").** The creator answers once it exists.
- **Decision:** Option B.
  - **One conversation per offer** (`conversations.offerId` unique), between the brief's owner (`userId`) and the offer's creator (`creatorId`). `openConversation(offerId)` is idempotent: opening it again returns the same one.
  - **When:** the owner opens it on an offer that is `PENDING` (not past its expiry) or `ACCEPTED`. Any other offer → `BAD_REQUEST` `CONVERSATION_NOT_ALLOWED`.
  - **Who reads:** only its two members. Anyone else (an admin included) gets the same answer as a missing one: messages are private. An admin can lock a conversation (`lockConversationByAdmin`) and sees its metadata in a list, never its messages (nor `lastMessagePreview`, which is a message's start; filter by `lockedByAdmin`).
  - **Writing is computed, not stored:** a conversation takes new messages while its offer is `PENDING` (not expired) or `ACCEPTED`, both members are `ACTIVE`, and no admin locked it. Otherwise it is read-only with a reason (`OFFER_CLOSED`, `MEMBER_UNAVAILABLE`, `LOCKED_BY_ADMIN`), and `sendMessage` → `BAD_REQUEST` `CONVERSATION_READ_ONLY`. Computing it means no offer or member change has to update conversations.
  - **Messages:** plain text, 1–3000 characters after trimming (D-35's `chatMessageMaxLength`), at most 1 per second per member (D-19's rule). Each carries a `clientMessageId` (a UUID made by the client): sending the same one twice stores one message (a retry after a lost connection).
  - **Transport:** `sendMessage` is a GraphQL mutation; it stores the message, then pushes `chat:message` over the existing WebSocket to both members' open sockets. The socket never writes. A member who missed a push asks for `getMessages(after: lastId)`.
  - **History:** cursor pages by `_id` (`before` / `after`, at most 50), not page numbers: new messages would shift numbered pages.
  - **Unread:** one counter per side on the conversation (`userUnread`, `creatorUnread`): `+1` for the other side on each message, `0` on `markConversationRead`. `getChatUnreadCount` sums the caller's.
- **Reason:** Tying the chat to an offer keeps every conversation about real work and lets the owner decide who may talk to them. One write path (GraphQL) keeps validation, guards and limits in one place; the socket only tells clients something changed, so a dropped socket loses nothing.
- **Consequence:**
  - New collection `conversations`: unique `{ offerId: 1 }`; `{ userId: 1, lastMessageAt: -1 }`; `{ creatorId: 1, lastMessageAt: -1 }`.
  - New collection `messages`: `{ conversationId: 1, _id: -1 }` (history); unique `{ senderId: 1, clientMessageId: 1 }` (retries); `{ senderId: 1, createdAt: -1 }` (rate limit).
  - The socket gateway keeps which member each socket belongs to and pushes to members (`ChatPublisher`, renamed `MemberPublisher` by D-50). With more than one API instance this needs Redis pub/sub behind the same interface; one instance is enough for the MVP.
  - D-08 is superseded for members with an offer: they can talk on the platform. Contact details stay where D-07 puts them.
  - No notification per chat message: the unread count is the signal (kept by D-50).

## D-50 — Notifications

**Status:** Accepted

- **Context:** D-48 and D-49 moved offers and conversations onto the platform, but a member learns about a new offer, an accepted one or an invite only by opening the page. The `notifications` collection has existed since Nestar (D-18) with no module behind it. The marketplace needs the "something happened" signal Upwork gives: a bell with a count, a list, and a push while the page is open.
- **Options for the text:**
  - **A. Store the sentence** ("Nova Labs sent an offer on …"). Simple to render, but frozen in the language of the moment, and the site has three (en, uz, ko).
  - **B. Store the event, word it on the client.** `notificationType` says what happened; the client translates it and fills in who (`authorData`) and what (`notificationTitle`).
- **Decision:** Option B.
  - **What is sent, to whom:**

    | `notificationType` | When | Receiver | `notificationTitle` |
    |---|---|---|---|
    | `OFFER_RECEIVED` | a creator sends an offer, or sends it again | the brief's owner | brief title |
    | `OFFER_WITHDRAWN` | the creator withdraws a `PENDING` offer | the brief's owner | brief title |
    | `OFFER_ACCEPTED` / `OFFER_DECLINED` | the owner accepts / declines | the creator | brief title |
    | `INVITE` | a new invite (inviting again sends nothing) | the creator | brief title |
    | `COMMENT` | a comment on an agent, brief, article or profile | the agent's creator, the brief's / article's author, the member | that title, or the member's nick |
    | `FOLLOW` | a member follows | the member followed, **once per follower** (unfollow + follow sends nothing new) | follower's nick |

  - **Not sent:** likes (`LIKE` stays in the enum from Nestar, unused: a like is a counter, not news); chat messages (the unread badge is the signal, D-49); offers declined in bulk because the brief was closed, and offers that expire (the creator's list shows it; one notification per offer would be noise). Nobody is notified about their own action.
  - **`notificationDesc`:** the first 140 characters of a comment, on one line; empty otherwise. Title and description are plain text.
  - **Best effort:** the action that caused a notification has already happened, so a failure while sending one is logged, never returned as an error of that action.
  - **Push:** each new notification goes to the receiver's open sockets as `notification:new { notificationId }`; reading pushes `notification:read {}` to the reader's other tabs. Same rule as D-49: the socket tells, GraphQL is the source of truth. The D-49 publisher becomes `MemberPublisher` (`socket/member.publisher.ts`), shared by chat and notifications.
  - **API (USER and CREATOR; an ADMIN gets FORBIDDEN, D-40 principle):** `getMyNotifications(input: NotificationsInquiry)` (latest first, `limit` 1–50, `unreadOnly`), `getNotificationUnreadCount`, `markNotificationRead(notificationId)` (someone else's → NOT_FOUND), `markAllNotificationsRead` (returns how many changed). `authorData` is joined; null when the author is deleted (D-38).
  - **Lifetime:** a TTL index removes a notification 90 days after it was created (`notificationTtlDays`), read or not. No batch job needed.
- **Reason:** Storing events instead of sentences keeps notifications correct in every language and when wording changes. Covering only events a member acts on (offers, invites, comments, new followers) keeps the bell meaningful. Building it on D-49's socket path adds no new transport.
- **Consequence:**
  - `NotificationType` gains `FOLLOW`, `OFFER_RECEIVED`, `OFFER_ACCEPTED`, `OFFER_DECLINED`, `OFFER_WITHDRAWN`, `INVITE`.
  - Indexes on `notifications`: `{ receiverId: 1, createdAt: -1 }` (list), `{ receiverId: 1, notificationStatus: 1 }` (count), `{ notificationType: 1, authorId: 1, receiverId: 1 }` (FOLLOW once), TTL `{ createdAt: 1 }`.
  - `NotificationModule` reads briefs, products, articles and members through their models; Offer, Comment and Follow modules import it (the other direction would be a cycle).
  - D-18's open question on `notificationDesc` is settled: optional.

## D-51 — Hardening: list sizes, login throttle, socket frames, query depth

**Status:** Accepted

- **Context:** Before launch, a review of what one client can make the API do found four cheap ways to make it work hard or guess passwords:
  1. Most list inputs had `limit ≥ 1` but no maximum and no whole-number rule: `limit: 1000000` loaded a whole collection with its joins in one request; `limit: 1.5` reached MongoDB and came back as `INTERNAL_SERVER_ERROR`.
  2. `login` had no limit on failed attempts: a password could be guessed as fast as bcrypt answers.
  3. The WebSocket accepted frames up to `ws`'s default of 100 MiB, buffered in memory, although no valid frame is larger than a 3000-character message.
  4. The schema has a cycle (`Offer.briefData` → `Brief.meOffer` → `Offer` …), each level resolved with its own reads: one request could nest it as deep as it liked.
- **Decision:**
  1. **Lists:** every `*Inquiry` takes whole numbers (`@IsInt`) and `limit` ≤ `listPageMax` (100), unless the list already has a smaller maximum (history and notifications: 50). The client's largest page is 100 (following ids, sitemap). → `BAD_REQUEST`.
  2. **Login throttle:** failed logins (`UNAUTHENTICATED` only; a blocked member's `FORBIDDEN` is not counted) are counted per client address and nick (lower-cased) in a sliding 15-minute window. From the 11th, `login` answers `TOO_MANY_REQUESTS` ("Too many failed logins. Try again in a few minutes!", HTTP 429) **before** checking the password, until the oldest failure leaves the window; a success clears the count. Keyed by address *and* nick so a stranger can't lock a member out everywhere. In memory, at most 10 000 keys. Behind a reverse proxy, `TRUST_PROXY` must be set (e.g. `1`) so the address is the real client's; otherwise every client shares the proxy's.
  3. **Socket frames:** `maxPayload` 16 KiB; `ws` closes a socket that sends a bigger frame.
  4. **Query depth:** a validation rule refuses operations nested deeper than 8 fields (`GRAPHQL_VALIDATION_FAILED`), before anything runs. Fragments count where they are spread; introspection is not counted. The client's deepest operation has 5.
- **Reason:** Each fix is a bound on a cost the client controls, enforced where the request enters, with no new dependency.
- **Consequence:**
  - The throttle and the socket's publisher are per API instance; running several instances needs a shared store (Redis) behind the same interfaces (as D-49).
  - Not covered here (later): a general request rate limit per address, and a size limit on the GraphQL request body other than uploads.

## D-52 — Semantic search: embeddings and Atlas Vector Search

**Status:** Accepted

- **Context:** The product and brief lists searched titles only (`$regex`). A business owner describes a need in their own words ("something that answers the phone for my café") and misses the "Voice receptionist" agent that fits it; a creator looking for work misses briefs worded differently from their agent. Searching by meaning needs a vector per document and a vector index. The plan to add AI features last (semantic search first, a RAG assistant later) starts here.
- **Options:**
  - **Provider:** Voyage AI (`voyage-4-lite`) or OpenAI (`text-embedding-3-small`); same price per token. Voyage gives 200M free tokens, a smaller vector by default, multilingual models, and belongs to MongoDB.
  - **Where vectors live:** in the product / brief document, or a separate `embeddings` collection. A separate collection would need the documents' status copied into it to filter by it.
  - **When they are made:** in the request that saves the text (slower saves, a provider outage fails the save), or in the background.
- **Decision:**
  1. **Provider:** Voyage `voyage-4-lite`, 1024 dimensions, behind an `EmbeddingProvider` interface (abstract class: `VoyageEmbeddingProvider`, `DisabledEmbeddingProvider`, fakes in specs). `VOYAGE_API_KEY` turns it on; `EMBEDDING_MODEL` and `VOYAGE_BASE_URL` (the Voyage API by default; Atlas model API keys use `https://ai.mongodb.com/v1`) are optional. No key: nothing is embedded, every search uses keywords.
  2. **Stored in the document:** `embedding` (never selected, never in GraphQL, dropped from every pipeline that reads products or briefs), `embeddingStatus` (`PENDING` / `READY` / `FAILED`), `embeddingModel`, `embeddingHash` (sha256 of the text), `embeddingAttempts`, `embeddedAt`.
  3. **The text:** labelled lines: product = title, category (as words), tags, description; brief = title, category, content (`buildEmbeddingText`, one place).
  4. **Sync:**
     - Create, or an update that changes a text field, sets `embeddingStatus: PENDING` in the same write and emits an event (`@nestjs/event-emitter`). The listener embeds after the request has answered: saving never waits for or fails because of the provider.
     - The same text is never sent twice (hash + model compared). Writes are compare-and-set on the text fields that were read, and don't touch `updatedAt`.
     - A reconcile job in the batch app (every 5 minutes) embeds whatever is not READY or is of another model: lost background syncs, failures (up to 5 attempts, until the text changes), documents from before D-52 (the backfill), a model change. `npm run batch:run -- embeddings` does the same at once.
  5. **Search:**
     - `getProducts` / `getProductFacets` and `getBriefs` / `getBriefFacets` with a `search.text`: the text is embedded as a query (cached 10 minutes, at most 500 texts; 1.5 s timeout), then `$vectorSearch` (index `product_embedding` / `brief_embedding`, filter on status) returns the 200 closest documents scoring at least 0.6.
     - The list matches those **or a title containing the text** (an exact name is never missed), with its other filters on top, so filters and counts work as before.
     - New sort `relevance` (default whenever there is a semantic search): title matches first, then the semantic order. An explicit sort still wins.
     - Any failure (no provider, timeout, no index, a local MongoDB) answers with the keyword search: a search never fails because of D-52.
     - Creator, "my" and admin lists keep the keyword search (people look for a name there).
  6. **Indexes:** `npm run create-search-indexes` creates (or updates) the Atlas vectorSearch indexes: `embedding` (1024, cosine) plus the status as a filter field.
- **Reason:** Vectors next to the data keep status filtering in the same index and need no copy to sync. Background sync with a reconcile job makes saves independent of a third-party API and recovers from every failure the same way. Matching "semantic ids or title" on top of the existing pipeline keeps every filter, count and sort working, and a keyword fallback keeps search up when the provider or the index is not.
- **Consequence:**
  - New env: `VOYAGE_API_KEY` (and optional `EMBEDDING_MODEL`, `VOYAGE_BASE_URL`). On deploy: `npm run create-search-indexes` once per cluster, then the batch fills the vectors in.
  - Each vector is about 8 KB in BSON; the minimum score (0.6) and the candidate counts are first guesses, to tune on real data.
  - Atlas-only: the e2e suites run without a provider (keyword search); the semantic half is covered by unit tests and checked by hand on Atlas.
  - Next (not here): hybrid ranking with `$rankFusion` (needs MongoDB 8.0+), and the RAG assistant on the same vectors.

## D-53 — Hybrid search: vector and keyword rankings fused with RRF

**Status:** Accepted

- **Context:** D-52 ranks a text search by meaning only; words count only as "a title containing the text". So a description or a tag with the exact word (a product name, "Telegram", "invoice") does not raise a document, and without a provider (no key, an outage) the order is just newest first. Hybrid search ranks by meaning and by words together. The cluster is an Atlas **Free** cluster: at most 3 search/vector indexes in all, and the two vectorSearch indexes of D-52 already take two.
- **Options:**
  - **A. Atlas Search (`$search`) + `$rankFusion`:** the best keyword engine (BM25, fuzzy matching for typos, per-field boosts), fused in one pipeline. Needs two more search indexes (4 > 3 on Free) and MongoDB 8.0+.
  - **B. Atlas Search, fused in code:** the same engine without the version need; still 4 indexes.
  - **C. MongoDB text index (`$text`, textScore), fused in code with Reciprocal Rank Fusion:** an ordinary index, so no Free-cluster limit; also on the local and e2e MongoDB. No fuzzy matching (a typo finds nothing by words; meaning still helps), English stemming.
- **Decision:** C.
  1. **Indexes:** a text index per collection, declared in the schemas (Mongoose builds it): `product_text` (title 10, tags 5, description 1), `brief_text` (title 10, content 1).
  2. **`HybridSearchService.rankedIds(kind, text, filter)`** (embedding module) runs both sides at once: `VectorSearchService` (D-52) and a `$text` query (same status filter, best textScore first, at most 200). The search text is passed as plain words: `"` and a leading `-` (phrase and negation in `$text`) become spaces.
  3. **Fusion:** Reciprocal Rank Fusion, k = 60: each list gives a document 1 / (k + rank); the sums decide the order, ties keep the vector order. Only the positions are used, so a cosine score and a textScore are never compared.
  4. Either side can be missing (no provider or vector index; text index not built yet): the other ranks alone. Only when neither answers do the lists fall back to the title match.
  5. The lists use the fused ids exactly as D-52 used the semantic ones: match "ranked ids or a title containing the text", `relevance` = title matches first, then the fused order.
- **Reason:** It fits the Free cluster with no new cost and no new dependency, and it is testable end to end. RRF needs no score tuning and is what `$rankFusion` does on the server, so moving to option A later changes one service, not the lists.
- **Consequence:**
  - A text search now ranks by words even without `VOYAGE_API_KEY`; the "Best match" sort (client) is meaningful without it.
  - Typos are not forgiven by the keyword side. Moving to a paid tier (or to MongoDB 8.0+ with free indexes to spare) opens option A: replace `keywordIds` with `$search` (fuzzy) and, on 8.0+, the code fusion with `$rankFusion`.
  - Mongoose builds the text indexes at startup (`autoIndex`); on a large collection the first build takes a while, and until then searches rank by meaning only.
  - Next (not here): the RAG assistant on the same retrieval.

