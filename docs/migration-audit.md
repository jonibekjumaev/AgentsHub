# AgentsHub — Migration Audit (Step 2)

> Every place in the repo that depends on the Nestar Property domain, or on fields and enums that change according to `docs/agentshub-er.md`.
> Items are grouped by the migration step that should fix them. Paths are relative to the repo root; `api/` = `apps/nestar-api/src/`, `batch/` = `apps/nestar-batch/src/`. Step 3 renames these folders to `apps/agentshub-api/` and `apps/agentshub-batch/` (D-12); after that, read the old paths as the new names.
> `(bug)` = an existing defect found during the audit. Per D-20:
> - Bugs in code that survives the migration, and all security holes, are fixed in **Step 2.5** before step 3.
> - Bugs in code that a later step rewrites stay in that step, marked "fix in its own commit".
> - Every fix is its own `fix: <what>` commit and is never mixed with renames.
> `(decision)` = needs an owner decision; record it in `docs/decisions.md` as **Proposed** first.

Audit baseline: branch `modification`, commit `e994860`.

---

## Step 2.5 — Pre-migration fixes (D-20)

These fixes are made on today's Nestar code, before step 3, and they use today's names (`MemberType.AGENT`, `PropertyStatus`, the `property` upload target). The later rename steps carry them over.

- Each item lists **where**, **fix** and **verify**.
- One item = one commit, with message `fix: <what>`. Never mix in renames or migration changes.
- Run the verification before committing.
- Security holes come first.

### Security
- [x] **S1 — Admin signup and type changes (D-14)**
  - **Where:** `api/libs/dto/member/member.input.ts:23–25`; `api/libs/dto/member/member.update.ts:48–50`
  - **Fix:** make `MemberInput.memberType` required (`@IsNotEmpty()`, non-nullable `@Field`) and limit it with `@IsIn([MemberType.USER, MemberType.AGENT])`. Remove `memberType` from `MemberUpdateByAdmin`.
  - **Verify:**
    - `signup` with `memberType: ADMIN` → validation error, and no member is created
    - `signup` without `memberType` → error
    - `signup` with `USER` or `AGENT` → success
    - `updateMemberByAdmin(input: { _id, memberType: USER })` → GraphQL error "Field "memberType" is not defined", and the stored type is unchanged
  - Step 4 renames `AGENT` → `CREATOR` inside this `@IsIn` list.
- [ ] **S2 — Upload path traversal**
  - **Where:** `api/components/member/member.resolver.ts:115,124` (`imageUploader`) and `:143,156` (`imagesUploader`)
  - **Fix:** reject any `target` that isn't in a whitelist constant `['member', 'property', 'article']` (in `libs/config.ts`), using `BadRequestException`. Do this before building `uploads/${target}/...`.
  - **Verify:**
    - `imageUploader(file, target: "../../tmp")` → `BadRequest`, and no file is written outside `uploads/`
    - the same for `imagesUploader`
    - `target: "member"` → returns `uploads/member/<uuid>.<ext>`
  - Step 3 changes `property` → `product` in the whitelist.
- [ ] **S3 — Chat leaks member fields (D-19 condition 1, D-07)**
  - **Where:** `api/socket/socket.gateway.ts:15–26` (payload types), `66`, `86` (`info`), `96`, `101` (`message` and history), `72` (`getMessages`)
  - **Fix:** every `memberData` sent to clients is a public object `{ _id, memberNick, memberImage, memberType }`, or `null` for guests. Never send the token payload.
  - **Verify:** connect a guest and a logged-in member. On join, message and leave, the guest receives `memberData` with exactly those four keys: no `memberPhone`, `memberStatus`, counters, `iat` or `exp`.
- [x] **S4 — Chat: member status on connection (D-19 condition 7)**
  - **Where:** `socket.gateway.ts:44–58`; `api/socket/socket.module.ts`
  - **Fix:** after `verifyToken`, load the member from the DB by `_id`. If they're missing or not `ACTIVE`, store `null` (a read-only guest). Build S3's public object from this DB record. Give `SocketModule` access to the `Member` model.
  - **Verify:** connect with a valid token of a member whose status is `BLOCK` → the join `info` shows `memberData: null`, and their messages are refused (S5).
- [ ] **S5 — Chat: only authenticated members send (D-19 condition 2)**
  - **Where:** `socket.gateway.ts:93–105`
  - **Fix:** if `clientsAuthMap.get(client)` is `null`, don't store or broadcast. Reply only to the sender with an `error` event.
  - **Verify:** a guest sends `{ "event": "message", "data": "hi" }` → the sender gets `error`, other clients receive nothing, and the history is unchanged.
- [ ] **S6 — Chat: message validation (D-19 condition 3)**
  - **Where:** `socket.gateway.ts:94–96`
  - **Fix:** reject payloads that aren't strings. `trim()` the text, and reject it if empty or longer than 500 characters. Store and broadcast the trimmed text.
  - **Verify:**
    - `"   "` → `error`
    - 501 characters → `error`
    - `123` (a number) → `error`
    - `"  hi  "` → broadcast as `"hi"`
- [ ] **S7 — Chat: rate limit (D-19 condition 4)**
  - **Where:** `socket.gateway.ts:93–105`
  - **Fix:** keep an in-memory `Map<memberId, lastSentAt>`. A message less than 1000 ms after the member's previous one is rejected with `error`.
  - **Verify:**
    - two messages within 1 s from the same member, even from two different sockets → the second gets `error`, and only the first is broadcast
    - a message after 1 s → accepted
- [ ] **S8 — Regex injection in text search**
  - **Where:** `api/components/member/member.service.ts:129,173`; `api/components/board-article/board-article.service.ts:103`
  - **Fix:** escape the user's `text` with a shared `escapeRegex` helper (in `libs/config.ts`) before `new RegExp`.
  - **Verify:**
    - `getAgents` / `getAllMembersByAdmin` / `getBoardArticles` with `text: "("` → a normal (possibly empty) list. Today `new RegExp('(')` throws.
    - `text: "a.b"` matches only the literal `a.b`
  - Step 6 uses the same helper in `property.service.ts:158`.

### Other bugs in surviving code
- [ ] **B1 — `MembersInquiry.search` type**
  - **Where:** `api/libs/dto/member/member.input.ts:123–124`
  - **Fix:** `@Field(() => MISearch)` instead of `AISearch`.
  - **Verify:**
    - the generated GraphQL schema shows `MembersInquiry.search: MISearch!`
    - `getAllMembersByAdmin(input: { page: 1, limit: 10, search: { memberType: USER } })` still works
- [ ] **B2 — `memberImage: null` breaks reads (D-15)**
  - **Where:** `api/libs/dto/member/member.update.ts:27–29` (`MemberUpdate`), `:75–77` (`MemberUpdateByAdmin`)
  - **Fix:** reject `null` for `memberImage`, e.g. `@ValidateIf((o) => o.memberImage !== undefined)` + `@IsString()`. Removing an image sends `''`.
  - **Verify:**
    - `updateMember(input: { memberImage: null })` → validation error
    - `{ memberImage: "" }` → OK
    - `getMember` afterwards returns a string, not a non-null GraphQL error
- [ ] **B3 — Like schema uses the wrong enum**
  - **Where:** `api/schemas/Like.model.ts:2,8`
  - **Fix:** import and use `LikeGroup` instead of `ViewGroup`.
  - **Verify:**
    - `LikeSchema.path('likeGroup').enumValues` equals `Object.values(LikeGroup)`
    - `likeTargetMember` and `likeTargetBoardArticle` still work

    The values are identical today; they diverge in step 4, when `ViewGroup` gains `BRIEF`.
- [ ] **B4 — Favorites list includes deleted items (D-16)**
  - **Where:** `api/components/like/like.service.ts:62`
  - **Fix:** add `{ $match: { 'favoriteProperty.propertyStatus': PropertyStatus.ACTIVE } }` after the `$unwind` and **before** `$facet`.
  - **Verify:** like a property, then set it to `DELETE` with `updateProperty` → `getFavorities` no longer lists it, and `metaCounter[0].total` drops by 1.
  - Step 8 renames this to `favoriteProduct.productStatus`. With `PAUSED`, the same filter also hides paused products.
- [ ] **B5 — Visited list includes deleted items (D-16)**
  - **Where:** `api/components/view/view.service.ts:46`
  - **Fix:** add a `'visitedProperty.propertyStatus': ACTIVE` match after the `$unwind` and before `$facet`.
  - **Verify:** view a property, then delete it → `getVisited` no longer lists it, and the total drops by 1.
  - Step 8 renames it to `visitedProduct.productStatus`.
- [ ] **B6 — Member comment counter goes to the author**
  - **Where:** `api/components/comment/comment.service.ts:50–55`
  - **Fix:** increment `memberComments` on `input.commentRefId` (the member commented on), not on the author's `memberId`.
  - **Verify:** member A comments on member B's profile → B's `memberComments` +1, and A's is unchanged.
- [ ] **B7 — `createComment` doesn't check the target**
  - **Where:** `api/components/comment/comment.service.ts:24–28`
  - **Fix:** before `create`, check that the target exists and is active for its group:
    - `PROPERTY` → `propertyStatus: ACTIVE`
    - `ARTICLE` → `articleStatus: ACTIVE`
    - `MEMBER` → `memberStatus: ACTIVE`

    Otherwise throw `NO_DATA_FOUND` and create nothing.
  - **Verify:**
    - a comment on a random ObjectId → `NO_DATA_FOUND`, no comment stored, no counter changed
    - a comment on a deleted article → the same
    - a comment on an active article → success, `articleComments` +1
  - Step 8 adds `PRODUCT` (`ACTIVE` only, so `PAUSED` is rejected; D-16) and `BRIEF`.
- [ ] **B8 — Board article `meLiked` is always empty**
  - **Where:** `api/components/board-article/board-article.service.ts:119`
  - **Fix:** `lookupAuthMemberLiked(memberId)` (the default `'$_id'`), not `'$followingId'`.
  - **Verify:** like an article, then call `getBoardArticles` as the same member → that article has `meLiked[0].myFavorite: true`.
- [ ] **B9 — Self-engagement on member profiles (D-22)**
  - **Where:** `api/components/member/member.service.ts:99–106` (`getMember`), `:148–160` (`likeTargetMember`)
  - **Fix:** don't record a view when `memberId` equals `targetId`. Reject a self-like with `Message.NOT_ALLOWED_REQUEST`.
  - **Verify:**
    - A calls `getMember(A)` → `memberViews` unchanged
    - A calls `likeTargetMember(A)` → error, `memberLikes` unchanged
    - B viewing or liking A still counts
  - The product half (own product views and likes) is rewritten code, so it is fixed in Step 6.

---

## Step 3 — Config (package names, DB name, env, app names)

### Package and scripts — `package.json`
- [ ] `"name": "nestar"` → `agentshub` (line 2). `package-lock.json` lines 2 and 8 regenerate with `npm install`.
- [ ] `start:prod` runs `dist/apps/nestar/main`, but the app is `nestar-api` (line 15). Fix the path, and rename it again if the app folder is renamed.
- [ ] `start:dev:batch` / `start:prod:batch` refer to `nestar-batch` (lines 13 and 16).
- [ ] `test:e2e` points to `./test/jest-e2e.json`, which does not exist (line 22). The configs are `apps/*/test/jest-e2e.json`.
- [ ] `format` / `lint` globs include `libs/**` and `test/**`, which don't exist at the root (lines 10 and 17). Harmless; clean up optionally.
- [ ] Empty `description` / `author` fields (lines 4–5).

### Monorepo app names — `nest-cli.json`
- [ ] Rename the apps `nestar-api` / `nestar-batch` → `agentshub-api` / `agentshub-batch`, before any domain change (D-12, Accepted). This affects:
  - `nest-cli.json` (`sourceRoot`, `root`, `projects.*`, `tsConfigPath`; lines 4, 8, 11, 13–29)
  - `apps/nestar-api/tsconfig.app.json` line 5 and `apps/nestar-batch/tsconfig.app.json` line 5 (`outDir`)
  - every `../../nestar-api/src/...` import in the batch app (see Step 10)
  - the `package.json` scripts above
  - the folder names in `CLAUDE.md`
  - the existing `dist/apps/nestar-*` build output (delete and rebuild)

### Database and environment — `.env` (gitignored)
- [ ] `MONGODB_DEV` and `MONGODB_PROD` both point to the database **`Nestar`**. Point `MONGODB_DEV` to a new, empty database **`agentsHub`**, so the original Nestar data stays untouched (D-01, D-13).
- [ ] `MONGODB_PROD`: the production database name is decided at deploy time (D-13). Until then, it must not point to `Nestar`.
- [ ] No Nestar data is migrated (D-13, Accepted). Write a seed script (creators, users, products, briefs) for development.
- [ ] No `.env.example` exists. Add one listing `PORT_API`, `PORT_BATCH`, `MONGODB_DEV`, `MONGODB_PROD` and `SECRET_TOKEN`.
- [ ] Both `api/database/database.module.ts` and `batch/database/database.module.ts` (line 9) pick the URI by `NODE_ENV`. No change needed; keep them in sync.

### Branding strings
- [ ] `api/app.service.ts:6`: `'Hello to Nestar API server!'`
- [ ] `batch/batch.service.ts:74`: `'Hello to Nestar BATCH server!'`
- [x] `README.md`: stock NestJS README. Replace it with an AgentsHub README.
- [x] `AGENTS.md` and `SKILLS.md` call the project **"Petoria"**. Correct them to AgentsHub.
- [ ] `CLAUDE.md`: update the app names and paths after the rename. Also remove the "Known issues" entries once they are fixed.

### Uploads
- [ ] `uploads/property/` → `uploads/product/` (the folder is local and gitignored, so create it on each machine).
- [ ] Upload target whitelist (added in Step 2.5, S2): change `property` → `product`, together with the folder rename above.

---

## Step 4 — Enums (`api/libs/enums/`)

- [ ] `member.enum.ts:5`: `MemberType.AGENT = 'AGENT'` → `CREATOR = 'CREATOR'`.
- [ ] `property.enum.ts` → rename to `product.enum.ts`:
  - [ ] Delete `PropertyType` (APARTMENT/VILLA/HOUSE, lines 3–10).
  - [ ] Delete `PropertyLocation` (Korean cities, lines 21–34) (D-10).
  - [ ] `PropertyStatus { ACTIVE, SOLD, DELETE }` → `ProductStatus { ACTIVE, PAUSED, DELETE }`. `SOLD` goes away together with `soldAt` (D-10).
  - [ ] Add `ProductPricing { FREE, ONE_TIME, SUBSCRIPTION, CUSTOM }` (D-03).
- [ ] New `AgentCategory { CUSTOMER_SUPPORT, SALES, MARKETING, CONTENT, DATA_ANALYSIS, AUTOMATION, EDUCATION, OTHER }`. Put it in its own file (e.g. `agent-category.enum.ts`), because products and briefs share it (D-09).
- [ ] New `brief.enum.ts`: `BriefStatus { OPEN, CLOSED, DELETE }`.
- [ ] `like.enum.ts:5`: `LikeGroup.PROPERTY` → `PRODUCT`. **No** `BRIEF` (briefs can't be liked).
- [ ] `view.enum.ts:6`: `ViewGroup.PROPERTY` → `PRODUCT`, and add `BRIEF`.
- [ ] `comment.enum.ts:14`: `CommentGroup.PROPERTY` → `PRODUCT`, and add `BRIEF`.
- [ ] `notification.enum.ts:22`: `NotificationGroup.PROPERTY` → `PRODUCT`, and add `BRIEF`.
- [ ] `common.enum.ts`: add `Message` strings for the new rules, such as:
  - price required, or price not allowed, for the given pricing (D-03)
  - budget must be > 0 (D-04)
  - deadline must be in the future (D-05)
  - brief already closed
- [ ] Each rename changes the GraphQL enum value. Changing them together with Steps 5–8 keeps the API compiling. Every usage is listed below.

---

## Step 5 — Member

### Schema — `api/schemas/Member.model.ts`
- [ ] Remove `memberAddress` (lines 51–53).
- [ ] `memberProperties` → `memberProducts` (lines 59–62).
- [ ] Add `memberBriefs: { type: Number, default: 0 }`.
- [ ] Add `memberEmail` and `memberWhatsapp` (String, optional).
- [x] `memberImage` default stays `''` (line 48); the ER doc now matches (D-15). No schema change. Do **not** add Mongoose `required: true`, because it rejects `''`.
- `memberImage: null` on update (D-15): fixed in Step 2.5 (B2).

### DTOs — `api/libs/dto/member/`
- [ ] `member.ts`:
  - remove `memberAddress` (35–36)
  - `memberProperties` → `memberProducts` (41–42)
  - add `memberBriefs`, plus `memberEmail` and `memberWhatsapp` as nullable fields
- [ ] `member.input.ts`:
  - `AgentsInquiry` (61) → `CreatorsInquiry`
  - its `AISearch` class (46) → e.g. `CISearch`
  - the import of `aviableAgentSorts` (5, 73)
- `MembersInquiry.search` type: fixed in Step 2.5 (B1).
- Signup `memberType` restriction and removal from `MemberUpdateByAdmin` (D-14): fixed in Step 2.5 (S1). Keep the `@IsIn` list intact through step 4's `AGENT → CREATOR` rename.
- [ ] `member.update.ts`:
  - `memberAdress` (typo; it never matched the schema) at lines 32–33 and 80–81: remove it
  - add `memberEmail` (`@IsEmail`) and `memberWhatsapp` to `MemberUpdate` and `MemberUpdateByAdmin`

### Service — `api/components/member/member.service.ts`
- [ ] `getAgents` (123) → `getCreators`. It filters `memberType: MemberType.AGENT` (126).
- [ ] `getAgents` checks `if (!result)` instead of `!result.length` (144). Make it consistent with the other list queries.
- [ ] `getMember` (87) and the list queries return the whole document. The contact-visibility hook for `memberEmail`/`memberWhatsapp` goes here (D-07; the approach is chosen in **step 9**). Paths that must hide them from guests:
  - `getMember` (and `getMember(null, …)` when it is embedded as `memberData` in product, brief and article getters)
  - `getCreators`
  - `lookupMember`, `lookupFollowingData`, `lookupFollowerData`, `lookupFavorite` and `lookupVisit` in `api/libs/config.ts`
  - `lookupMember`, which `getProducts` / `getBriefs` / comments use
- [ ] `memberStatsEditor` callers that pass `'memberProperties'` are listed in Step 6.

### Resolver — `api/components/member/member.resolver.ts`
- [ ] `getAgents` query (72–77) → `getCreators`, using `CreatorsInquiry`.
- [ ] `checkAuthRoles` uses `@Roles(MemberType.USER, MemberType.AGENT)` (44).

### Config — `api/libs/config.ts`
- [ ] `aviableAgentSorts` (6) → `aviableCreatorSorts`. Consider adding `memberProducts`.

### Auth side effect
- [ ] `api/components/auth/auth.service.ts:21–31` puts the **whole member** in the JWT, and `RolesGuard` (`guards/roles.guard.ts:30`) reads `memberType` from the token. Tokens issued before the rename still carry `AGENT` and `memberProperties` for up to 30 days. Rotate `SECRET_TOKEN` or force a re-login after the migration.

---

## Step 6 — Product (replaces Property)

### Files to rename
- [ ] `api/schemas/Property.model.ts` → `Product.model.ts`
- [ ] `api/libs/dto/property/{property,property.input,property.update}.ts` → `libs/dto/product/product*.ts`
- [ ] `api/components/property/{property.module,property.resolver,property.service}.ts` → `components/product/product*.ts`
- [ ] `api/components/components.module.ts:3,15`: `PropertyModule` → `ProductModule`

### Schema — `Property.model.ts` → `Product.model.ts`
- [ ] Remove these fields (D-10):
  - `propertyType` (6–10)
  - `propertyLocation` (18–22)
  - `propertyAddress` (24–27)
  - `propertySquare` (39–42)
  - `propertyBeds` (44–47)
  - `propertyRooms` (49–52)
  - `propertyBarter` (83–86)
  - `propertyRent` (88–91)
  - `soldAt` (99–101)
  - `constructedAt` (107–109)
- [ ] Rename `property*` → `product*`: Status, Title, Price, Views, Likes, Comments, Rank, Images and Desc.
- [ ] `productPrice`: `required: true` (36) → optional (D-03).
- [ ] Make productDesc required (schema + input validation) (D-18):
  - schema: `propertyDesc` (79–81) → `productDesc: { type: String, required: true }`
  - `ProductInput`: `@IsNotEmpty()` instead of `@IsOptional()`; keep `@Length`
  - `Product` output type: non-null `@Field(() => String)` instead of `nullable: true` (`property.ts:54–55`)
  - `ProductUpdate`: stays optional, but must reject `null` and `''` so the description can't be cleared
- [ ] Add these fields:
  - `productCategory` (AgentCategory, required)
  - `productPricing` (ProductPricing, required)
  - `productDemoUrl` (String)
  - `productTags` ([String])
- [ ] `collection: 'properties'` (111) → `'products'`.
- [ ] Replace the unique index `{ propertyType, propertyLocation, propertyTitle, propertyPrice }` (114) with the indexes from the ER doc:
  - unique `{ memberId: 1, productTitle: 1 }`
  - `{ memberId: 1, productStatus: 1 }`
  - `{ productCategory: 1, productStatus: 1 }`
  - `{ productStatus: 1, productRank: -1 }`
- [ ] Mongoose model name `'Property'` → `'Product'`. It is used in `property.module.ts:15`, `property.service.ts:29`, `batch/batch.module.ts:16`, `batch/batch.service.ts:12` and the `ref: 'Property'` in `Notification.model.ts:47`.

### DTO — `property.ts` → `product.ts`
- [ ] `Property` / `Properties` → `Product` / `Products`.
- [ ] Remove `propertyType`, `propertyLocation`, `propertyAddress`, `propertySquare`, `propertyBeds`, `propertyRooms`, `propertyBarter`, `propertyRent`, `soldAt` and `constructedAt` (12–37, 57–61, 66–73).
- [ ] `propertyType`, `propertyStatus` and `propertyLocation` are exposed as `@Field(() => String)`, not as their enums (12–19). Use `@Field(() => ProductStatus)` and so on for the new enum fields. (bug, fix in its own commit)
- [ ] Add `productCategory`, `productPricing`, `productPrice` (nullable Float), `productDemoUrl` (nullable) and `productTags` (nullable `[String]`).

### DTO — `property.input.ts` → `product.input.ts`
- [ ] `PropertyInput` (9–70) → `ProductInput`:
  - drop Type, Location, Address, Square, Beds, Rooms, Barter, Rent and `constructedAt`
  - make `productPrice` optional (`@Min` > 0 is checked in the service, D-03)
  - `productImages`: `@ArrayMinSize(1)`
  - `productDesc`: required (D-18; see the schema item above)
  - `productDemoUrl`: `@IsUrl({ protocols: ['http','https'], require_protocol: true })`
  - `productTags`: optional `[String]`
- [ ] Remove `SquaresRange` (81–88). Decide whether `PeriodsRange` (90–97) is still needed.
- [ ] `PricesRange` (73–79) uses `Int`. Prices are Float in USD (D-06), so use `Float`. Per D-03, price filters must only match `ONE_TIME` / `SUBSCRIPTION`.
- [ ] `PIsearch` (99–141):
  - remove `locationList`, `typeList`, `roomsList`, `bedsList`, `options` and `squaresRange`
  - add `categoryList: AgentCategory[]`, `pricingList: ProductPricing[]` and `tagList?`
- [ ] `PropertiesInquiry` (144) → `ProductsInquiry`.
- [ ] `AgentPropertiesInquiry` (177) → `CreatorProductsInquiry`. `APISearch.propertyStatus` → `productStatus`.
- [ ] `AllPropertiesInquiry` (214) → `AllProductsInquiry`. In `ALPISearch`, `propertyLocationList` (209) → `productCategoryList`.
- [ ] `OrdinaryInquiry` (240–250) is generic, but it lives in the property DTO and is imported by `like.service.ts:8` and `view.service.ts:6`. Move it to a shared place, e.g. `libs/dto/common.input.ts`.

### DTO — `property.update.ts` → `product.update.ts`
- [ ] Remove Type, Location, Address, Square, Beds, Rooms, Barter, Rent, `soldAt` and `constructedAt`.
- [ ] Add `productCategory`, `productPricing`, `productPrice`, `productDemoUrl` and `productTags`.

### Service — `property.service.ts` → `product.service.ts`
- [ ] `createProperty` (35–50):
  - add the D-03 price/pricing check
  - the memberStatsEditor key `'memberProperties'` (41) → `'memberProducts'`
- [ ] `getProperty` (52–76):
  - `ViewGroup.PROPERTY` (62) → `PRODUCT`
  - `LikeGroup.PROPERTY` (70) → `PRODUCT`
  - `'propertyViews'` → `'productViews'`
- [ ] `updateProperty` (78–101):
  - remove the `SOLD` → `soldAt` branch (87, 93)
  - run D-03 on the **merged** pricing/price, so the existing doc must be loaded first
  - `'memberProperties'` (96) → `'memberProducts'`
- [ ] `getProduct` (D-16):
  - `ACTIVE` → everyone
  - `PAUSED` → only the owner (`memberId` matches the caller) or an `ADMIN` caller; everyone else gets `NO_DATA_FOUND`
  - `DELETE` → nobody
  - The current search allows only `ACTIVE` (55).
- [ ] `getProduct` (D-16): record **no view** and don't increment `productViews` when the product is `PAUSED`, even for the owner.
- [ ] `updateProduct` (D-16):
  - match `productStatus: { $ne: DELETE }` instead of `ACTIVE` (84), so a paused product can be resumed
  - allowed owner transitions: `ACTIVE ↔ PAUSED`, and `ACTIVE | PAUSED → DELETE`
- [ ] `updateProduct` / `updateProductByAdmin` (D-16):
  - `memberProducts` −1 only on a transition to `DELETE` (from `ACTIVE` or `PAUSED`)
  - **no** counter change on pause or unpause
- [ ] `updateProductByAdmin` (D-16): match `productStatus ≠ DELETE`, the same as the owner update (257).
- [ ] `getProperties` / `shapeMatchQuery` (103–164):
  - remove the location/rooms/beds/type/squares/options filters and the `$or` for options
  - add category/pricing/tag filters
  - text search on `productTitle` (and maybe `productTags`)
  - (bug, fix in its own commit) `text` goes into `new RegExp` unescaped (158). Use the `escapeRegex` helper added in Step 2.5 (S8); the member and board-article cases are already fixed there.
  - keep the `productStatus: ACTIVE` match (104) for every caller, including the `memberId` filter used on other members' profiles. Paused products never appear here, not even for the owner (D-16).
- [ ] `getCreatorProducts` (D-16): the owner sees `ACTIVE` + `PAUSED` (the current `≠ DELETE` match, 180). Keep it.
- [ ] `getFavorities` / `getVisited` (166–172) call `likeService.getFavoriteProperties` / `viewService.getVisitedProperties` (see Step 8). Keep the misspelled operation name `getFavorities` (convention).
- [ ] `getAgentProperties` (174–204) → `getCreatorProducts`.
- [ ] `likeTargetProperty` (206–222):
  - `LikeGroup.PROPERTY` (213) → `PRODUCT`
  - `'propertyLikes'` → `'productLikes'`
  - keep the `ACTIVE`-only target check (207). It rejects likes **and** unlikes on `PAUSED` products (D-16).
- [ ] `getAllPropertiesByAdmin` (224–251): `propertyLocationList` filter → category filter. Admins see every status, including `PAUSED` (D-16).
- [ ] `updatePropertyByAdmin` (253–275): the same `SOLD`/`soldAt` removal, plus `'memberProperties'` (269).
- [ ] `removePropertyByAdmin` (277–286) (bug, fix in its own commit): `findByIdAndDelete(search)` passes an object as the id. Use `findOneAndDelete(search)`.
- [ ] (bug, D-22, fix in its own commit) Self-engagement on own products:
  - `getProduct` must not record a view when the caller owns the product (`property.service.ts:61`)
  - `likeTargetProduct` must reject liking your own product (`:206`)

  The profile half is fixed in Step 2.5 (B9).
- [ ] `propertyStatsEditor` (288) → `productStatsEditor`. Callers: `comment.service.ts:37`.

### Resolver — `property.resolver.ts` → `product.resolver.ts`
- [ ] `@Roles(MemberType.AGENT)` → `CREATOR` on create (26), update (49) and `getAgentProperties` (91).
- [ ] Rename the operations:
  - `createProperty` → `createProduct`
  - `getProperty` → `getProduct`
  - `updateProperty` → `updateProduct`
  - `getProperties` → `getProducts`
  - `getAgentProperties` → `getCreatorProducts`
  - `likeTargetProperty` → `likeTargetProduct`
  - `getAllPropertiesByAdmin` → `getAllProductsByAdmin`
  - `updatePropertyByAdmin` → `updateProductByAdmin`
  - `removePropertyByAdmin` → `removeProductByAdmin`
- [ ] Rename the `@Args('propertyId')` arguments (41, 105, 135) → `'productId'`.
- [ ] The admin mutations log `'Query: …'` (127, 136). Fix them to `'Mutation: …'`.

### Config — `api/libs/config.ts`
- [ ] `aviableOptions = ['propertyBarter','propertyRent']` (9): remove it (D-10).
- [ ] `aviablePropertySorts` (10–17) → `aviableProductSorts`, with `product*` keys.

---

## Step 7 — Brief (new module)

- [ ] `api/schemas/Brief.model.ts`:
  - fields as in the ER doc, with `collection: 'briefs'` and `briefStatus` default `OPEN`
  - indexes `{ memberId: 1, briefStatus: 1 }` and `{ briefCategory: 1, briefStatus: 1, createdAt: -1 }`
- [ ] `api/libs/dto/brief/brief.ts`: `Brief` and `Briefs { list, metaCounter }`, plus `memberData` from aggregation.
- [ ] `api/libs/dto/brief/brief.input.ts`:
  - `BriefInput`: `briefBudget` optional with `@Min` > 0 (D-04); `briefDeadline` optional (D-05, checked in the service)
  - `BriefsInquiry`: category, status and text search; the budget sort must put empty budgets last (D-04)
  - `MyBriefsInquiry`
  - `AllBriefsInquiry`
- [ ] `api/libs/dto/brief/brief.update.ts`: `BriefUpdate`, which requires `_id`.
- [ ] `api/components/brief/brief.service.ts`:
  - create: D-04/D-05 checks; `memberBriefs` +1
  - get: `ViewGroup.BRIEF` view counting with the `briefViews` counter
  - update: D-05 check on update; `CLOSED` sets `closedAt`; `DELETE` sets `deletedAt` and `memberBriefs` −1
  - `getBriefs`, `getMyBriefs`, `briefStatsEditor`
  - admin: `getAllBriefsByAdmin`, `updateBriefByAdmin`, `removeBriefByAdmin`
- [ ] `api/components/brief/brief.resolver.ts`:
  - `@Roles(MemberType.USER)` on create/update/close/delete (ER rule 2)
  - `WithoutGuard` on reads
  - admin section
- [ ] `api/components/brief/brief.module.ts`: import Auth, Member and View, then register it in `api/components/components.module.ts`.
- [ ] `api/libs/config.ts`: add `aviableBriefSorts` (`createdAt`, `updatedAt`, `briefViews`, `briefBudget`, `briefDeadline`).
- [ ] Briefs have no likes (no `briefLikes`, and `LikeGroup` has no `BRIEF`), so there is no `likeTargetBrief` and no `meLiked`.

---

## Step 8 — Dependent modules (like, view, comment, notification, others)

### Like
- `Like.model.ts` uses the wrong enum (`ViewGroup`): fixed in Step 2.5 (B3).
- [x] `api/schemas/Like.model.ts:26`: the unique index `{ memberId, likeRefId }` is kept; the ER doc now matches (D-18). No code change.
- [ ] `api/components/like/like.service.ts`:
  - `getFavoriteProperties` (46–83) → `getFavoriteProducts`
  - `LikeGroup.PROPERTY` (48)
  - `$lookup from: 'properties'` (56) → `'products'`
  - alias `favoriteProperty` (59, 62, 69, 80) → `favoriteProduct`
  - return type `Properties`
  - imports `OrdinaryInquiry` / `Properties` from the property DTO (8–9)
- [ ] Favorites `ACTIVE` filter (added in Step 2.5, B4): rename it to `'favoriteProduct.productStatus': ProductStatus.ACTIVE`, keeping it before `$facet`. This also hides `PAUSED` products (D-16).
- [ ] `api/libs/config.ts:132–139`: `lookupFavorite` uses `favoriteProperty.memberId` / `favoriteProperty.memberData` → `favoriteProduct.*`.

### View
- [x] `api/schemas/View.model.ts:26`: the unique index `{ memberId, viewRefId }` is kept; the ER doc now matches (D-18). No code change.
- [ ] `api/components/view/view.service.ts`:
  - `getVisitedProperties` (30–65) → `getVisitedProducts`
  - `ViewGroup.PROPERTY` (32)
  - `from: 'properties'` (40)
  - alias `visitedProperty` (43, 46, 53, 62) → `visitedProduct`
  - imports (6, 8)
- [ ] Visited `ACTIVE` filter (added in Step 2.5, B5): rename it to `'visitedProduct.productStatus': ProductStatus.ACTIVE`, keeping it before `$facet` (D-16).
- [ ] `api/libs/config.ts:141–148`: `lookupVisit` uses `visitedProperty.*` → `visitedProduct.*`.

### Comment
- [ ] `api/components/comment/comment.service.ts`:
  - `PropertyService` import and injection (10, 20)
  - `case CommentGroup.PROPERTY` → `propertyStatsEditor('propertyComments')` (36–42) becomes `PRODUCT` → `productStatsEditor('productComments')`
  - add `case CommentGroup.BRIEF` → `briefStatsEditor('briefComments')`
- [ ] `api/components/comment/comment.module.ts:10,24`: `PropertyModule` → `ProductModule`, and add `BriefModule`.
- `MEMBER` comment counter on the author: fixed in Step 2.5 (B6).
- [ ] `createComment` target check (added in Step 2.5, B7 for `PROPERTY`/`ARTICLE`/`MEMBER`):
  - rename the `PROPERTY` case to `PRODUCT`; the target must be `ACTIVE`, so comments on `PAUSED` products are rejected (D-16)
  - add `BRIEF` (target must exist and not be `DELETE`)
- [ ] `getComments` (D-16, child records inherit the parent's visibility): for a `PRODUCT` target, load the product first.
  - `ACTIVE` → return comments to everyone
  - `PAUSED` → return comments only if the caller is the owner or an `ADMIN`
  - otherwise (paused for other callers, `DELETE`, or missing) → throw `NO_DATA_FOUND`

  This requires:
  - `comment.input.ts:27–31`: add a required `commentGroup` to `CISearch` (a GraphQL API change; add it to the Step 12 table)
  - `comment.resolver.ts:41–50`: pass the caller's `memberType` (or the whole `authMember`) to the service, not only `_id`

### Notification (schema only; no module yet)
- [ ] `api/schemas/Notification.model.ts`:
  - `propertyId` with `ref: 'Property'` (45–48) → `productId` with `ref: 'Product'`
  - add `briefId` with `ref: 'Brief'`
- [x] `Notification.model.ts:29–31`: `notificationDesc` stays optional; the ER doc now matches (D-18). No code change.
- [ ] `NotificationGroup` is covered in Step 4.

### Board article, follow, notice
- Board-article `meLiked` lookup: fixed in Step 2.5 (B8).
- [ ] Board articles, follows and notices (`api/schemas/Notice.model.ts`) have no Property dependency and need no change. Some Uzbek comments in `follow.service.ts` (78, 86, 111) mention "agent" in the realtor sense. Leave them as they are (convention).

### Socket (D-19: kept, partly superseding D-08)
- [x] Keep `api/socket/socket.gateway.ts` / `socket.module.ts` (registered in `api/app.module.ts:12,41`, WS adapter in `api/main.ts:7,20`) as the community chat (D-19).
- D-19 conditions 1, 2, 3, 4 and 7 (public fields only, authenticated senders, validation, rate limit, status on connection) are security fixes on surviving code, so they're fixed in Step 2.5 (S3–S7).
- [ ] After Step 4/5, check that the public chat member still has exactly `{ _id, memberNick, memberImage, memberType }`, and that the new `memberEmail` / `memberWhatsapp` fields are not added to it.
- [ ] Never log the socket connection URL (D-19, accepted risk: the token is in `?token=`). Keep `socket.gateway.ts:46` parse-only. Don't add the URL or the token to any log line. When deploying, check that the reverse proxy's access logs exclude the query string for the socket endpoint.

---

## Step 10 — Batch (`apps/nestar-batch/`)

- [ ] `batch/batch.module.ts:9,16`: imports `PropertySchema` from `../../nestar-api/src/schemas/Property.model` and registers it as `'Property'` → `ProductSchema` / `'Product'`.
- [ ] `batch/batch.service.ts`:
  - imports `Property` / `PropertyStatus` (3, 6)
  - `@InjectModel('Property') propertyModel` (12) → `productModel`
- [ ] `batchRollback` (15–36):
  - `propertyStatus: ACTIVE` / `propertyRank` (19, 21) → `product*`
  - reset `productRank` for all non-deleted products (`productStatus ≠ DELETE`), not only `ACTIVE`, so a product that is reactivated doesn't keep a stale rank (D-16)
  - `memberType: MemberType.AGENT` (29) → `CREATOR`
- [ ] `batchProperties` (38–53) → `batchProducts`. The rank becomes `productLikes*2 + productViews*1` (line 48: rename the fields only; weights unchanged). Comments are never used (D-17).
  - keep ranking only `ACTIVE` products (41). Paused products get no rank (D-16).
- [ ] `batchAgents` (55–71) → `batchCreators`:
  - `memberType: AGENT` (58)
  - formula (65–66) `memberProperties*5 + memberArticles*3 + memberLikes*2 + memberViews*1` → **`memberLikes*2 + memberViews*1`** (D-22). Drop `memberProperties`/`memberProducts` and `memberArticles` from both the formula and the destructuring at line 65. The creator's own post counts are not a ranking signal.
- Self-engagement in rankings (D-22): the profile half is fixed in Step 2.5 (B9), and the product half in Step 6 (its own commit).
- [ ] `batch/batch.controller.ts`:
  - `BATCH_TOP_PROPERTIES` / `BATCH_TOP_AGENTS` (4, 35, 46)
  - `batchTopProperties` / `batchTopAgents` (36, 47)
  - logger contexts (38, 49)
  - the commented-out nightly job (62–73) calls `batchProperties` / `batchAgents`
- [ ] `batch/batch.controller.ts:8`: `new Logger('BatchController.name')` is a string literal, not `BatchController.name`. (cosmetic)
- [ ] `batch/libs/config.ts:6–7`: `BATCH_TOP_PROPERTIES` → `BATCH_TOP_PRODUCTS` and `BATCH_TOP_AGENTS` → `BATCH_TOP_CREATORS`.
- [ ] `batch/batch.service.ts:74`: hello string (see Step 3).
- [ ] `apps/nestar-batch/test/app.e2e-spec.ts:4,11` (bug, fix in its own commit; it stays here because steps 3 and 10 change both the module class name and the hello string it asserts): imports `NestarBatchModule`, which doesn't exist (the class is `BatchModule`). Under D-21 the class may become `AgentsHubBatchModule`; either way, the spec must import the class's actual name. It also expects `'Hello World!'` (19). The spec can't compile.
- [ ] Ranking rollback only resets members with `memberStatus: ACTIVE`. Blocked or deleted creators keep a stale `memberRank`. (minor)

---

## Step 12 — Frontend

- [ ] **There is no frontend code in this repo.** No `apps/*` web app, no `pages/`, and no Next/React files were found. The frontend lives in a separate repo, so audit it separately.
- [ ] Use this list of GraphQL contract changes from Steps 4–8 when converting the frontend:

  | Nestar | AgentsHub |
  |---|---|
  | `MemberType.AGENT` | `CREATOR` |
  | `Member.memberProperties`, `memberAddress` | `memberProducts`, plus new `memberBriefs`, `memberEmail`, `memberWhatsapp` (`null` for guests) |
  | `getAgents(AgentsInquiry)` | `getCreators(CreatorsInquiry)` |
  | `Property`, `Properties` types | `Product`, `Products` |
  | `createProperty`, `getProperty(propertyId)`, `updateProperty`, `getProperties`, `getAgentProperties`, `likeTargetProperty(propertyId)` | `createProduct`, `getProduct(productId)`, `updateProduct`, `getProducts`, `getCreatorProducts`, `likeTargetProduct(productId)` |
  | `getAllPropertiesByAdmin`, `updatePropertyByAdmin`, `removePropertyByAdmin(propertyId)` | `getAllProductsByAdmin`, `updateProductByAdmin`, `removeProductByAdmin(productId)` |
  | `getFavorities`, `getVisited` (return `Properties`) | same names, return `Products` |
  | Property search: `locationList`, `typeList`, `roomsList`, `bedsList`, `options`, `squaresRange` | removed; replaced by `categoryList`, `pricingList`, tags |
  | `PropertyStatus.SOLD`, `soldAt`, `constructedAt`, barter/rent | removed; `ProductStatus.PAUSED` added |
  | `LikeGroup` / `ViewGroup` / `CommentGroup` `PROPERTY` | `PRODUCT` (+ `BRIEF` for view/comment) |
  | `imagesUploader(target: "property")` | `target: "product"` |
  | — | new `Brief` queries and mutations (Step 7) |
  | `getComments(search: { commentRefId })` | `search: { commentRefId, commentGroup }`. `commentGroup` is required; a paused or missing product returns `NO_DATA_FOUND` (D-16) |

- [ ] In the frontend repo, remove the real-estate pages and filters (location, beds, rooms, square, barter/rent, sold state) in the same step (D-10).
- [ ] Contact info must come from the API's null-for-guests behaviour, not only from hiding it in the UI (D-07).
- [ ] Show placeholder when memberImage is '' (D-15).
- [ ] Community chat (D-19):
  - render message text as plain text only (text nodes, or the framework's default escaping), never as HTML (`innerHTML` / `dangerouslySetInnerHTML`)
  - hide the send box for guests (they can only read)
  - show the server's validation and rate-limit errors
  - use only the public member fields (`_id`, `memberNick`, `memberImage`, `memberType`)
- [ ] Owner product management: pause/resume buttons (`ACTIVE ↔ PAUSED`), and a "paused" badge in the owner's own product list (D-16).
- [ ] Handle `NO_DATA_FOUND` from `getProduct` for paused products (e.g. old links and shared URLs). Hide like/comment controls on the owner's own paused product (D-16).

---

## Open decisions (recorded in `docs/decisions.md` as D-12 … D-20)

1. Rename the apps `nestar-api` / `nestar-batch` (Step 3). **Accepted as D-12:** `agentshub-api` / `agentshub-batch`.
2. Fresh DB vs. migrating Nestar members (Step 3). **Accepted as D-13:** new empty dev database `agentsHub` plus a seed script.
3. Restrict `memberType` at signup to `USER | CREATOR` (Step 5, D-02). **Accepted as D-14:** required `@IsIn([USER, CREATOR])` at signup, no `memberType` in any update input, first admin created only by the seed script.
4. Default `memberImage` path (Step 5). **Accepted as D-15:** default `''` means no image. The frontend shows a placeholder, and the DB never stores a placeholder path.
5. `PAUSED` semantics: counter effect, owner visibility, and re-activation (Step 6). **Accepted as D-16:** option B. Visible only to the owner and admins. No likes, views or comments. Owner toggles `ACTIVE ↔ PAUSED`. `memberProducts` changes only on create and delete. Favorites/visited show `ACTIVE` only.
6. Does `productComments` count in product ranking? (Step 10) **Accepted as D-17:** no. Product ranking uses only likes and views; a ranking signal must not be inflatable by a single member. The current formula already complies, so Step 10 only renames the fields.
7. Like/View index field order vs. the ER doc; `notificationDesc` NN vs. optional (Step 8). **Accepted as D-18:** keep the memberId-first indexes (ER doc updated). `notificationDesc` becomes optional (ER doc updated). `productDesc` becomes required (code fixed in Step 6). Rule: choose what is right for the product, not whichever was written first.
8. Keep or remove the WebSocket chat (Step 8, D-08). **Accepted as D-19:** keep the community chat, which partly supersedes D-08. Conditions: public fields only, authenticated senders only, 1–500 trimmed characters, 1 message per second per member, plain-text rendering. A 1:1 chat needs its own decision.
9. When to fix the existing bugs. **Accepted as D-20:** option C (hybrid).
   - Bugs in surviving code, and all security holes, are fixed in Step 2.5 before step 3, security first (S1–S8, then B1–B9).
   - Bugs in rewritten code are fixed inside their step.
   - Each fix gets its own `fix: <what>` commit and a verification.
