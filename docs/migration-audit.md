# AgentHub — Migration Audit (Step 2)

> Every place in the repo that depends on the Nestar Property domain, or on fields and enums that change according to `docs/agenthub-er.md`.
> Items are grouped by the migration step that should fix them. Paths are relative to the repo root; `api/` = `apps/nestar-api/src/`, `batch/` = `apps/nestar-batch/src/`.
> `(bug)` = an existing defect found during the audit. Fix it in the step where the file is touched anyway.
> `(decision)` = needs an owner decision; record it in `docs/decisions.md` as **Proposed** first.

Audit baseline: branch `modification`, commit `e994860`.

---

## Step 3 — Config (package names, DB name, env, app names)

### Package and scripts — `package.json`
- [ ] `"name": "nestar"` → `agenthub` (line 2). `package-lock.json` lines 2 and 8 regenerate with `npm install`.
- [ ] `start:prod` runs `dist/apps/nestar/main`, but the app is `nestar-api` (line 15). Fix the path, and rename it again if the app folder is renamed.
- [ ] `start:dev:batch` / `start:prod:batch` refer to `nestar-batch` (lines 13 and 16).
- [ ] `test:e2e` points to `./test/jest-e2e.json`, which does not exist (line 22). The configs are `apps/*/test/jest-e2e.json`.
- [ ] `format` / `lint` globs include `libs/**` and `test/**`, which don't exist at the root (lines 10 and 17). Harmless; clean up optionally.
- [ ] Empty `description` / `author` fields (lines 4–5).

### Monorepo app names — `nest-cli.json`
- [ ] (decision) Rename the apps `nestar-api` / `nestar-batch` (for example to `agenthub-api` / `agenthub-batch`)? This affects:
  - `nest-cli.json` (`sourceRoot`, `root`, `projects.*`, `tsConfigPath`; lines 4, 8, 11, 13–29)
  - `apps/nestar-api/tsconfig.app.json` line 5 and `apps/nestar-batch/tsconfig.app.json` line 5 (`outDir`)
  - every `../../nestar-api/src/...` import in the batch app (see Step 10)
  - the `package.json` scripts above
  - the folder names in `CLAUDE.md`
  - the existing `dist/apps/nestar-*` build output (delete and rebuild)

### Database and environment — `.env` (gitignored)
- [ ] `MONGODB_DEV` and `MONGODB_PROD` both point to the database **`Nestar`**. Point them to a new `AgentHub` database, so the original Nestar data stays untouched (D-01).
- [ ] (decision) Decide whether to start with an empty DB, or migrate members from Nestar. If you migrate:
  - `memberType: AGENT → CREATOR`
  - `$rename memberProperties → memberProducts`
  - `$unset memberAddress`
  - set `memberBriefs: 0`
  - drop `properties`, and drop `likes`/`views`/`comments`/`notifications` that have `*Group: PROPERTY`
- [ ] No `.env.example` exists. Add one listing `PORT_API`, `PORT_BATCH`, `MONGODB_DEV`, `MONGODB_PROD` and `SECRET_TOKEN`.
- [ ] Both `api/database/database.module.ts` and `batch/database/database.module.ts` (line 9) pick the URI by `NODE_ENV`. No change needed; keep them in sync.

### Branding strings
- [ ] `api/app.service.ts:6`: `'Hello to Nestar API server!'`
- [ ] `batch/batch.service.ts:74`: `'Hello to Nestar BATCH server!'`
- [ ] `README.md`: stock NestJS README. Replace it with an AgentHub README.
- [ ] `AGENTS.md` and `SKILLS.md` call the project **"Petoria"**. Correct them to AgentHub.
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
- [ ] `memberImage` default is `''` (line 48), but the ER doc says "NN, default image path". (decision) Choose a default image path.

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
- [ ] (decision) Does `PAUSED` decrement `memberProducts`? Can the owner see their own `PAUSED` product via `getProduct`? Right now the search only allows `ACTIVE` (55, 84). `updateProperty` also only matches `ACTIVE` (84), so a `PAUSED` product could never be re-activated.
- [ ] `getProperties` / `shapeMatchQuery` (103–164):
  - remove the location/rooms/beds/type/squares/options filters and the `$or` for options
  - add category/pricing/tag filters
  - text search on `productTitle` (and maybe `productTags`)
  - (bug) `text` goes into `new RegExp` unescaped (158). The same applies in `member.service.ts:129,173` and `board-article.service.ts:103`.
- [ ] `getFavorities` / `getVisited` (166–172) call `likeService.getFavoriteProperties` / `viewService.getVisitedProperties` (see Step 8). Keep the misspelled operation name `getFavorities` (convention).
- [ ] `getAgentProperties` (174–204) → `getCreatorProducts`.
- [ ] `likeTargetProperty` (206–222):
  - `LikeGroup.PROPERTY` (213) → `PRODUCT`
  - `'propertyLikes'` → `'productLikes'`
- [ ] `getAllPropertiesByAdmin` (224–251): `propertyLocationList` filter → category filter.
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
- [ ] `api/libs/config.ts:132–139`: `lookupFavorite` uses `favoriteProperty.memberId` / `favoriteProperty.memberData` → `favoriteProduct.*`.

### View
- [ ] `api/schemas/View.model.ts:26`: the index order is `{ memberId, viewRefId }`; the ER doc says `{ viewRefId: 1, memberId: 1 }`.
- [ ] `api/components/view/view.service.ts`:
  - `getVisitedProperties` (30–65) → `getVisitedProducts`
  - `ViewGroup.PROPERTY` (32)
  - `from: 'properties'` (40)
  - alias `visitedProperty` (43, 46, 53, 62) → `visitedProduct`
  - imports (6, 8)
- [ ] `api/libs/config.ts:141–148`: `lookupVisit` uses `visitedProperty.*` → `visitedProduct.*`.

### Comment
- [ ] `api/components/comment/comment.service.ts`:
  - `PropertyService` import and injection (10, 20)
  - `case CommentGroup.PROPERTY` → `propertyStatsEditor('propertyComments')` (36–42) becomes `PRODUCT` → `productStatsEditor('productComments')`
  - add `case CommentGroup.BRIEF` → `briefStatsEditor('briefComments')`
- [ ] `api/components/comment/comment.module.ts:10,24`: `PropertyModule` → `ProductModule`, and add `BriefModule`.
- [ ] `comment.service.ts:50–55` (bug): the `MEMBER` case increments the **author's** `memberComments` (`_id: memberId`), not the target member's (`commentRefId`).
- [ ] `comment.service.ts:24` (bug): `createComment` does not check that the target exists and is active. A comment on a missing or deleted product/brief still increments a counter.

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
  - `memberType: MemberType.AGENT` (29) → `CREATOR`
- [ ] `batchProperties` (38–53) → `batchProducts`. The rank is `productLikes*2 + productViews*1`. (decision) Should `productComments` count too?
- [ ] `batchAgents` (55–71) → `batchCreators`:
  - `memberType: AGENT` (58)
  - formula `memberProperties*5 + …` (65–66) → `memberProducts*5 + …`
- [ ] `batch/batch.controller.ts`:
  - `BATCH_TOP_PROPERTIES` / `BATCH_TOP_AGENTS` (4, 35, 46)
  - `batchTopProperties` / `batchTopAgents` (36, 47)
  - logger contexts (38, 49)
  - the commented-out nightly job (62–73) calls `batchProperties` / `batchAgents`
- [ ] `batch/batch.controller.ts:8`: `new Logger('BatchController.name')` is a string literal, not `BatchController.name`. (cosmetic)
- [ ] `batch/libs/config.ts:6–7`: `BATCH_TOP_PROPERTIES` → `BATCH_TOP_PRODUCTS` and `BATCH_TOP_AGENTS` → `BATCH_TOP_CREATORS`.
- [ ] `batch/batch.service.ts:74`: hello string (see Step 3).
- [ ] `apps/nestar-batch/test/app.e2e-spec.ts:4,11` (bug): imports `NestarBatchModule`, which doesn't exist (the class is `BatchModule`). It also expects `'Hello World!'` (19). The spec can't compile.
- [ ] Ranking rollback only resets members with `memberStatus: ACTIVE`. Blocked or deleted creators keep a stale `memberRank`. (minor)

---

## Step 12 — Frontend

- [ ] **There is no frontend code in this repo.** No `apps/*` web app, no `pages/`, and no Next/React files were found. The frontend lives in a separate repo, so audit it separately.
- [ ] Use this list of GraphQL contract changes from Steps 4–8 when converting the frontend:

  | Nestar | AgentHub |
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

- [ ] In the frontend repo, remove the real-estate pages and filters (location, beds, rooms, square, barter/rent, sold state) in the same step (D-10).
- [ ] Contact info must come from the API's null-for-guests behaviour, not only from hiding it in the UI (D-07).

---

## Open decisions to record in `docs/decisions.md` (as Proposed)

1. Rename the apps `nestar-api` / `nestar-batch` (Step 3).
2. Fresh DB vs. migrating Nestar members (Step 3).
3. Restrict `memberType` at signup to `USER | CREATOR` (Step 5, D-02).
4. Default `memberImage` path (Step 5).
5. `PAUSED` semantics: counter effect, owner visibility, and re-activation (Step 6).
6. Does `productComments` count in product ranking? (Step 10)
7. Like/View index field order vs. the ER doc; `notificationDesc` NN vs. optional (Step 8).
8. Keep or remove the WebSocket chat (Step 8, D-08).
