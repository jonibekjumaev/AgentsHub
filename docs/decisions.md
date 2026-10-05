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

**Status:** Accepted. **Partly superseded by D-19** (the existing community chat is kept; there are still no offers and no 1:1 chat).

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
  - `memberPhone` is required and unique in the schema, so the seeded admin also needs a phone value. The seed script must either use a fixed placeholder or read an extra key; decide this when the seed script is written.
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
