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
| memberDesc | string | | | bio, max 500 characters (D-35) |
| memberBrowsePrivately | boolean | | | **new** (D-42), default false. Profile visits are only counted, never named. Returned to the member themself only |
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
| memberRankPosition | int | | | place among ranked ACTIVE creators, 1 = top; set by the nightly batch, missing = not ranked (D-37) |
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
| productDemoUrl | string | | | must be a valid http(s) URL, max 500 characters |
| productTags | string[] | | | free tags, e.g. "telegram", "crm"; max 10, 1–30 characters each; saved trimmed, lowercased and without duplicates |
| productViews | int | NN | | default 0 |
| productLikes | int | NN | | default 0 |
| productComments | int | NN | | default 0 |
| productRank | int | NN | | default 0 |
| productRankPosition | int | | | place among ranked ACTIVE products, 1 = top; set by the nightly batch, missing = not ranked (D-37) |
| productImages | string[] | NN | | 1–10 images |
| productDesc | string | NN | | required, 20–3000 characters: a listing needs a description, and semantic search relies on it (D-18, D-52). Can't be cleared on update |
| memberId | ObjectId | NN | FK → members | owner, must be a CREATOR |
| deletedAt | date | | | |
| embedding | number[1024] | | | D-52: vector of title + category + tags + description. Never selected, never in GraphQL |
| embeddingStatus | enum EmbeddingStatus | NN | | D-52: `PENDING` (default; also missing = before D-52), `READY`, `FAILED` |
| embeddingModel | string | | | D-52: the model that made `embedding` |
| embeddingHash | string | | | D-52: sha256 of the embedded text |
| embeddingAttempts | int | NN | | D-52: failed attempts since the last text change; default 0 |
| embeddedAt | date | | | D-52 |
| createdAt | date | NN | | |
| updatedAt | date | NN | | |

Removed from Nestar `properties`: `propertyAddress`, `propertySquare`, `propertyBeds`, `propertyRooms`, `propertyBarter`, `propertyRent`, `propertyLocation`, `constructedAt`, `soldAt`.

Suggested indexes:

- `{ memberId: 1, productStatus: 1 }`
- `{ productCategory: 1, productStatus: 1 }`
- `{ productStatus: 1, productRank: -1 }`
- `{ embeddingStatus: 1 }` (D-52, the reconcile job), and the Atlas vectorSearch index `product_embedding` (`embedding` 1024 cosine + filter `productStatus`)
- text index `product_text`: `productTitle` (weight 10), `productTags` (5), `productDesc` (1) — the keyword half of the hybrid search (D-53)
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
| briefOffers | int | NN | | default 0; `PENDING` + `ACCEPTED` offers (D-48) |
| memberId | ObjectId | NN | FK → members | author, must be a USER |
| closedAt | date | | | set when status becomes `CLOSED` |
| deletedAt | date | | | |
| embedding, embeddingStatus, embeddingModel, embeddingHash, embeddingAttempts, embeddedAt | | | | D-52, as in products; the text is title + category + content. Atlas vectorSearch index `brief_embedding` (filter `briefStatus`); text index `brief_text`: `briefTitle` (10), `briefContent` (1), D-53 |
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

`articleTitle` 3–50 and `articleContent` 3–3000 characters (D-35; Nestar allowed 3–250).

Indexes (D-46):

- `{ articleStatus: 1, articleCategory: 1, createdAt: -1 }`: the board, with or without a topic, newest first; also the topic counts
- `{ memberId: 1, articleStatus: 1 }`: one member's articles (profile, dashboard)

### comments

| Field | Type | NN | Key | Notes |
|---|---|---|---|---|
| _id | ObjectId | NN | PK | |
| commentStatus | enum | NN | | unchanged |
| commentGroup | enum CommentGroup | NN | | `MEMBER`, `PRODUCT`, `BRIEF` or `ARTICLE` |
| commentRefId | ObjectId | NN | FK (polymorphic) | |
| commentContent | string | NN | | 1–1000 characters (D-35) |
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
| createdAt | date | NN | | first visit |
| updatedAt | date | NN | | latest visit: every repeat view refreshes it (B24) |

Unique index: `{ memberId: 1, viewRefId: 1 }`. `memberId` comes first so the same index serves the visited query (by `memberId`) and the "already viewed" check (both fields), see D-18.

Index `{ viewRefId: 1, viewGroup: 1, updatedAt: -1 }`: "who viewed your profile" (D-42), one profile's visits, latest first. Admins' views are never recorded (D-42).

### follows (unchanged)

| Field | Type | NN | Key |
|---|---|---|---|
| _id | ObjectId | NN | PK |
| followingId | ObjectId | NN | FK → members |
| followerId | ObjectId | NN | FK → members |
| createdAt | date | NN | |
| updatedAt | date | NN | |

Unique index: `{ followingId: 1, followerId: 1 }`.

### saves (new, D-47)

A member's private bookmark of a brief ("Save brief"). Never counted, never shown to the brief's owner.

| Field | Type | NN | Key | Notes |
|---|---|---|---|---|
| _id | ObjectId | NN | PK | |
| memberId | ObjectId | NN | FK → members | who saved it, a USER or CREATOR |
| briefId | ObjectId | NN | FK → briefs | the saved brief, not the member's own |
| createdAt | date | NN | | when it was saved: the saved list is newest first |
| updatedAt | date | NN | | |

Indexes:

- unique `{ memberId: 1, briefId: 1 }`: one save per member and brief; also the "is it saved" check
- `{ memberId: 1, createdAt: -1 }`: one member's saves, latest first

### offers (new, D-48)

A creator's offer on a brief. One document per creator and brief for its whole life (re-sent after `WITHDRAWN` / `EXPIRED`).

| Field | Type | NN | Key | Notes |
|---|---|---|---|---|
| _id | ObjectId | NN | PK | |
| briefId | ObjectId | NN | FK → briefs | |
| creatorId | ObjectId | NN | FK → members | who sends it, a CREATOR |
| userId | ObjectId | NN | FK → members | the brief's owner, copied from the brief |
| productId | ObjectId | | FK → products | optional, one of the creator's `ACTIVE` agents |
| offerStatus | enum OfferStatus | NN | | default `PENDING` |
| offerCloseReason | enum OfferCloseReason | | | `BRIEF_CLOSED` when the brief closed it |
| offerPrice | double | NN | | USD, > 0 |
| offerDeliveryDays | int | NN | | 1–365 |
| offerMessage | string | NN | | 20–2000 characters |
| sentAt | date | NN | | first sent, or last re-sent; lists sort by it |
| expiresAt | date | | | `PENDING` only: last sent or edited + 14 days |
| closedAt | date | | | set on `ACCEPTED`, `DECLINED`, `WITHDRAWN`, `EXPIRED` |
| createdAt | date | NN | | |
| updatedAt | date | NN | | |

Indexes:

- unique `{ briefId: 1, creatorId: 1 }`: one offer per creator and brief; also `Brief.meOffer`
- `{ briefId: 1, offerStatus: 1, sentAt: -1 }`: the owner's list of a brief's offers
- `{ creatorId: 1, offerStatus: 1, sentAt: -1 }`: a creator's offers
- `{ creatorId: 1, sentAt: -1 }`: the daily limit
- `{ offerStatus: 1, expiresAt: 1 }`: the expiry job

### invites (new, D-48)

A brief's owner asks a creator to send an offer.

| Field | Type | NN | Key | Notes |
|---|---|---|---|---|
| _id | ObjectId | NN | PK | |
| briefId | ObjectId | NN | FK → briefs | an `OPEN` brief |
| userId | ObjectId | NN | FK → members | the brief's owner |
| creatorId | ObjectId | NN | FK → members | an `ACTIVE` CREATOR |
| createdAt | date | NN | | |
| updatedAt | date | NN | | |

Indexes:

- unique `{ briefId: 1, creatorId: 1 }`: one invite per creator and brief
- `{ creatorId: 1, createdAt: -1 }`: a creator's invites
- `{ userId: 1, createdAt: -1 }`: the daily limit

### conversations (new, D-49)

The 1:1 conversation of one offer. Whether it takes messages is computed (offer, members, lock), not stored.

| Field | Type | NN | Key | Notes |
|---|---|---|---|---|
| _id | ObjectId | NN | PK | |
| offerId | ObjectId | NN | FK → offers | one conversation per offer |
| briefId | ObjectId | NN | FK → briefs | |
| userId | ObjectId | NN | FK → members | the brief's owner, who opened it |
| creatorId | ObjectId | NN | FK → members | the offer's creator |
| lastMessageAt | date | | | |
| lastMessagePreview | string | | | the first 140 characters of the last message |
| lastSenderId | ObjectId | | FK → members | |
| userUnread | int | NN | | default 0 |
| creatorUnread | int | NN | | default 0 |
| lockedByAdmin | boolean | NN | | default false |
| createdAt | date | NN | | |
| updatedAt | date | NN | | |

Indexes:

- unique `{ offerId: 1 }`
- `{ userId: 1, lastMessageAt: -1 }`, `{ creatorId: 1, lastMessageAt: -1 }`: each side's list

### messages (new, D-49)

Model name `ChatMessage` (not to be confused with the `Message` error enum).

| Field | Type | NN | Key | Notes |
|---|---|---|---|---|
| _id | ObjectId | NN | PK | the history cursor |
| conversationId | ObjectId | NN | FK → conversations | |
| senderId | ObjectId | NN | FK → members | |
| messageText | string | NN | | 1–3000 characters, trimmed, plain text |
| clientMessageId | string | NN | | a UUID from the client: retries store one message |
| createdAt | date | NN | | |
| updatedAt | date | NN | | |

Indexes:

- `{ conversationId: 1, _id: -1 }`: history
- unique `{ senderId: 1, clientMessageId: 1 }`: retries
- `{ senderId: 1, createdAt: -1 }`: the rate limit

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
| notificationType | enum NotificationType | NN | | what happened; the client words it (D-50) |
| notificationGroup | enum NotificationGroup | NN | | `MEMBER`, `PRODUCT`, `BRIEF` or `ARTICLE` |
| notificationStatus | enum | NN | | `WAIT` (unread) or `READ` |
| notificationTitle | string | NN | | snapshot of what it is about: brief / agent / article title, or a nick (D-50) |
| notificationDesc | string | | | optional (D-18); the start of a comment, ≤ 140 chars (D-50) |
| authorId | ObjectId | NN | FK → members | who triggered it |
| receiverId | ObjectId | NN | FK → members | who receives it |
| productId | ObjectId | | FK → products | **replaces `propertyId`** |
| briefId | ObjectId | | FK → briefs | **new** |
| articleId | ObjectId | | FK → boardArticles | |
| createdAt | date | NN | | |
| updatedAt | date | NN | | |

Indexes (D-50): `{ receiverId: 1, createdAt: -1 }`, `{ receiverId: 1, notificationStatus: 1 }`, `{ notificationType: 1, authorId: 1, receiverId: 1 }`, TTL `{ createdAt: 1 }` after 90 days.

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
| BriefBudgetType | `FIXED`, `OPEN_TO_OFFERS` | GraphQL only, not stored: the brief filter and counts (D-44); `FIXED` = `briefBudget` is set |
| LikeGroup | `MEMBER`, `PRODUCT`, `ARTICLE` | likes.likeGroup |
| ViewGroup | `MEMBER`, `PRODUCT`, `BRIEF`, `ARTICLE` | views.viewGroup |
| CommentGroup | `MEMBER`, `PRODUCT`, `BRIEF`, `ARTICLE` | comments.commentGroup |
| OfferStatus | `PENDING`, `ACCEPTED`, `DECLINED`, `WITHDRAWN`, `EXPIRED` | offers.offerStatus (D-48) |
| OfferCloseReason | `BRIEF_CLOSED` | offers.offerCloseReason (D-48) |
| ConversationReadOnlyReason | `OFFER_CLOSED`, `MEMBER_UNAVAILABLE`, `LOCKED_BY_ADMIN` | GraphQL only, computed (D-49) |
| NotificationGroup | `MEMBER`, `PRODUCT`, `BRIEF`, `ARTICLE` | notifications.notificationGroup (Nestar `PROPERTY` → `PRODUCT`, plus `BRIEF`) |
| NotificationType | `LIKE`, `COMMENT`, `FOLLOW`, `OFFER_RECEIVED`, `OFFER_ACCEPTED`, `OFFER_DECLINED`, `OFFER_WITHDRAWN`, `INVITE` | notifications.notificationType (D-50; `LIKE` unused) |

All other enums (MemberStatus, MemberAuthType, article and notice enums, NotificationStatus) stay as in Nestar.

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
| saves | memberId, briefId | members (USER / CREATOR), briefs | many → many (D-47) |
| offers | briefId, creatorId, userId | briefs, members (CREATOR), members (USER) | one per creator and brief (D-48) |
| invites | briefId, creatorId, userId | briefs, members (CREATOR), members (USER) | one per creator and brief (D-48) |
| conversations | offerId, userId, creatorId | offers, members (USER), members (CREATOR) | one per offer (D-49) |
| messages | conversationId, senderId | conversations, members | many → 1 (D-49) |
| notices | memberId | members (ADMIN) | many → 1 |
| notifications | authorId, receiverId | members | many → 1 |
| notifications | productId / briefId / articleId | products / briefs / boardArticles | optional |

## Business rules (enforced in services/guards, not in the schema)

1. Only `CREATOR` members can create, update or delete Products.
2. Only `USER` members can create, update, close or delete Briefs.
3. `memberEmail` and `memberWhatsapp` are returned only to authenticated requests.
4. `productPrice` follows D-03, `briefBudget` follows D-04, and `briefDeadline` follows D-05 in `docs/decisions.md`.
5. Counters (`memberProducts`, `productLikes`, `briefViews`, …) change only through service methods, never directly from client input.
6. Filter counts (`getProductFacets`, D-43) use the same match rules as `getProducts` over `ACTIVE` products; each group (category, pricing) is counted without its own filter.
7. A brief is past its deadline when `briefDeadline <= now`; it stays `OPEN` (D-44). Brief counts (`getBriefFacets`) follow rule 6 for category, budget type and status; the "open now" badge (`getOpenBriefStats`) counts `OPEN` briefs not past their deadline.
8. Public creator numbers (`getCreators`, `getCreatorFacets`, `getCreatorStats`, D-45) count `ACTIVE` agents through a join; `memberProducts` (`ACTIVE` + `PAUSED`, D-16) is the owner's counter.
9. Community counts (`getArticleFacets`, D-46) use the same match as `getBoardArticles` over `ACTIVE` articles, the topic counted without its own filter. `getCommunityStats` counts every `ACTIVE` article, but only `ACTIVE` members as writers.
10. Saved briefs (D-47): only `USER` and `CREATOR` members save, never their own brief, only a brief `getBrief` can show (`OPEN` or `CLOSED`). `getSavedBriefs` lists `OPEN` and `CLOSED` briefs only. Saves have no counters and are visible to the member who saved only.
11. Offers and invites (D-48): only a `CREATOR` sends an offer, only to an `OPEN` brief, at most 20 in 24 hours; only the brief's owner accepts, declines or invites (20 invites in 24 hours). Several offers of one brief may be `ACCEPTED`. A `PENDING` offer expires 14 days after it was last sent or edited; closing or deleting the brief declines it. An offer is visible to its creator, the brief's owner and an admin; everyone else sees only `briefOffers`.
12. Chat (D-49): only the brief's owner opens a conversation, on a `PENDING` (not expired) or `ACCEPTED` offer; only its two members read it (an admin sees metadata and can lock it, never the messages). It takes messages while the offer is `PENDING` / `ACCEPTED`, both members are `ACTIVE` and it isn't locked. Messages are 1–3000 characters, at most 1 per second per member, idempotent by `clientMessageId`.
13. Notifications (D-50): sent for offers (received, withdrawn → the brief's owner; accepted, declined → the creator), new invites, comments (→ the target's owner) and follows (once per follower), never for one's own action. Only the receiver reads them; an admin has none. Sending never fails the action that caused it. Removed 90 days after creation.
