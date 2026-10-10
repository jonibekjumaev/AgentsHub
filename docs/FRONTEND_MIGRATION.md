# Frontend migration guide: Nestar → AgentsHub

This guide is for the developer converting the Nestar web app to AgentsHub. It lists every API change the frontend has to follow, page by page, so you don't need to read the backend code.

References like **D-16**, **B17** or **S9** point to `docs/decisions.md` (decisions) and `docs/migration-audit.md` (bugs and security items) if you want the reasoning. You don't need them to do the work.

## 0. What changed, in one paragraph

Nestar was a real estate marketplace: agents listed properties. AgentsHub is a marketplace for AI agents (D-01):

- **CREATOR** members publish **Products** (listings for AI agents they built). Products replace properties.
- **USER** members publish **Briefs** (a business need for a custom agent). Briefs are new.
- There is no in-platform deal flow. Members contact each other off-platform through the email / WhatsApp shown on profiles, visible to logged-in members only (D-07, D-08).
- **Naming trap:** in Nestar, "agent" meant the real-estate agent (a member role). In AgentsHub, "agent" means the AI agent (the product). Every old "agent" identifier for the role is now **creator**.

### How each page section is laid out

1. **Operations:** old → new GraphQL operation, and who may call it.
2. **Fields:** what changed in the data the page reads and sends.
3. **Errors:** the error codes and messages the page must handle.
4. **UI hints:** what to show, hide or ask.

### Getting the live schema

The API is code-first; there is no schema file in the repo. Run the API (`npm run start:dev`) and introspect `http://localhost:<PORT_API>/graphql`, e.g. for codegen:

```bash
npx graphql-codegen   # with schema: http://localhost:3000/graphql in codegen.yml
# or just the SDL:
npx get-graphql-schema http://localhost:3000/graphql > schema.graphql
```

Regenerate your client types after every backend update. Section 2 of this guide lists all renames so you can update queries by hand.

---

## 1. Global changes

These apply to every page. Build them once (API client, error handler, auth store) before converting pages.

### 1.1 Auth flow

- **Token:** send `Authorization: Bearer <accessToken>` on every request when logged in. `signup` and `login` return the token in `Member.accessToken`. It expires after 30 days.
- **The token only holds `_id`, `memberType` and `memberNick` (S9).** Don't decode it to fill the profile. Keep the `Member` returned by `login` / `signup` in your store, and after a page reload load it with `getMember(memberId)` using the token's `_id`.
- **Signup** (`signup(input: MemberInput!)`):
  - `memberType` is **required** and must be `USER` or `CREATOR` (D-14). `ADMIN` is rejected. The type can never change later, so a person who wants to both sell and post briefs needs two accounts (D-02). Make the choice explicit in the signup form ("I build AI agents" / "I need an AI agent").
  - `memberNick` 3–12 characters, `memberPhone` E.164 (see 3.1), `memberPassword` at least 8 characters (see 3.1).
  - Signup can't set email / WhatsApp; the member adds them later in the profile.
- **Login** (`login(input: LoginInput!)`): one error for every failed login (D-27):
  - unknown nick, deleted member or wrong password → `UNAUTHENTICATED`, message `"Wrong member nick or password!"`. There is **no** "unknown nick" state any more (`NO_MEMBER_NICK` is gone). Show one generic message.
  - a blocked member with the **correct** password → `FORBIDDEN`, `"You have been blocked!"`.
- **Every logged-in operation checks the member in the database (B17):**
  - blocked member → `FORBIDDEN` with message `"You have been blocked!"` (`BLOCKED_USER`)
  - deleted or missing member, expired / invalid / malformed token → `UNAUTHENTICATED` (`"You are not authenticated, please login first!"`)
  - no token at all → `UNAUTHENTICATED` (`"Bearer Token is not provided!"`)
  - **Rule for the client:** on `UNAUTHENTICATED`, or on `FORBIDDEN` whose message is `"You have been blocked!"`, **clear the token and redirect to login**. Other `FORBIDDEN` errors (wrong role, see below) must **not** log the member out.
- **Wrong role** → `FORBIDDEN`, `"Allowed only for members with specific roles!"`. Hide the controls instead of relying on this error (e.g. no "Post a brief" button for creators).
- **Public operations with a bad token** (`getMember`, `getProduct`, `getProducts`, `getBrief`, `getComments`, …) don't fail: the caller is treated as a **guest**. So an expired token shows up as missing `meLiked`, `null` contact fields, and no access to one's own paused product, not as an error. If you see that while you think you are logged in, re-check the session (e.g. call `getMember` for yourself on a guarded path or log out).
- **Password change doesn't log out other sessions:** existing tokens stay valid until they expire (D-24).
- **No password recovery** in the MVP (D-24). Don't show a "Forgot password?" link, or link it to a support contact.

### 1.2 Error shape

Every GraphQL error has this shape (B14, B15):

```json
{
  "errors": [
    {
      "message": "Password must be at least 8 characters!; Phone number must be in international format, e.g. +998901234567 (8 to 15 digits)!",
      "extensions": {
        "code": "BAD_REQUEST",
        "validationErrors": [
          "Password must be at least 8 characters!",
          "Phone number must be in international format, e.g. +998901234567 (8 to 15 digits)!"
        ]
      }
    }
  ],
  "data": null
}
```

- `message` is **always a string**. In Nestar, validation failures only said `"Bad Request Exception"`.
- `extensions.code` is one of:

  | Code | Meaning | Default UI reaction |
  |---|---|---|
  | `BAD_REQUEST` | Input failed a rule (validation or business rule) | Show the message; for validation, show `validationErrors` next to the fields |
  | `GRAPHQL_VALIDATION_FAILED` | The query doesn't match the schema (unknown field or enum value, missing required argument) | A bug in the client: log it, show a generic error. Usually means a query still uses an old Nestar name |
  | `NOT_FOUND` | Missing, hidden, deleted, or not yours (see each page) | "Not found" page, or reload the list |
  | `CONFLICT` | Duplicate value (nick, phone, product title) | Show the message next to the field |
  | `UNAUTHENTICATED` | No / bad token, deleted member, failed login | Clear token, go to login (except on the login form itself) |
  | `FORBIDDEN` | Blocked member, or wrong role | Blocked: clear token, go to login. Role: show the message |
  | `INTERNAL_SERVER_ERROR` | Real server fault | Generic "something went wrong" |

- `extensions.validationErrors` is present **only** for validation failures. It holds one message per failed rule:
  - Built-in rules start with the field name, e.g. `"memberNick must be longer than or equal to 3 characters"`, `"productId must be a mongodb id"`. Map them to fields by that first word.
  - Custom rules have their own text and don't start with the field name: password, phone, WhatsApp and email messages (see 3.1). Map them by the exact message.
- Business errors (not validation) have **no** `validationErrors`, only `code` and `message`. The message is the important part: many errors share a code (e.g. `BAD_REQUEST`), so the UI tells them apart by message. Keep the messages from the appendix as constants in one place.
- Sensitive values (passwords, tokens) are replaced with `***` in error messages (S15).

A minimal handler:

```ts
const BLOCKED = 'You have been blocked!';

function handleGqlError(err: { message: string; extensions?: { code?: string; validationErrors?: string[] } }) {
	const code = err.extensions?.code;
	if (code === 'UNAUTHENTICATED' || (code === 'FORBIDDEN' && err.message === BLOCKED)) {
		auth.clear();
		router.push('/login');
		return;
	}
	if (err.extensions?.validationErrors) return showFieldErrors(err.extensions.validationErrors);
	showToast(err.message);
}
```

(Skip the redirect on the login form, where `UNAUTHENTICATED` just means wrong credentials.)

### 1.3 IDs

- Every id is a 24-character hex MongoDB ObjectId string (`_id`, `memberId`, `productId`, `briefId`, …).
- A malformed or empty id argument now returns `BAD_REQUEST` with `"<arg> must be a mongodb id"` (in `validationErrors` too), instead of `INTERNAL_SERVER_ERROR` (B18). E.g. `getProduct(productId: "abc")` → `"productId must be a mongodb id"`; `updateProduct` with a bad `_id` → `"_id must be a mongodb id"`.
- Auth and role errors come first: a guest calling a guarded operation with a bad id gets `UNAUTHENTICATED`, not `BAD_REQUEST`.
- **UI hint:** on detail pages that read the id from the URL (`/products/:id`), treat this `BAD_REQUEST` like `NOT_FOUND` and show the "not found" page.

### 1.4 Update semantics: leave out vs `null`

All `update*` mutations follow one rule (B11):

- **Leave a field out to keep it unchanged.** Don't send the whole object back with unchanged values set to `null`.
- **`null` clears an optional field.** Allowed for: `memberFullName`, `memberDesc`, `memberEmail`, `memberWhatsapp`, `articleImage`, `productDemoUrl`, `productPrice` (see 3.5), `briefBudget`, `briefDeadline`.
- **`null` on a required field is rejected** (`BAD_REQUEST`): `memberNick`, `memberPhone`, `memberImage`, `memberStatus`, `articleTitle`, `articleContent`, `articleStatus`, `commentContent`, `commentStatus`, `productStatus`, `productCategory`, `productPricing`, `productTitle`, `productTags`, `productImages`, `productDesc`, `briefCategory`, `briefStatus`, `briefTitle`, `briefContent`.
- `memberImage`: send `''` to remove the image (D-15), not `null`.

**UI hint:** build update inputs from the fields the user actually changed (a "dirty fields" diff), and map "cleared optional input" to `null`.

### 1.5 List queries

All list queries take `{ page, limit, sort?, direction?, search }`:

- `page` and `limit` must be ≥ 1 → else `BAD_REQUEST`.
- `sort` must be one of the allowed values for that list (listed per page). An unknown or old Nestar sort (e.g. `propertyPrice`) → `BAD_REQUEST`.
- `direction`: `ASC` or `DESC`.
- `search` is required (send `{}` when there's no filter). `search.text` is at most 100 characters → else `BAD_REQUEST` (B16). Enum values inside `search` are checked too.
- The response is `{ list: [...], metaCounter: [{ total }] }`. `metaCounter` is an empty array when there are no results, so read the total as `metaCounter?.[0]?.total ?? 0`.

### 1.6 Money, images, dates

- **Money:** all prices and budgets are **USD**, with no currency field (D-06). `SUBSCRIPTION` product prices are **per month**. Show `$49 / month` for subscriptions, `$49` for one-time.
- **Images:**
  - Upload with `imageUploader(file, target)` / `imagesUploader(files, target)` (logged-in only). `target` is `"member"`, `"product"` or `"article"`; the old `"property"` → `BAD_REQUEST`.
  - Only `jpg`, `jpeg`, `png` (`"Please provide jpg, jpeg or png images!"`). Max 15 MB, max 10 files per request.
  - The result is a path like `uploads/product/<uuid>.png`; prefix it with the API origin to show it.
  - `memberImage` is `''` when the member has no picture: **show a placeholder** (D-15).
- **Dates** are ISO strings in UTC (`DateTime`). Show them in the viewer's time zone.

---

## 2. Rename and removal reference

Use this as a find-and-replace list for queries, fragments, types and route names.

### 2.1 Types and input types

| Nestar | AgentsHub |
|---|---|
| `Property`, `Properties` | `Product`, `Products` |
| `PropertyInput`, `PropertyUpdate` | `ProductInput`, `ProductUpdate` |
| `PropertiesInquiry` (search `PIsearch`) | `ProductsInquiry` (search `PIsearch`, same name) |
| `AgentPropertiesInquiry` (search `APISearch`) | `CreatorProductsInquiry` (search `CPISearch`) |
| `AllPropertiesInquiry` (search `ALPISearch`) | `AllProductsInquiry` (search `ALPISearch`, same name) |
| `AgentsInquiry` (search `AISearch`) | `CreatorsInquiry` (search `CRISearch`, only `text`) |
| `PropertyStatus` | `ProductStatus` |
| — | new: `Brief`, `Briefs`, `BriefInput`, `BriefUpdate`, `BriefsInquiry` (`BISearch`), `MyBriefsInquiry` (`MBISearch`), `AllBriefsInquiry` (`ALBISearch`), `BriefStatus` |
| — | new: `AgentCategory`, `ProductPricing`, `ChangePasswordInput` |

### 2.2 Fields

| Nestar | AgentsHub |
|---|---|
| `propertyStatus`, `propertyTitle`, `propertyPrice`, `propertyViews`, `propertyLikes`, `propertyComments`, `propertyRank`, `propertyImages`, `propertyDesc` | `productStatus`, `productTitle`, `productPrice` (now **nullable**, see 3.4), `productViews`, `productLikes`, `productComments`, `productRank`, `productImages`, `productDesc` |
| `propertyType`, `propertyLocation`, `propertyAddress`, `propertySquare`, `propertyBeds`, `propertyRooms`, `propertyBarter`, `propertyRent`, `soldAt`, `constructedAt` | **removed** (D-10) |
| — | new on `Product`: `productCategory: AgentCategory!`, `productPricing: ProductPricing!`, `productDemoUrl: String`, `productTags: [String!]` |
| `Member.memberProperties` | `memberProducts` |
| `Member.memberAddress` | **removed** |
| — | new on `Member`: `memberBriefs: Int!`, `memberEmail: String`, `memberWhatsapp: String` (contacts are `null` for guests, see 3.1) |
| `MemberUpdate.memberPassword`, `MemberUpdateByAdmin.memberPassword` | **removed**; use `changePassword` (D-24) |
| `MemberUpdateByAdmin.memberType` | **removed**; the type never changes (D-14) |
| search inputs: `locationList`, `typeList`, `roomsList`, `bedsList`, `options`, `squaresRange` | **removed**; new `categoryList`, `pricingList`, `tagList` (see 3.3) |
| search `pricesRange: { start: Int, end: Int }` | `pricesRange: { start: Float!, end: Float! }` |
| `search.propertyStatus` | `search.productStatus` |
| `AISearch.memberStatus`, `AISearch.memberType` | **removed** from `CRISearch` (B16) |
| `CommentsInquiry.search: { commentRefId }` | `search: { commentRefId, commentGroup }`; `commentGroup` is required |

### 2.3 Enums

| Enum | Nestar | AgentsHub |
|---|---|---|
| `MemberType` | `USER`, `AGENT`, `ADMIN` | `USER`, `CREATOR`, `ADMIN` |
| `ProductStatus` (was `PropertyStatus`) | `ACTIVE`, `SOLD`, `DELETE` | `ACTIVE`, `PAUSED`, `DELETE` |
| `CommentGroup` | `MEMBER`, `ARTICLE`, `PROPERTY` | `MEMBER`, `ARTICLE`, `PRODUCT`, `BRIEF` |
| `PropertyType`, `PropertyLocation` | real-estate values | **removed** |
| `AgentCategory` (new, products and briefs, D-09) | — | `CUSTOMER_SUPPORT`, `SALES`, `MARKETING`, `CONTENT`, `DATA_ANALYSIS`, `AUTOMATION`, `EDUCATION`, `OTHER` |
| `ProductPricing` (new, D-03) | — | `FREE`, `ONE_TIME`, `SUBSCRIPTION`, `CUSTOM` |
| `BriefStatus` (new) | — | `OPEN`, `CLOSED`, `DELETE` |

Unchanged: `MemberStatus` (`ACTIVE`, `BLOCK`, `DELETE`), `MemberAuthType`, `CommentStatus`, `BoardArticleCategory`, `BoardArticleStatus`, `Direction`. The like / view groups are not in the GraphQL schema; nothing to change in the client.

Suggested labels: `CUSTOMER_SUPPORT` "Customer support", `DATA_ANALYSIS` "Data analysis", `ONE_TIME` "One-time", `CUSTOM` "Custom quote", and so on.

### 2.4 Operations

| Nestar | AgentsHub | Who |
|---|---|---|
| `createProperty` | `createProduct` | CREATOR |
| `getProperty(propertyId)` | `getProduct(productId)` | everyone |
| `updateProperty` | `updateProduct` | CREATOR, owner |
| `getProperties` | `getProducts` | everyone |
| `getAgentProperties` | `getCreatorProducts` | CREATOR (own products) |
| `likeTargetProperty(propertyId)` | `likeTargetProduct(productId)` | logged in |
| `getAllPropertiesByAdmin` | `getAllProductsByAdmin` | ADMIN |
| `updatePropertyByAdmin` | `updateProductByAdmin` | ADMIN |
| `removePropertyByAdmin(propertyId)` | `removeProductByAdmin(productId)` | ADMIN |
| `getAgents(input: AgentsInquiry)` | `getCreators(input: CreatorsInquiry)` | everyone |
| `getFavorities`, `getVisited` | same names, now return `Products` | logged in |
| — | `changePassword(input: ChangePasswordInput!): Boolean!` | logged in |
| — | `createBrief`, `updateBrief`, `getMyBriefs` | USER |
| — | `getBrief(briefId)`, `getBriefs` | everyone |
| — | `getAllBriefsByAdmin`, `updateBriefByAdmin`, `removeBriefByAdmin(briefId)` | ADMIN |

Everything else keeps its name: `signup`, `login`, `getMember`, `updateMember`, `likeTargetMember`, `getAllMembersByAdmin`, `updateMemberByAdmin`, `imageUploader`, `imagesUploader`, board article, comment and follow operations. Their rules changed in places; see the pages.

`sayHello`, `checkAuth` and `checkAuthRoles` are server test queries; don't use them in the app.

### 2.5 Sort values

| List | Allowed `sort` values (default `createdAt`) |
|---|---|
| Products (`getProducts`, `getCreatorProducts`, `getAllProductsByAdmin`) | `createdAt`, `updatedAt`, `productLikes`, `productViews`, `productRank`, `productPrice` |
| Creators (`getCreators`) | `createdAt`, `updatedAt`, `memberLikes`, `memberViews`, `memberRank`, `memberProducts` |
| Members (`getAllMembersByAdmin`) | `createdAt`, `updatedAt`, `memberLikes`, `memberViews` |
| Briefs (`getBriefs`, `getMyBriefs`, `getAllBriefsByAdmin`) | `createdAt`, `updatedAt`, `briefViews`, `briefBudget`, `briefDeadline` |
| Board articles | `createdAt`, `updatedAt`, `articleLikes`, `articleViews` |
| Comments | `createdAt`, `updatedAt` |

Old values (`propertyLikes`, `propertyViews`, `propertyRank`, `propertyPrice`, `memberProperties`) → `BAD_REQUEST`.

---

## 3. Pages

### 3.1 Signup, login and member profile

**Operations**

| Old | New | Notes |
|---|---|---|
| `signup` | `signup` | `memberType` required, `USER` or `CREATOR` only (D-14) |
| `login` | `login` | one error message (D-27), see 1.1 |
| `getMember(memberId)` | same | public; contact fields only for logged-in members |
| `updateMember(input)` with `memberPassword` | `updateMember(input)` without it | sending `memberPassword` → `GRAPHQL_VALIDATION_FAILED` |
| — | `changePassword(input: { currentPassword, newPassword })` | logged in (D-24) |
| `likeTargetMember(memberId)` | same | logged in |

**Fields**

- `memberProperties` → `memberProducts`. New `memberBriefs`. `memberAddress` removed.
  - `memberProducts` counts the creator's `ACTIVE` **and** `PAUSED` products (D-16), so it can be higher than the number of products a visitor sees on the profile. Label it "Products", not "Live products".
  - `memberBriefs` counts `OPEN` + `CLOSED` briefs (D-30).
- **Contacts: `memberEmail`, `memberWhatsapp` (D-07, D-23).**
  - They are `null` for guests. They are also `null` for a token whose member is blocked or deleted.
  - They are `null` in the `signup` and `login` responses, because those requests have no token yet. After login, load your own profile with `getMember` (with the new token) to get them.
  - `updateMember` returns them (the request has a token).
  - The API enforces this; don't rely on hiding them in the UI only.
  - **UI:** on a profile, product or brief page, if the viewer is a guest show "Log in to see contact details" instead of the contacts. For a logged-in viewer, `null` means the member hasn't added that contact. Show email as a `mailto:` link and WhatsApp as a `https://wa.me/<digits>` link (number without the `+`).
- **Phone and WhatsApp format (D-25):** E.164 only: `+`, country code (no leading 0), digits only, 8–15 digits in total, e.g. `+998901234567`.
  - Applies to `memberPhone` (signup, `updateMember`, `updateMemberByAdmin`) and `memberWhatsapp`.
  - The API doesn't reformat: no spaces, dashes or brackets. Normalize in the form before sending (strip spaces and dashes), or use a phone input that outputs E.164.
  - Members from the Nestar dev data may still have stored local numbers (`010…`). They can log in, but must enter an E.164 number the next time they update their phone. Don't pre-validate the stored value on load.
- **Email:** valid email, at most 254 characters.
- **Passwords (D-26):**
  - New passwords (`signup.memberPassword`, `changePassword.newPassword`): at least **8 characters**, at most **72 bytes** in UTF-8, no composition rules (no "must contain a digit"). 72 bytes is fewer characters for non-Latin text (e.g. 36 Cyrillic letters, 18 emoji).
  - `login.memberPassword` and `changePassword.currentPassword`: only non-empty, so old 5–7 character passwords still log in. **Don't** apply the 8-character rule on the login form.
  - Client-side check: `password.length >= 8 && new TextEncoder().encode(password).length <= 72`.
- Other limits: `memberNick` 3–12, `memberFullName` 3–100.

**Errors**

| Operation | Code | Message | UI |
|---|---|---|---|
| `signup`, `updateMember` | `CONFLICT` | `Already used member nick or phone` | show under nick / phone |
| `signup`, `changePassword` | `BAD_REQUEST` | `Password must be at least 8 characters!` / `Password must be at most 72 bytes (…)!` | under the password field |
| `signup`, `updateMember` | `BAD_REQUEST` | `Phone number must be in international format, …` | under phone |
| `updateMember` | `BAD_REQUEST` | `WhatsApp number must be in international format, …` / `Please provide a valid email of at most 254 characters!` | under the field |
| `login` | `UNAUTHENTICATED` | `Wrong member nick or password!` | one generic message |
| `login` | `FORBIDDEN` | `You have been blocked!` | "Your account is blocked" screen |
| `changePassword` | `BAD_REQUEST` | `Wrong password, try again!` | under "current password" |
| `changePassword` | `BAD_REQUEST` | `New password must be different from the current password!` | under "new password" |
| `updateMember`, `changePassword` | `UNAUTHENTICATED` | `You are not authenticated, please login first!` | blocked or deleted meanwhile: log out |
| `getMember`, `likeTargetMember` | `NOT_FOUND` | `No data found!` | missing or deleted member |

**UI hints**

- Change password is a separate form (current + new + confirm), not a field in "edit profile". `changePassword` returns `true`; it doesn't return a new token.
- A blocked member's profile is still readable (`getMember` returns `ACTIVE` and `BLOCK` members). Only deleted members are `NOT_FOUND`.
- Show a "Creator" or "User" badge from `memberType`.

### 3.2 Creators list

**Operations:** `getAgents(input: AgentsInquiry)` → `getCreators(input: CreatorsInquiry)`. Public.

**Fields**

- `search` (`CRISearch`) has only `text` (nick, max 100). `memberStatus` / `memberType` were removed → `GRAPHQL_VALIDATION_FAILED` if sent (B16). It always returns only active creators.
- New sort `memberProducts` ("most products"). `memberRank` is the creator ranking computed nightly from likes and views, not from the product count (D-22).

**UI hints:** rename "Agents" to "Creators" in navigation, routes and copy. Creator cards show `memberProducts`, not `memberProperties`.

### 3.3 Product list (marketplace)

**Operations:** `getProperties` → `getProducts(input: ProductsInquiry!)`. Public. Returns only `ACTIVE` products (never paused or deleted).

**Filters** (`search: PIsearch`):

| Field | Type | Meaning |
|---|---|---|
| `categoryList` | `[AgentCategory!]` | any of these categories |
| `pricingList` | `[ProductPricing!]` | any of these pricing models |
| `pricesRange` | `{ start: Float!, end: Float! }`, both ≥ 0 | price between start and end. **Only matches `ONE_TIME` and `SUBSCRIPTION` products**, because free and custom products have no price (D-03). With `pricingList`, only the overlap is matched (e.g. `pricingList: [FREE]` + a range → no results) |
| `tagList` | `[String!]`, max 10 | products that have **all** these tags. Tags are compared trimmed and lowercased |
| `text` | `String`, max 100 | title search |
| `memberId` | id | one creator's products (used on the creator's profile) |
| `periodsRange` | `{ start: DateTime!, end: DateTime! }` | created between |

Removed (D-10): `locationList`, `typeList`, `roomsList`, `bedsList`, `options`, `squaresRange`.

**Sorts:** see 2.5. `sort: productPrice` puts products **without a price last** in both directions. Ties are broken by newest first.

**Errors**

- `BAD_REQUEST` `"Price range start must not be greater than its end!"` (`start > end`). Validate in the form too.
- `BAD_REQUEST` for unknown enum values, a malformed `memberId`, `text` over 100 characters, more than 10 tags, negative prices.

**UI hints**

- Replace the real-estate filter panel with: category checkboxes, pricing checkboxes, a price slider (disable or explain it when only `FREE` / `CUSTOM` is selected), a tag input, and a search box.
- Product cards: title, first image, category, pricing badge, price (see 3.4 for `null`), likes / views.
- Remove "sold" badges, map views, beds/rooms icons and the barter/rent toggles.

### 3.4 Product detail

**Operations:** `getProperty(propertyId)` → `getProduct(productId)`. Public. `likeTargetProduct(productId)` (logged in).

**Fields**

- `productPrice` is now **nullable** (`Float`, was `Float!`). It is `null` for `FREE` and `CUSTOM` products (D-03). Typed clients must handle `null`.

  | `productPricing` | `productPrice` | Show |
  |---|---|---|
  | `FREE` | `null` | "Free" |
  | `CUSTOM` | `null` | "Custom quote" / "Contact for price" |
  | `ONE_TIME` | > 0 | `$49` |
  | `SUBSCRIPTION` | > 0 | `$49 / month` |

- `productDemoUrl` (optional): a "Try the demo" link. It's an external URL: open it in a new tab with `rel="noopener noreferrer"`.
- `productTags`: show as chips; clicking a tag can open the list filtered by `tagList: [tag]`.
- `productCategory`: show the label; link to the list filtered by category.
- `memberData`: the creator. Its contacts are `null` for guests (see 3.1). This is the "contact the creator" box: there is no in-app offer or message (D-08).
- `meLiked`: present for logged-in viewers.

**Visibility (D-16)**

- Everyone sees `ACTIVE` products.
- A `PAUSED` product is returned **only to its owner and to admins**. Everyone else gets `NOT_FOUND` `"No data found!"`, the same as for deleted or missing products. Deleted products are hidden from admins here too (they use the admin list).
- Views are counted only for logged-in viewers who are not the owner, once per member, and never on a paused product.

**Errors**

- `getProduct`: `NOT_FOUND` `"No data found!"` → "This product is no longer available" page. This happens for old links and shared URLs of paused products. A malformed id → `BAD_REQUEST` (treat as not found, 1.3).
- `likeTargetProduct`: `NOT_FOUND` when the product is missing or not `ACTIVE`.

**UI hints**

- When the owner views their own paused product: show a "Paused, not visible to others" banner, and **hide like and comment controls** (likes and comments are rejected on paused products).
- Because likes are rejected while paused, a member can't unlike a paused product. It also disappears from their favorites until it's resumed.

### 3.5 Creator dashboard (my products, create / edit)

**Operations**

| Old | New | Who |
|---|---|---|
| `getAgentProperties(input: AgentPropertiesInquiry)` | `getCreatorProducts(input: CreatorProductsInquiry!)` | CREATOR; always the caller's own products |
| `createProperty` | `createProduct(input: ProductInput!)` | CREATOR |
| `updateProperty` | `updateProduct(input: ProductUpdate!)` | CREATOR, owner |
| `imagesUploader(target: "property")` | `imagesUploader(target: "product")` | logged in |

**My products list** (`getCreatorProducts`)

- Returns the caller's `ACTIVE` and `PAUSED` products. `search` (`CPISearch`) has the same filters as 3.3 except `memberId`, plus `productStatus` (`ACTIVE` or `PAUSED`; `DELETE` → `BAD_REQUEST`).
- **UI:** a "Paused" badge on paused products, and status tabs (All / Active / Paused).

**Create / edit form**

| Field | Create | Rule |
|---|---|---|
| `productTitle` | required | 3–100 characters; unique per creator |
| `productCategory` | required | `AgentCategory` |
| `productPricing` | required | `ProductPricing` |
| `productPrice` | depends on pricing | see the D-03 table below |
| `productDesc` | required | 20–3000 characters |
| `productImages` | required | at least 1 uploaded image path |
| `productDemoUrl` | optional | `http://` or `https://` URL, max 500 |
| `productTags` | optional | max 10 tags, each 1–30 characters with at least one non-space character. The API trims, lowercases and de-duplicates them; show the returned tags |

**Price rule (D-03).** The server checks the **final** pricing/price pair (stored values merged with your input):

| Pricing | Price | Result |
|---|---|---|
| `FREE`, `CUSTOM` | not sent / `null` | OK; price stored as `null` |
| `FREE`, `CUSTOM` | any number | `BAD_REQUEST` `"Price is not allowed for FREE and CUSTOM pricing!"` |
| `ONE_TIME`, `SUBSCRIPTION` | > 0 | OK |
| `ONE_TIME`, `SUBSCRIPTION` | missing, `null` or ≤ 0 | `BAD_REQUEST` `"Price greater than 0 is required for ONE_TIME and SUBSCRIPTION pricing!"` |

On update:

- Leave `productPrice` out to keep the stored price; send `null` to clear it.
- Switching to `FREE` / `CUSTOM` **without** sending a price clears the stored price automatically. Sending a price with them is an error.
- Switching to `ONE_TIME` / `SUBSCRIPTION` needs a price, unless one is already stored.

**Form logic:** show the price input only when pricing is `ONE_TIME` or `SUBSCRIPTION` (label "Price per month (USD)" for subscriptions). When the user switches to `FREE` / `CUSTOM`, don't send `productPrice` at all.

**Status: pause, resume, delete (D-16, D-29)**

Send `updateProduct({ _id, productStatus })`:

| From | To | Allowed |
|---|---|---|
| `ACTIVE` | `PAUSED` | yes (pause) |
| `PAUSED` | `ACTIVE` | yes (resume) |
| `ACTIVE` / `PAUSED` | `DELETE` | yes (final, can't be undone) |
| same as current | same | yes, no change |
| anything else | — | `BAD_REQUEST` `"Product status can only change between ACTIVE and PAUSED, or to DELETE!"` |

- A paused product's other fields can be edited.
- Pausing hides the product from the marketplace, profiles, rankings and other members' favorites / visited lists; likes, views and comments stop. Resuming brings it back. Show this in a confirm dialog.
- `memberProducts` changes only on create and delete, never on pause / resume.
- An admin can also pause, resume or delete your product (D-29). An owner can resume a product an admin paused.

**Errors**

| Code | Message | When / UI |
|---|---|---|
| `CONFLICT` | `A product with this title already exists for this creator!` | duplicate title; show under the title |
| `BAD_REQUEST` | price messages above | show under the price field |
| `BAD_REQUEST` | status change message above | shouldn't happen if buttons follow the table |
| `NOT_FOUND` | `Update failed!` | product deleted, not yours, missing, or changed meanwhile (e.g. deleted in another tab). Reload the list |
| `FORBIDDEN` | `Allowed only for members with specific roles!` | a USER opened the dashboard; hide it for non-creators |
| `BAD_REQUEST` | `Please provide jpg, jpeg or png images!` | image upload |

### 3.6 Brief list and brief detail

Briefs are new: a USER describes an AI agent they need, and creators contact them off-platform.

**Operations**

- `getBriefs(input: BriefsInquiry!)`: public, guests included.
- `getBrief(briefId)`: public, guests included.

**List** (`getBriefs`)

- Returns only `OPEN` briefs by default. `search.briefStatus: CLOSED` lists closed ones instead; `DELETE` → `BAD_REQUEST` `"No data found!"`.
- Filters (`BISearch`): `categoryList`, `text` (title, max 100), `memberId` (one user's briefs, for their profile), `briefStatus`.
- Sorts: `createdAt` (default), `updatedAt`, `briefViews`, `briefBudget`, `briefDeadline`. Briefs **without** a budget / deadline are always listed last, in both directions.

**Fields** (`Brief`)

| Field | Notes |
|---|---|
| `briefTitle` | 3–100 characters |
| `briefContent` | 20–3000 characters; plain text |
| `briefCategory` | `AgentCategory` (same as products) |
| `briefStatus` | `OPEN`, `CLOSED`, `DELETE` |
| `briefBudget` | nullable `Float`, USD. `null` → show "Open to offers" (D-04) |
| `briefDeadline` | nullable `DateTime`. `null` → "No deadline". A deadline can be in the past on an `OPEN` brief: briefs are **not** closed automatically (D-05). Show "Deadline passed" |
| `briefViews`, `briefComments` | counters |
| `closedAt`, `deletedAt` | nullable dates |
| `memberData` | the user who posted it; contacts `null` for guests |

Briefs have no likes (`meLiked` doesn't exist on `Brief`).

**Visibility (D-30)**

- `OPEN` and `CLOSED` briefs are readable by everyone through `getBrief`, so links keep working after a brief is closed.
- `DELETE` briefs are hidden from everyone, owner included → `NOT_FOUND` `"No data found!"`.
- A view is counted only on an `OPEN` brief, for a logged-in viewer who isn't the owner, once per member.

**UI hints**

- A **"Closed" badge** on closed briefs (list and detail), with `closedAt` as "Closed on …".
- On a closed brief: show its comments, but **no comment box** (see 3.8).
- "Contact" box from `memberData` (logged-in only, 3.1). For a creator, this is how they respond to a brief.
- A "Post a brief" button only for logged-in `USER` members.

### 3.7 My briefs (USER only)

**Operations** (all USER only; CREATOR and ADMIN get `FORBIDDEN` `"Allowed only for members with specific roles!"`)

- `getMyBriefs(input: MyBriefsInquiry!)`: the caller's `OPEN` and `CLOSED` briefs. `search` (`MBISearch`): `categoryList`, `text`, `briefStatus` (`OPEN` or `CLOSED`; `DELETE` → `BAD_REQUEST`). Same sorts as 3.6.
- `createBrief(input: BriefInput!)`
- `updateBrief(input: BriefUpdate!)`: owner only.

**Create / edit form**

| Field | Create | Rule |
|---|---|---|
| `briefTitle` | required | 3–100 characters |
| `briefContent` | required | 20–3000 characters |
| `briefCategory` | required | `AgentCategory` |
| `briefBudget` | optional | if sent, > 0 (D-04) → else `BAD_REQUEST` `"Budget must be greater than 0!"`. Leave empty for "open to offers" |
| `briefDeadline` | optional | if sent, in the future (D-05) → else `BAD_REQUEST` `"Deadline must be in the future!"` |

On update: leave a field out to keep it; `null` clears `briefBudget` / `briefDeadline`; `null` on category, status, title or content → `BAD_REQUEST`. A **closed** brief's fields can be edited.

**Status: close, reopen, delete (D-30)**

| From | To | Allowed |
|---|---|---|
| `OPEN` | `CLOSED` | yes (close); sets `closedAt` |
| `CLOSED` | `OPEN` | yes (reopen); clears `closedAt`; deadline rule below |
| `OPEN` / `CLOSED` | `DELETE` | yes (final) |
| same as current | same | yes, no change |
| anything else | — | `BAD_REQUEST` `"Brief status can only change between OPEN and CLOSED, or to DELETE!"` |

**Deadline rule on update (D-31)**

- A `briefDeadline` you **send** must be in the future (server time, no grace period).
- An ordinary edit, close or delete **doesn't** check the stored deadline. A brief whose deadline has passed can still be edited, closed and deleted.
- **Reopening** (`CLOSED → OPEN`) needs the final deadline empty or in the future. If the stored deadline has passed, send a new deadline **or `null` in the same call** as the status change:

  ```graphql
  mutation {
    updateBrief(input: { _id: "…", briefStatus: OPEN, briefDeadline: "2026-12-31T00:00:00.000Z" }) { _id briefStatus briefDeadline }
  }
  ```

  Otherwise → `BAD_REQUEST` `"Deadline must be in the future!"`.

**Errors**

| Code | Message | When / UI |
|---|---|---|
| `BAD_REQUEST` | `Budget must be greater than 0!` | under budget |
| `BAD_REQUEST` | `Deadline must be in the future!` | under deadline; on reopen, open the deadline dialog |
| `BAD_REQUEST` | status change message above | shouldn't happen if buttons follow the table |
| `NOT_FOUND` | `Update failed!` | brief deleted, not yours, missing, or changed meanwhile. Reload |
| `FORBIDDEN` | `Allowed only for members with specific roles!` | a creator or admin; hide the page for them |

**UI hints**

- Per brief: **Close** (when `OPEN`), **Reopen** (when `CLOSED`), **Delete** (always, with a "can't be undone" confirm), **Edit**.
- **Reopen:** if `briefDeadline` is in the past, open a dialog first: "The deadline has passed. Choose a new deadline or remove it." Then send `briefStatus: OPEN` + `briefDeadline` (new date or `null`) together.
- Deadline picker: disallow past dates.
- `memberBriefs` changes only on create and delete, not on close / reopen.

### 3.8 Comments

**Operations:** `getComments(input: CommentsInquiry!)` (public), `createComment`, `updateComment` (logged in), `removeCommentByAdmin` (3.12).

**Changes**

- `getComments` **requires** `search.commentGroup` next to `commentRefId`: `{ commentRefId, commentGroup: PRODUCT }`. Without it → `GRAPHQL_VALIDATION_FAILED` (D-16). Only comments of that group are returned.
- `CommentGroup.PROPERTY` → `PRODUCT`; new `BRIEF`. Sending `PROPERTY` → `GRAPHQL_VALIDATION_FAILED`.
- `commentContent` is 1–100 characters.
- Sorts: `createdAt`, `updatedAt`.

**Who can read (comments follow their target's visibility)**

| Group | Readable when | Otherwise |
|---|---|---|
| `PRODUCT` | product is `ACTIVE`; a `PAUSED` product only for owner / admin | `NOT_FOUND` `"No data found!"` (also for missing or deleted products; before, an empty list) |
| `BRIEF` | brief is `OPEN` or `CLOSED`, for everyone, guests included | `NOT_FOUND` for deleted or missing |
| `ARTICLE` | article exists and isn't deleted | `NOT_FOUND` |
| `MEMBER` | member exists and isn't deleted (blocked members' comments stay readable) | `NOT_FOUND` |

**Who can write** (`createComment`)

- Any logged-in member, on an `ACTIVE` product, an `OPEN` brief (the brief's owner too), an `ACTIVE` article or an active member.
- A `PAUSED` product, `CLOSED` brief, or a missing / deleted target → `NOT_FOUND` `"No data found!"`. A malformed `commentRefId` → `BAD_REQUEST`.

**Deleting** (`updateComment({ _id, commentStatus: DELETE })`, own comments)

- The target's counter (`productComments`, `briefComments`, …) now drops by 1 (B19). Update it locally or refetch.
- A second delete, someone else's comment, or a missing comment → `NOT_FOUND` `"Update failed!"`.

**UI hints**

- **Closed brief:** show the comments, hide the comment box, and show "This brief is closed" instead.
- **Paused product (owner view):** hide the comment box.
- Show the comment box only to logged-in members; for guests show "Log in to comment".
- Treat `NOT_FOUND` from `getComments` as "target not available", not as "no comments".

### 3.9 Likes, views, follows, favorites

**Likes**

- `likeTargetProperty(propertyId)` → `likeTargetProduct(productId)`. It toggles: call again to unlike. Use the returned `meLiked` / `productLikes`.
- `likeTargetProduct` on a paused, deleted or missing product → `NOT_FOUND`. Products only; briefs have no likes.
- `likeTargetMember`, `likeTargetBoardArticle`: unchanged names; a missing target → `NOT_FOUND` (was `INTERNAL_SERVER_ERROR`).

**Favorites and recently viewed**

- `getFavorities(input: { page, limit })` and `getVisited(input: { page, limit })` keep their names (including the misspelling) and now return `Products`. Update fragments from `property*` to `product*`.
- They return only `ACTIVE` products (D-16). A liked product that is later paused or deleted disappears from favorites; `metaCounter` matches.

**Views**

- No client call; `getProduct` / `getBrief` / `getMember` / `getBoardArticle` record the view.
- Views are counted for logged-in members only, once per member, never for the owner, never on paused products or closed briefs. Don't expect the view counter to change when you open your own item.

**Follows**

- `subscribe(input: memberId)`, `unsubscribe(input: memberId)`: logged in.
  - Following yourself → `BAD_REQUEST` `"Self subscription is denied!"`. Hide the button on your own profile.
  - `unsubscribe` when not following → `NOT_FOUND`.
- `getMemberFollowings(input: { page, limit, search: { followerId } })`: who `followerId` follows.
- `getMemberFollowers(input: { page, limit, search: { followingId } })`: who follows `followingId`.
  - Missing id → `BAD_REQUEST`; malformed id → `BAD_REQUEST` (B16).
- Results carry `meFollowed` for logged-in viewers.

### 3.10 Community board (articles)

Unchanged operations: `createBoardArticle`, `getBoardArticle(articleId)`, `getBoardArticles`, `updateBoardArticle`, `likeTargetBoardArticle(articleId)`.

**Changes**

- `articleTitle` 3–50, `articleContent` 3–250 characters. `articleImage` optional; upload with `target: "article"`.
- Update: `null` on `articleTitle`, `articleContent`, `articleStatus` → `BAD_REQUEST`; `null` on `articleImage` clears it (B11).
- `getBoardArticles`: `search.text` max 100; a malformed `search.memberId` → `BAD_REQUEST` (B16).
- `getBoardArticle` on a missing or deleted article → `NOT_FOUND` `"No data found!"`.
- `updateBoardArticle` on a missing, someone else's, or deleted article → `NOT_FOUND` `"Update failed!"`.
- Article content is plain text: render it as text, not HTML.

### 3.11 Community chat (WebSocket)

D-19 keeps the public chat for the MVP. It is a raw WebSocket (`ws`), not Socket.IO.

**Protocol**

- Connect to `ws://<api-host>:<PORT_API>?token=<accessToken>` (the token as a query parameter; leave it out for guests). A missing, invalid or expired token, or a member who isn't `ACTIVE`, connects as a **guest**.
- Send a message: `{"event":"message","data":"<text>"}`.
- The server sends JSON frames with an `event` field:

  | `event` | Payload | Meaning |
  |---|---|---|
  | `getMessages` | `{ list: [{ event, text, memberData }] }` | the last 5 messages, sent once on connect |
  | `message` | `{ text, memberData }` | a new message, to everyone including the sender |
  | `info` | `{ totalClients, memberData, action: "joined" \| "left" }` | someone joined or left; `memberData` is `null` for guests |
  | `error` | `{ message }` | only to the sender, see below |

- `memberData` has only `_id`, `memberNick`, `memberImage`, `memberType`. Don't expect other member fields.

**Errors** (the `error` event)

| Message | When |
|---|---|
| `You are not authenticated, please login first!` | a guest tried to send |
| `Message must be text of 1 to 500 characters!` | empty (after trimming) or longer than 500 |
| `You can send at most 1 message per second!` | rate limit, per member across all their tabs |

**UI hints**

- **Render message text as plain text** (text nodes / the framework's default escaping). Never `innerHTML` or `dangerouslySetInnerHTML`.
- Guests can read; **hide the send box** for them ("Log in to chat").
- Show the `error` messages to the sender (e.g. under the input); disable the send button for 1 second after sending.
- Limit the input to 500 characters.
- Reconnect after login / logout so the socket uses the new token.
- There is no private messaging (D-08); contact happens through the profile contacts.

### 3.12 Admin pages

All `*ByAdmin` operations need an `ADMIN` token; others get `FORBIDDEN` `"Allowed only for members with specific roles!"`.

**Members**

- `getAllMembersByAdmin(input: MembersInquiry!)`: `search` (`MISearch`): `memberStatus`, `memberType`, `text` (max 100). Sorts in 2.5.
- `updateMemberByAdmin(input: MemberUpdateByAdmin!)`:
  - can change `memberStatus` (`ACTIVE`, `BLOCK`, `DELETE`) and profile fields;
  - **can't** change `memberType` or the password: both fields are gone (D-14, D-24). Sending them → `GRAPHQL_VALIDATION_FAILED`;
  - phone is E.164 (D-25); a duplicate nick / phone → `CONFLICT`; a missing member → `NOT_FOUND`.
- Blocking a member takes effect on their **next** request: they get `FORBIDDEN` "You have been blocked!" and are logged out (B17).
- Admins see members' contacts (they're logged in).

**Products**

- `getAllProductsByAdmin(input: AllProductsInquiry!)`: every status, including `PAUSED` and `DELETE`. `search` (`ALPISearch`): `productStatus`, `memberId`, `periodsRange`, plus the 3.3 filters.
- `updateProductByAdmin(input: ProductUpdate!)`: same field rules, price rule and status table as the owner (D-29): pause, resume, delete. A deleted or missing product → `NOT_FOUND` `"Update failed!"`.
- `getProduct` returns paused products to admins (with no view counted), but not deleted ones; use the admin list for those.

**Briefs**

- `getAllBriefsByAdmin(input: AllBriefsInquiry!)`: every status. `search` (`ALBISearch`): `briefStatus`, `memberId`, `categoryList`, `text`.
- `updateBriefByAdmin(input: BriefUpdate!)`: any member's brief, same rules and errors as `updateBrief` (3.7), including the reopen deadline rule.

**Board articles and comments**

- `getAllBoardArticlesByAdmin`: `search` (`ABAISearch`): `articleStatus`, `articleCategory`.
- `updateBoardArticleByAdmin`: same rules as the owner update.
- `removeCommentByAdmin(commentId)`: hard delete; the target's comment counter drops by 1 if the comment was still active (B19).

**Two-step remove (D-28)**

`removeProductByAdmin`, `removeBriefByAdmin` and `removeBoardArticleByAdmin` **hard-delete only items already set to `DELETE`**:

1. Soft delete: `updateProductByAdmin` / `updateBriefByAdmin` / `updateBoardArticleByAdmin` with status `DELETE`.
2. Remove: `removeProductByAdmin(productId)` / `removeBriefByAdmin(briefId)` / `removeBoardArticleByAdmin(articleId)`.

Calling remove on an active / open / closed / paused or missing item → `NOT_FOUND` `"Remove failed!"`. In Nestar, `removeBoardArticleByAdmin` removed `ACTIVE` articles in one call; that no longer works.

**UI hints**

- In admin tables, show a **Delete** action for live items and a **Remove permanently** action only for items whose status is `DELETE`, with a confirm dialog ("cannot be undone").
- Status dropdowns should offer only the allowed transitions (3.5, 3.7).

---

## 4. Checklist

### Global

- [ ] API client sends `Authorization: Bearer <token>`; the profile is loaded from `login` / `getMember`, never decoded from the token (S9).
- [ ] Error handler: `UNAUTHENTICATED`, or `FORBIDDEN` + `"You have been blocked!"` → clear token and redirect to login (not on the login form). Other `FORBIDDEN` → message only (B17).
- [ ] Field errors from `extensions.validationErrors`; business errors from `message`; message strings kept as constants (B14, B15).
- [ ] Malformed id from a URL → "not found" page (B18).
- [ ] Update forms send only changed fields; cleared optional fields as `null`; `memberImage` cleared with `''` (B11, D-15).
- [ ] List queries use the new sort values; total read as `metaCounter?.[0]?.total ?? 0`.
- [ ] Prices shown in USD, subscriptions as "/ month" (D-06).
- [ ] Placeholder image when `memberImage` is `''` (D-15).
- [ ] Client types regenerated from introspection; no `Property`, `property*`, `AGENT`, `getAgents`, `memberProperties` left (`grep -ri "propert\|agent"` in the frontend).

### Removed real-estate features (D-10)

- [ ] Property pages, routes and components removed or converted to products.
- [ ] Filters for location, type, rooms, beds, square, options, barter / rent removed.
- [ ] "Sold" state, `soldAt`, `constructedAt`, address and map UI removed.
- [ ] `memberAddress` removed from profile views and forms.

### Signup, login, profile

- [ ] Signup requires choosing `USER` or `CREATOR` (D-14).
- [ ] Login shows one error for wrong nick / password; a blocked screen for `FORBIDDEN` (D-27).
- [ ] Password rules: 8+ characters, ≤ 72 bytes on signup and new password; no length check on login (D-26).
- [ ] Phone and WhatsApp inputs produce E.164 (D-25).
- [ ] Contacts shown only to logged-in viewers, from the API's `null`; "Log in to see contacts" for guests; own contacts loaded with `getMember` after login (D-07, D-23).
- [ ] Separate "Change password" form using `changePassword`; `memberPassword` removed from profile edit; no "Forgot password" (D-24).
- [ ] `memberProducts` / `memberBriefs` shown on profiles.

### Products

- [ ] Marketplace filters: category, pricing, price range, tags, text; `INVALID_PRICE_RANGE` handled.
- [ ] `productPrice` nullable: "Free" / "Custom quote" / `$X` / `$X / month` (D-03).
- [ ] Detail page handles `NOT_FOUND` for paused, deleted and old links (D-16).
- [ ] Owner's paused product: banner; like and comment controls hidden (D-16).
- [ ] Creator dashboard uses `getCreatorProducts`, with a "Paused" badge and status tabs.
- [ ] Create / edit form: category, pricing, conditional price, desc 20–3000, ≥ 1 image, demo URL, tags; price input shown only for `ONE_TIME` / `SUBSCRIPTION`; `CONFLICT` on duplicate title.
- [ ] Pause / resume / delete buttons following the status table (D-16, D-29).
- [ ] Image upload uses `target: "product"`.

### Briefs

- [ ] Brief list (open by default, "show closed" option) and detail pages, public.
- [ ] "Open to offers" for `null` budget, "No deadline" for `null` deadline, "Deadline passed" for past deadlines (D-04, D-05).
- [ ] "Closed" badge (D-30).
- [ ] "Post a brief" / "My briefs" only for `USER` members.
- [ ] Create / edit form: budget > 0 or empty, future-only deadline picker.
- [ ] Close / reopen / delete buttons; reopen asks for a new deadline (or none) when the deadline has passed, and sends it with the status change (D-31).

### Comments, likes, follows

- [ ] `getComments` sends `commentGroup`; `PROPERTY` → `PRODUCT`; `BRIEF` supported.
- [ ] `NOT_FOUND` from `getComments` → "not available", not "no comments".
- [ ] No comment box on closed briefs (comments still shown) or on paused products (D-30, D-16).
- [ ] Counters updated after deleting a comment (B19).
- [ ] `likeTargetProduct`; favorites and visited use the `Product` fragment.
- [ ] Follow button hidden on your own profile.

### Board and chat

- [ ] Article title / content limits; article content rendered as text.
- [ ] Chat: plain-text rendering, send box hidden for guests, server errors shown, 500-character limit, public member fields only, reconnect on login / logout (D-19).

### Admin

- [ ] No member type or password editing (D-14, D-24).
- [ ] Product pause / resume / delete for admins (D-29).
- [ ] Brief admin list and edit, including the reopen deadline rule.
- [ ] Two-step remove for products, briefs and articles: soft delete first, then "Remove permanently" (D-28).

---

## Appendix: error messages

The `message` strings the UI may need to match. Codes are those the API returns for each.

| Message | Code | Where |
|---|---|---|
| `No data found!` | `NOT_FOUND` (or `BAD_REQUEST` for a `DELETE` status filter) | detail pages, comments, likes, list status filters |
| `Update failed!` | `NOT_FOUND` | `update*` on missing, hidden, not-yours or concurrently changed items |
| `Remove failed!` | `NOT_FOUND` | `remove*ByAdmin` on items not in `DELETE` |
| `Create failed!` | `BAD_REQUEST` | other create failures |
| `<arg> must be a mongodb id` | `BAD_REQUEST` | malformed id (B18) |
| `Already used member nick or phone` | `CONFLICT` | signup, member updates |
| `A product with this title already exists for this creator!` | `CONFLICT` | product create / update |
| `Wrong member nick or password!` | `UNAUTHENTICATED` | login |
| `You have been blocked!` | `FORBIDDEN` | login, any logged-in operation |
| `You are not authenticated, please login first!` | `UNAUTHENTICATED` | bad / expired token, deleted member; chat send as guest |
| `Bearer Token is not provided!` | `UNAUTHENTICATED` | logged-in operation without a token |
| `Allowed only for members with specific roles!` | `FORBIDDEN` | wrong role |
| `Wrong password, try again!` | `BAD_REQUEST` | `changePassword` |
| `New password must be different from the current password!` | `BAD_REQUEST` | `changePassword` |
| `Password must be at least 8 characters!` | `BAD_REQUEST` | signup, `changePassword` |
| `Password must be at most 72 bytes (72 Latin letters, fewer for other alphabets and emoji)!` | `BAD_REQUEST` | signup, `changePassword` |
| `Phone number must be in international format, e.g. +998901234567 (8 to 15 digits)!` | `BAD_REQUEST` | signup, member updates |
| `WhatsApp number must be in international format, e.g. +998901234567 (8 to 15 digits)!` | `BAD_REQUEST` | member updates |
| `Please provide a valid email of at most 254 characters!` | `BAD_REQUEST` | member updates |
| `Price greater than 0 is required for ONE_TIME and SUBSCRIPTION pricing!` | `BAD_REQUEST` | product create / update |
| `Price is not allowed for FREE and CUSTOM pricing!` | `BAD_REQUEST` | product create / update |
| `Price range start must not be greater than its end!` | `BAD_REQUEST` | product lists |
| `Product status can only change between ACTIVE and PAUSED, or to DELETE!` | `BAD_REQUEST` | product update |
| `Budget must be greater than 0!` | `BAD_REQUEST` | brief create / update |
| `Deadline must be in the future!` | `BAD_REQUEST` | brief create / update / reopen |
| `Brief status can only change between OPEN and CLOSED, or to DELETE!` | `BAD_REQUEST` | brief update |
| `Self subscription is denied!` | `BAD_REQUEST` | `subscribe` |
| `Please provide jpg, jpeg or png images!` | `BAD_REQUEST` | image upload |
| `Message must be text of 1 to 500 characters!` | chat `error` event | chat |
| `You can send at most 1 message per second!` | chat `error` event | chat |
| `Something went wrong!` | `INTERNAL_SERVER_ERROR` | server fault |
