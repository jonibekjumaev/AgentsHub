# AgentsHub — ER Model (MongoDB)

> Source of truth for the database schema. Derived from the Nestar ER model.
> Every schema, DTO and GraphQL type must match this file. If code and this file disagree, fix one of them on purpose and record why in `docs/decisions.md`.

## Domain summary

AgentsHub is a marketplace for AI agents.

- **CREATOR** members publish **Products**, which are listings for AI agents they built: images, description, category, pricing, and an optional demo link.
- **USER** members publish **Briefs**, which describe a business need for a custom AI agent.
- Contact happens **off-platform**. A member profile shows email/WhatsApp to logged-in members only.
- Social features work as in Nestar: likes, views, comments, follows, board articles, notices and notifications.

## Conventions

- `NN` = required (not null). Fields without `NN` are optional.
- `PK` = primary key, `FK` = reference (ObjectId) to another collection.
- Field names keep the Nestar prefix style: `product*`, `brief*`, `member*`.
- Every collection has `createdAt` / `updatedAt` (Mongoose `timestamps: true`).
- Soft delete uses a `*Status = DELETE` value plus `deletedAt`.
- Polymorphic references (`viewRefId`, `likeRefId`, `commentRefId`) point to different collections, chosen by the matching `*Group` enum.

---

## Collections

### members

| Field | Type | NN | Key | Notes |
|---|---|---|---|---|
| _id | ObjectId | NN | PK | |
| memberType | enum MemberType | NN | | `USER`, `CREATOR` or `ADMIN`. Chosen once at signup |
| memberStatus | enum MemberStatus | NN | | unchanged from Nestar |
| memberAuthType | enum MemberAuthType | NN | | unchanged from Nestar |
| memberPhone | string | NN | | unique |
| memberNick | string | NN | | unique |
| memberPassword | string | NN | | hashed, never returned (`select: false`) |
| memberFullName | string | | | |
| memberImage | string | NN | | default '' — empty means no image, frontend shows a placeholder |
| memberEmail | string | | | **new**. Contact, visible to logged-in members only |
| memberWhatsapp | string | | | **new**. Contact, visible to logged-in members only |
| memberDesc | string | | | bio |
| memberProducts | int | NN | | **new** (was `memberProperties`), default 0 |
| memberBriefs | int | NN | | **new**, default 0 |
| memberArticles | int | NN | | default 0 |
| memberFollowers | int | NN | | default 0 |
| memberFollowings | int | NN | | default 0 |
| memberPoints | int | NN | | default 0 |
| memberLikes | int | NN | | default 0 |
| memberViews | int | NN | | default 0 |
| memberComments | int | NN | | default 0 |
| memberRank | int | NN | | default 0 |
| memberWarnings | int | NN | | default 0 |
| memberBlocks | int | NN | | default 0 |
| deletedAt | date | | | |
| createdAt | date | NN | | |
| updatedAt | date | NN | | |

Removed from Nestar: `memberAddress`, `memberProperties`.

### products (AI agent listings)

| Field | Type | NN | Key | Notes |
|---|---|---|---|---|
| _id | ObjectId | NN | PK | |
| productCategory | enum AgentCategory | NN | | |
| productStatus | enum ProductStatus | NN | | default `ACTIVE` |
| productPricing | enum ProductPricing | NN | | |
| productTitle | string | NN | | |
| productPrice | double | | | conditional, see D-03 |
| productDemoUrl | string | | | must be a valid http(s) URL |
| productTags | string[] | | | free tags, e.g. "telegram", "crm" |
| productViews | int | NN | | default 0 |
| productLikes | int | NN | | default 0 |
| productComments | int | NN | | default 0 |
| productRank | int | NN | | default 0 |
| productImages | string[] | NN | | at least 1 image |
| productDesc | string | NN | | required: a listing needs a description, and semantic search will rely on it (D-18) |
| memberId | ObjectId | NN | FK → members | owner, must be a CREATOR |
| deletedAt | date | | | |
| createdAt | date | NN | | |
| updatedAt | date | NN | | |

Removed from Nestar `properties`: `propertyAddress`, `propertySquare`, `propertyBeds`, `propertyRooms`, `propertyBarter`, `propertyRent`, `propertyLocation`, `constructedAt`, `soldAt`.

Suggested indexes:

- `{ memberId: 1, productStatus: 1 }`
- `{ productCategory: 1, productStatus: 1 }`
- `{ productStatus: 1, productRank: -1 }`
- unique `{ memberId: 1, productTitle: 1 }`, so one creator cannot have two listings with the same title

### briefs (new)

| Field | Type | NN | Key | Notes |
|---|---|---|---|---|
| _id | ObjectId | NN | PK | |
| briefCategory | enum AgentCategory | NN | | |
| briefStatus | enum BriefStatus | NN | | default `OPEN` |
| briefTitle | string | NN | | |
| briefContent | string | NN | | business need described in plain words |
| briefBudget | double | | | see D-04 |
| briefDeadline | date | | | see D-05 |
| briefViews | int | NN | | default 0 |
| briefComments | int | NN | | default 0 |
| memberId | ObjectId | NN | FK → members | author, must be a USER |
| closedAt | date | | | set when status becomes `CLOSED` |
| deletedAt | date | | | |
| createdAt | date | NN | | |
| updatedAt | date | NN | | |

Suggested indexes:

- `{ memberId: 1, briefStatus: 1 }`
- `{ briefCategory: 1, briefStatus: 1, createdAt: -1 }`

### boardArticles (unchanged from Nestar)

| Field | Type | NN | Key |
|---|---|---|---|
| _id | ObjectId | NN | PK |
| articleCategory | enum | NN | |
| articleStatus | enum | NN | |
| articleTitle | string | NN | |
| articleContent | string | NN | |
| articleImage | string | | |
| articleLikes | int | NN | |
| articleViews | int | NN | |
| articleComments | int | NN | |
| memberId | ObjectId | NN | FK → members |
| createdAt | date | NN | |
| updatedAt | date | NN | |

### comments

| Field | Type | NN | Key | Notes |
|---|---|---|---|---|
| _id | ObjectId | NN | PK | |
| commentStatus | enum | NN | | unchanged |
| commentGroup | enum CommentGroup | NN | | `MEMBER`, `PRODUCT`, `BRIEF` or `ARTICLE` |
| commentRefId | ObjectId | NN | FK (polymorphic) | |
| commentContent | string | NN | | |
| memberId | ObjectId | NN | FK → members | author |
| createdAt | date | NN | | |
| updatedAt | date | NN | | |

### likes

| Field | Type | NN | Key | Notes |
|---|---|---|---|---|
| _id | ObjectId | NN | PK | |
| likeGroup | enum LikeGroup | NN | | `MEMBER`, `PRODUCT` or `ARTICLE` |
| likeRefId | ObjectId | NN | FK (polymorphic) | |
| memberId | ObjectId | NN | FK → members | |
| createdAt | date | NN | | |
| updatedAt | date | NN | | |

Unique index: `{ memberId: 1, likeRefId: 1 }`. `memberId` comes first so the same index serves the favorites query (by `memberId`) and the "already liked" check (both fields), see D-18.

### views

| Field | Type | NN | Key | Notes |
|---|---|---|---|---|
| _id | ObjectId | NN | PK | |
| viewGroup | enum ViewGroup | NN | | `MEMBER`, `PRODUCT`, `BRIEF` or `ARTICLE` |
| viewRefId | ObjectId | NN | FK (polymorphic) | |
| memberId | ObjectId | NN | FK → members | |
| createdAt | date | NN | | |
| updatedAt | date | NN | | |

Unique index: `{ memberId: 1, viewRefId: 1 }`. `memberId` comes first so the same index serves the visited query (by `memberId`) and the "already viewed" check (both fields), see D-18.

### follows (unchanged)

| Field | Type | NN | Key |
|---|---|---|---|
| _id | ObjectId | NN | PK |
| followingId | ObjectId | NN | FK → members |
| followerId | ObjectId | NN | FK → members |
| createdAt | date | NN | |
| updatedAt | date | NN | |

Unique index: `{ followingId: 1, followerId: 1 }`.

### notices (unchanged)

| Field | Type | NN | Key |
|---|---|---|---|
| _id | ObjectId | NN | PK |
| noticeCategory | enum | NN | |
| noticeStatus | enum | NN | |
| noticeTitle | string | NN | |
| noticeContent | string | NN | |
| memberId | ObjectId | NN | FK → members (admin) |
| createdAt | date | NN | |
| updatedAt | date | NN | |

### notifications

| Field | Type | NN | Key | Notes |
|---|---|---|---|---|
| _id | ObjectId | NN | PK | |
| notificationType | enum | NN | | unchanged |
| notificationGroup | enum | NN | | if it contains `PROPERTY`, replace it with `PRODUCT` and add `BRIEF` |
| notificationStatus | enum | NN | | unchanged |
| notificationTitle | string | NN | | |
| notificationDesc | string | | | optional, the title can be enough (D-18) |
| authorId | ObjectId | NN | FK → members | who triggered it |
| receiverId | ObjectId | NN | FK → members | who receives it |
| productId | ObjectId | | FK → products | **replaces `propertyId`** |
| briefId | ObjectId | | FK → briefs | **new** |
| articleId | ObjectId | | FK → boardArticles | |
| createdAt | date | NN | | |
| updatedAt | date | NN | | |

### Not included in the MVP

`auths`, `boconfigs` and `mobilemessages` from the Nestar PDF are left out.

---

## Enums

| Enum | Values | Used by |
|---|---|---|
| MemberType | `USER`, `CREATOR`, `ADMIN` | members.memberType (Nestar `AGENT` → `CREATOR`) |
| AgentCategory | `CUSTOMER_SUPPORT`, `SALES`, `MARKETING`, `CONTENT`, `DATA_ANALYSIS`, `AUTOMATION`, `EDUCATION`, `OTHER` | products.productCategory, briefs.briefCategory |
| ProductPricing | `FREE`, `ONE_TIME`, `SUBSCRIPTION`, `CUSTOM` | products.productPricing |
| ProductStatus | `ACTIVE`, `PAUSED`, `DELETE` | products.productStatus |
| BriefStatus | `OPEN`, `CLOSED`, `DELETE` | briefs.briefStatus |
| LikeGroup | `MEMBER`, `PRODUCT`, `ARTICLE` | likes.likeGroup |
| ViewGroup | `MEMBER`, `PRODUCT`, `BRIEF`, `ARTICLE` | views.viewGroup |
| CommentGroup | `MEMBER`, `PRODUCT`, `BRIEF`, `ARTICLE` | comments.commentGroup |

All other enums (MemberStatus, MemberAuthType, article, notice and notification enums) stay as in Nestar.

---

## Relationships

| From | Field | To | Cardinality |
|---|---|---|---|
| products | memberId | members (CREATOR) | many → 1 |
| briefs | memberId | members (USER) | many → 1 |
| boardArticles | memberId | members | many → 1 |
| comments / likes / views | memberId | members | many → 1 |
| comments / likes / views | *RefId + *Group | members / products / briefs / boardArticles | polymorphic |
| follows | followingId, followerId | members | many → many (self) |
| notices | memberId | members (ADMIN) | many → 1 |
| notifications | authorId, receiverId | members | many → 1 |
| notifications | productId / briefId / articleId | products / briefs / boardArticles | optional |

## Business rules (enforced in services/guards, not in the schema)

1. Only `CREATOR` members can create, update or delete Products.
2. Only `USER` members can create, update, close or delete Briefs.
3. `memberEmail` and `memberWhatsapp` are returned only to authenticated requests.
4. `productPrice` follows D-03, `briefBudget` follows D-04, and `briefDeadline` follows D-05 in `docs/decisions.md`.
5. Counters (`memberProducts`, `productLikes`, `briefViews`, …) change only through service methods, never directly from client input.
