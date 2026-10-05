# AgentHub — Design Decisions

> One entry per decision: context, decision, reason, consequence.
> Status values: **Accepted** = decided by the project owner; **Proposed** = drafted, waiting for owner review.
> When a decision changes, do not delete it. Mark it **Superseded by D-XX** and add a new entry.

---

## D-01 — Start from a copy of Nestar

**Status:** Accepted

- **Context:** AgentHub needs Nestar-scale features: members, listings, social features and an admin area.
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

**Status:** Accepted

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
