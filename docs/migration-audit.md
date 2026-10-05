# AgentsHub — Migration Audit (Step 2)

> Every place in the repo that depends on the Nestar Property domain, or on fields and enums that change according to `docs/agentshub-er.md`.
> Items are grouped by the migration step that should fix them. Paths are relative to the repo root; `api/` = `apps/nestar-api/src/`, `batch/` = `apps/nestar-batch/src/`. Step 3 renames these folders to `apps/agentshub-api/` and `apps/agentshub-batch/` (D-12); after that, read the old paths as the new names.
> `(bug)` = an existing defect found during the audit. Fix it in the step where the file is touched anyway.
> `(decision)` = needs an owner decision; record it in `docs/decisions.md` as **Proposed** first.

Audit baseline: branch `modification`, commit `e994860`.

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
- [ ] `api/components/member/member.resolver.ts:115,143`: `target` is a free string that goes straight into the file path `uploads/${target}/...`, which allows path traversal. Whitelist it to `member | product | article`. (bug)

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
- [ ] `member.update.ts`: `memberImage: null` in `MemberUpdate` / `MemberUpdateByAdmin` must be rejected or converted to `''`, so the non-null GraphQL field never receives `null` (D-15).

### DTOs — `api/libs/dto/member/`
- [ ] `member.ts`:
  - remove `memberAddress` (35–36)
  - `memberProperties` → `memberProducts` (41–42)
  - add `memberBriefs`, plus `memberEmail` and `memberWhatsapp` as nullable fields
- [ ] `member.input.ts`:
  - `AgentsInquiry` (61) → `CreatorsInquiry`
  - its `AISearch` class (46) → e.g. `CISearch`
  - the import of `aviableAgentSorts` (5, 73)
- [ ] `member.input.ts:123–124` (bug): `MembersInquiry.search` is declared as `@Field(() => AISearch)` but typed as `MISearch`. Use `MISearch`.
- [ ] `member.input.ts:23–25` (decision, D-02): `MemberInput.memberType` accepts **any** `MemberType`, including `ADMIN`, at signup. Restrict it to `USER | CREATOR`.
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
- [ ] `productDesc` is optional now (79–81). The ER doc says **NN**, so make it required.
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
- [ ] `propertyType`, `propertyStatus` and `propertyLocation` are exposed as `@Field(() => String)`, not as their enums (12–19). Use `@Field(() => ProductStatus)` and so on for the new enum fields. (bug)
- [ ] Add `productCategory`, `productPricing`, `productPrice` (nullable Float), `productDemoUrl` (nullable) and `productTags` (nullable `[String]`).

### DTO — `property.input.ts` → `product.input.ts`
- [ ] `PropertyInput` (9–70) → `ProductInput`:
  - drop Type, Location, Address, Square, Beds, Rooms, Barter, Rent and `constructedAt`
  - make `productPrice` optional (`@Min` > 0 is checked in the service, D-03)
  - `productImages`: `@ArrayMinSize(1)`
  - `productDesc`: required
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
  - (bug) `text` goes into `new RegExp` unescaped (158). The same applies in `member.service.ts:129,173` and `board-article.service.ts:103`.
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
- [ ] `removePropertyByAdmin` (277–286) (bug): `findByIdAndDelete(search)` passes an object as the id. Use `findOneAndDelete(search)`.
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
- [ ] `api/schemas/Like.model.ts:2,8` (bug): `likeGroup` is validated against **`ViewGroup`** instead of `LikeGroup`. After Step 4 this would allow `likeGroup: BRIEF`. Import `LikeGroup`.
- [ ] `api/schemas/Like.model.ts:26`: the unique index is `{ memberId, likeRefId }`, but the ER doc says `{ likeRefId: 1, memberId: 1 }`. Align them, or record why they differ.
- [ ] `api/components/like/like.service.ts`:
  - `getFavoriteProperties` (46–83) → `getFavoriteProducts`
  - `LikeGroup.PROPERTY` (48)
  - `$lookup from: 'properties'` (56) → `'products'`
  - alias `favoriteProperty` (59, 62, 69, 80) → `favoriteProduct`
  - return type `Properties`
  - imports `OrdinaryInquiry` / `Properties` from the property DTO (8–9)
- [ ] `like.service.ts` (bug, D-16): `getFavoriteProducts` must return only `ACTIVE` products. Add `{ $match: { 'favoriteProduct.productStatus': ProductStatus.ACTIVE } }` after the `$unwind` (62) and **before** `$facet`, so `metaCounter` matches the list.
- [ ] `api/libs/config.ts:132–139`: `lookupFavorite` uses `favoriteProperty.memberId` / `favoriteProperty.memberData` → `favoriteProduct.*`.

### View
- [ ] `api/schemas/View.model.ts:26`: the index order is `{ memberId, viewRefId }`; the ER doc says `{ viewRefId: 1, memberId: 1 }`.
- [ ] `api/components/view/view.service.ts`:
  - `getVisitedProperties` (30–65) → `getVisitedProducts`
  - `ViewGroup.PROPERTY` (32)
  - `from: 'properties'` (40)
  - alias `visitedProperty` (43, 46, 53, 62) → `visitedProduct`
  - imports (6, 8)
- [ ] `view.service.ts` (bug, D-16): `getVisitedProducts` must return only `ACTIVE` products. Add a `'visitedProduct.productStatus': ACTIVE` match after the `$unwind` (46) and before `$facet`.
- [ ] `api/libs/config.ts:141–148`: `lookupVisit` uses `visitedProperty.*` → `visitedProduct.*`.

### Comment
- [ ] `api/components/comment/comment.service.ts`:
  - `PropertyService` import and injection (10, 20)
  - `case CommentGroup.PROPERTY` → `propertyStatsEditor('propertyComments')` (36–42) becomes `PRODUCT` → `productStatsEditor('productComments')`
  - add `case CommentGroup.BRIEF` → `briefStatsEditor('briefComments')`
- [ ] `api/components/comment/comment.module.ts:10,24`: `PropertyModule` → `ProductModule`, and add `BriefModule`.
- [ ] `comment.service.ts:50–55` (bug): the `MEMBER` case increments the **author's** `memberComments` (`_id: memberId`), not the target member's (`commentRefId`).
- [ ] `comment.service.ts:24` (bug): `createComment` does not check that the target exists and is active. A comment on a missing or deleted product/brief still increments a counter. For `CommentGroup.PRODUCT`, the target must be `ACTIVE`, so comments on `PAUSED` products are rejected (D-16).
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
- [ ] `Notification.model.ts:29–31`: `notificationDesc` is optional, but the ER doc says **NN**. Align them, or record the reason.
- [ ] `NotificationGroup` is covered in Step 4.

### Board article, follow, notice
- [ ] `api/components/board-article/board-article.service.ts:119` (bug): `lookupAuthMemberLiked(memberId, '$followingId')` matches likes against a field that doesn't exist, so `meLiked` is always empty. It should use the default `'$_id'`. This is not Property-related, but it's the same lookup family.
- [ ] Board articles, follows and notices (`api/schemas/Notice.model.ts`) have no Property dependency and need no change. Some Uzbek comments in `follow.service.ts` (78, 86, 111) mention "agent" in the realtor sense. Leave them as they are (convention).

### Socket (D-08)
- [ ] `api/socket/socket.gateway.ts` and `api/socket/socket.module.ts` (registered in `api/app.module.ts:12,41`, with the WS adapter in `api/main.ts:7,20`) run a public in-memory chat. D-08 says there is no in-platform chat in the MVP. (decision) Remove it, or keep it and record why.

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
- [ ] `batchProperties` (38–53) → `batchProducts`. The rank is `productLikes*2 + productViews*1`. (decision) Should `productComments` count too?
  - keep ranking only `ACTIVE` products (41). Paused products get no rank (D-16).
- [ ] `batchAgents` (55–71) → `batchCreators`:
  - `memberType: AGENT` (58)
  - formula `memberProperties*5 + …` (65–66) → `memberProducts*5 + …`. `memberProducts` includes paused products; this is an accepted trade-off (D-16), so no extra filter is needed.
- [ ] `batch/batch.controller.ts`:
  - `BATCH_TOP_PROPERTIES` / `BATCH_TOP_AGENTS` (4, 35, 46)
  - `batchTopProperties` / `batchTopAgents` (36, 47)
  - logger contexts (38, 49)
  - the commented-out nightly job (62–73) calls `batchProperties` / `batchAgents`
- [ ] `batch/batch.controller.ts:8`: `new Logger('BatchController.name')` is a string literal, not `BatchController.name`. (cosmetic)
- [ ] `batch/libs/config.ts:6–7`: `BATCH_TOP_PROPERTIES` → `BATCH_TOP_PRODUCTS` and `BATCH_TOP_AGENTS` → `BATCH_TOP_CREATORS`.
- [ ] `batch/batch.service.ts:74`: hello string (see Step 3).
- [ ] `apps/nestar-batch/test/app.e2e-spec.ts:4,11` (bug): imports `NestarBatchModule`, which doesn't exist (the class is `BatchModule`). Under D-21 the class may become `AgentsHubBatchModule`; either way, the spec must import the class's actual name. It also expects `'Hello World!'` (19). The spec can't compile.
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
- [ ] Owner product management: pause/resume buttons (`ACTIVE ↔ PAUSED`), and a "paused" badge in the owner's own product list (D-16).
- [ ] Handle `NO_DATA_FOUND` from `getProduct` for paused products (e.g. old links and shared URLs). Hide like/comment controls on the owner's own paused product (D-16).

---

## Open decisions (recorded in `docs/decisions.md` as D-12 … D-19)

1. Rename the apps `nestar-api` / `nestar-batch` (Step 3). **Accepted as D-12:** `agentshub-api` / `agentshub-batch`.
2. Fresh DB vs. migrating Nestar members (Step 3). **Accepted as D-13:** new empty dev database `agentsHub` plus a seed script.
3. Restrict `memberType` at signup to `USER | CREATOR` (Step 5, D-02). **Accepted as D-14:** required `@IsIn([USER, CREATOR])` at signup, no `memberType` in any update input, first admin created only by the seed script.
4. Default `memberImage` path (Step 5). **Accepted as D-15:** default `''` means no image. The frontend shows a placeholder, and the DB never stores a placeholder path.
5. `PAUSED` semantics: counter effect, owner visibility, and re-activation (Step 6). **Accepted as D-16:** option B. Visible only to the owner and admins. No likes, views or comments. Owner toggles `ACTIVE ↔ PAUSED`. `memberProducts` changes only on create and delete. Favorites/visited show `ACTIVE` only.
6. Does `productComments` count in product ranking? (Step 10)
7. Like/View index field order vs. the ER doc; `notificationDesc` NN vs. optional (Step 8).
8. Keep or remove the WebSocket chat (Step 8, D-08).
