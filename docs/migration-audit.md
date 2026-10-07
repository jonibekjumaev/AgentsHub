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
  - Step 6 changes `property` → `product` in the whitelist.
- [ ] **S3 — Chat leaks member fields (D-19 condition 1, D-07)**
  - **Where:** `api/socket/socket.gateway.ts:15–26` (payload types), `66`, `86` (`info`), `96`, `101` (`message` and history), `72` (`getMessages`)
  - **Fix:** every `memberData` sent to clients is a public object `{ _id, memberNick, memberImage, memberType }`, or `null` for guests. Never send the token payload.
  - **Verify:** connect a guest and a logged-in member. On join, message and leave, the guest receives `memberData` with exactly those four keys: no `memberPhone`, `memberStatus`, counters, `iat` or `exp`.
- [x] **S4 — Chat: member status on connection (D-19 condition 7)**
  - **Where:** `socket.gateway.ts:44–58`; `api/socket/socket.module.ts`
  - **Fix:** after `verifyToken`, load the member from the DB by `_id`. If they're missing or not `ACTIVE`, store `null` (a read-only guest). Build S3's public object from this DB record. Give `SocketModule` access to the `Member` model.
  - **Verify:** connect with a valid token of a member whose status is `BLOCK` → the join `info` shows `memberData: null`, and their messages are refused (S5).
- [x] **S5 — Chat: only authenticated members send (D-19 condition 2)**
  - **Where:** `socket.gateway.ts:93–105`
  - **Fix:** if `clientsAuthMap.get(client)` is `null`, don't store or broadcast. Reply only to the sender with an `error` event.
  - **Verify:** a guest sends `{ "event": "message", "data": "hi" }` → the sender gets `error`, other clients receive nothing, and the history is unchanged.
- [x] **S6 — Chat: message validation (D-19 condition 3)**
  - **Where:** `socket.gateway.ts:94–96`
  - **Fix:** reject payloads that aren't strings. `trim()` the text, and reject it if empty or longer than 500 characters. Store and broadcast the trimmed text.
  - **Verify:**
    - `"   "` → `error`
    - 501 characters → `error`
    - `123` (a number) → `error`
    - `"  hi  "` → broadcast as `"hi"`
- [x] **S7 — Chat: rate limit (D-19 condition 4)**
  - **Where:** `socket.gateway.ts:93–105`
  - **Fix:** keep an in-memory `Map<memberId, lastSentAt>`. A message less than 1000 ms after the member's previous one is rejected with `error`.
  - **Verify:**
    - two messages within 1 s from the same member, even from two different sockets → the second gets `error`, and only the first is broadcast
    - a message after 1 s → accepted
- [x] **S8 — Regex injection in text search**
  - **Where:** `api/components/member/member.service.ts:129,173`; `api/components/board-article/board-article.service.ts:103`
  - **Fix:** escape the user's `text` with a shared `escapeRegex` helper (in `libs/config.ts`) before `new RegExp`.
  - **Verify:**
    - `getAgents` / `getAllMembersByAdmin` / `getBoardArticles` with `text: "("` → a normal (possibly empty) list. Today `new RegExp('(')` throws.
    - `text: "a.b"` matches only the literal `a.b`
  - Step 6 uses the same helper in `property.service.ts:158`.
- [x] **S9 — JWT payload carries the whole member (D-07)**
  - **When:** added during Step 5. It is **not** fixed in Step 2.5. It must be fixed **before D-07 exposes `memberEmail` / `memberWhatsapp`** in GraphQL, i.e. before [Step 9](#step-9--contact-visibility-d-07) starts.
  - **Where:**
    - `api/components/auth/auth.service.ts:21–31` (`createToken` copies every member key except `memberPassword`)
    - its callers `api/components/member/member.service.ts:36` (signup), `:65` (login) and `:83` (`updateMember`)
  - **Problem:** the token holds `memberPhone`, and since Step 5 also `memberEmail` / `memberWhatsapp`, plus every counter. A JWT is only base64-encoded, so anyone who sees the token can read these fields: logs, browser storage, the socket `?token=` URL (D-19). The values also go stale until the next login.
  - **Fix:** the JWT payload contains only `_id`, `memberType` and `memberNick`. It never contains contact fields, the phone, or the full member record. Everything else is loaded from the database.
    - Current readers of token fields: `RolesGuard` (`memberType`), `checkAuth` (`memberNick`), `checkAuthRoles` (whole `authMember`), and the guard/socket logs (`memberNick`). All of them fit the slim payload.
    - Any new code that needs another member field reads it from the DB.
  - **Verify:**
    - decode the `accessToken` from `signup`, `login` and `updateMember` (locally, not on a third-party site) → the claims are exactly `_id`, `memberType`, `memberNick`, `iat` and `exp`
    - `checkAuth`, `checkAuthRoles`, the `@Roles` endpoints and the socket join still work
  - Tokens issued before the fix keep the old payload until they expire (30 days). Rotate `SECRET_TOKEN` when the fix is deployed.
- [x] **S10 — `checkAuthRoles` logs the bearer token**
  - **When:** found while fixing S9.
  - **Where:**
    - `api/components/auth/decorators/authMember.decorator.ts:16` copies the raw `Authorization` header onto `authMember.authorization`
    - `api/components/member/member.resolver.ts:55` (`checkAuthRoles`) prints the whole `authMember` with `console.log`
  - **Problem:** checkAuthRoles logs the raw authorization header (bearer token) to stdout. Anyone who can read the logs can use the token until it expires (30 days).
  - **Fix:** remove it. Delete the `console.log('authMember:', …)` in `checkAuthRoles`. Nothing reads `authMember.authorization`, so also stop the decorator from copying the header onto `authMember`.
  - **Verify:**
    - call `checkAuthRoles` with a valid token → the API's stdout contains no `Bearer` string and no token
    - `checkAuth`, `checkAuthRoles` and the `@AuthMember('_id')` endpoints still work
  - **Fixed:**
    - `authMember.decorator.ts` no longer copies `request.headers.authorization` onto `authMember`. Nothing read it; the guards and `MemberContactResolver` read the header themselves to verify it.
    - `checkAuthRoles` no longer prints `authMember` (only `'Query: checkAuthRole'`).
  - **Checked:** called the `@AuthMember()` factory directly with a fake GraphQL request carrying a test bearer token:
    - `@AuthMember()` and `@AuthMember('memberNick')` still return the member and the nick;
    - the returned member and `req.body.authMember` have no `authorization` key;
    - printing the member shows no token.
  - **Log sweep:** every `console.*` and `Logger` call in `apps/` was checked for tokens, headers and whole member objects; nothing else prints a token or a header. Other findings are listed in the S10 hand-over (not fixed here).

- [x] **S11 — Password changes through member updates are stored unhashed (D-24)**
  - **When:** found after Step 6 part 11, while checking the update DTOs for `null` (B11).
  - **Where:**
    - `api/libs/dto/member/member.update.ts`: `MemberUpdate.memberPassword` and `MemberUpdateByAdmin.memberPassword`
    - `api/components/member/member.service.ts`: `updateMember` (70–85) and `updateMemberByAdmin` (196–202) pass the input to `$set` as it is. Only `signup` hashes the password (`:31`).
  - **Problem:**
    - A password set through an update is stored as **plain text**.
    - The member can't log in any more, because `login` compares with bcrypt against a value that isn't a bcrypt hash.
    - An admin can set any member's password, so the admin knows it.
    - `updateMember` changes the password without asking for the current one, so a stolen token is enough to take over the account.
  - **Fix (D-24, Proposed):**
    - remove `memberPassword` from `MemberUpdate` and `MemberUpdateByAdmin`
    - add `changePassword(currentPassword, newPassword)` for the logged-in member: verify the current password with bcrypt, validate the new one, hash it and save it
    - no admin password setting in the MVP
  - **Data:** check the dev DB for members whose `memberPassword` is not a bcrypt hash. They were set through the old update path and can't log in.
  - **Verify:** see the S11 plan; at minimum:
    - `updateMember` / `updateMemberByAdmin` with `memberPassword` → GraphQL validation error (unknown field)
    - `changePassword` with a wrong current password → error, and the old password still works
    - `changePassword` with the right one → the new password logs in, the old one doesn't, and the DB holds a bcrypt hash
  - **Fixed** (commit `551583b`, together with S14):
    - `memberPassword` removed from `MemberUpdate` and `MemberUpdateByAdmin`.
    - New `changePassword(input: ChangePasswordInput): Boolean!` (`AuthGuard`) → `MemberService.changePassword`. It:
      1. rejects the same password (`SAME_PASSWORD`);
      2. treats a member who isn't `ACTIVE` as not logged in (`NOT_AUTHENTICATED`);
      3. verifies the current password with bcrypt (`WRONG_PASSWORD`);
      4. hashes the new one and saves it with the `ACTIVE` filter.
    - The 5–12 length rule is kept until S13.
  - **Checked:**
    - 9 direct cases with real bcrypt;
    - live introspection: `changePassword` exists, and the update inputs have no `memberPassword`;
    - your Postman smoke tests (wrong, same and correct current password, `BLOCK` member, admin update with `memberPassword`).
- [x] **S12 — Passwords can appear in the request log**
  - **When:** found while planning S11.
  - **Where:** `api/libs/interceptor/logging.interceptor.ts` logs the first 75 characters of every GraphQL request body (`this.stringify(requestContext.req?.body)`, label `REQUEST`).
  - **Problem:**
    - When a mutation has its arguments written inline instead of passed as variables, the password can fall within those 75 characters.
    - Examples: `{"query":"mutation { changePassword(input: {currentPassword: \"…` reaches the value at about character 63, and `login` (`memberPassword`) behaves the same.
    - Anyone who can read the logs can see the password or part of it.
  - **Fix:**
    - Redact the password fields `memberPassword`, `currentPassword` and `newPassword` before logging.
    - Handle both forms: the values in `variables`, and inline values in the `query` string (e.g. replace the value after `memberPassword:` / `currentPassword:` / `newPassword:` with `"***"`).
    - Redact first, then truncate.
  - **Verify:**
    - `login`, `signup` and `changePassword`, each with inline arguments and with variables → the `REQUEST` log line contains `***`, never the password
    - other requests are logged as before
  - **Fixed:**
    - `redactRequestBody()` (`api/libs/utils.ts`) builds a redacted copy of the body; the real `req.body` is not changed.
    - The field list `sensitiveLogFields` is in `api/libs/config.ts`.
    - `LoggingInterceptor` redacts before it truncates.
    - It covers inline string and block-string values in the query, `variables` objects at any depth, scalar variables referenced by a password field (`memberPassword: $p`), and batched (array) bodies.
  - **Checked:**
    - 11 direct cases, including escaped quotes, nested signup variables, unchanged bodies without passwords, and that the original is not mutated.
    - A live `login` with an inline password, an input variable and scalar variables: the `REQUEST` lines show `***` or are cut before the value, and none of the test passwords appear anywhere in the API log.
- [x] **S13 — Password policy is too weak (D-26)**
  - **When:** raised while planning S11.
  - **Where:** `@Length(5, 12)` on `MemberInput.memberPassword` (signup), `LoginInput.memberPassword`, and `ChangePasswordInput.currentPassword` / `newPassword` (S11).
  - **Problem:** 5–12 characters is too weak, and the 12-character maximum blocks passphrases and generated passwords from password managers.
  - **Proposed:**
    - min 8, max 72 characters (the bcrypt limit) for `signup` and `changePassword.newPassword`
    - `login` and `changePassword.currentPassword` keep only a non-empty check, so existing 5–12 character passwords still work
  - **Before implementing:** record the policy as its own decision in `docs/decisions.md` (**Proposed** first). S11 keeps the current 5–12 rule until then.
  - **Verify (after the decision):**
    - signup / `changePassword` with 7 characters → validation error
    - 8 and 72 characters → OK
    - 73 characters → validation error
    - an existing 5-character password still logs in
  - **Decision:** D-26 (Accepted): min **8 characters**, max **72 bytes** (UTF-8, not 72 characters as proposed above: bcrypt's limit is in bytes), no composition rules.
  - **Fixed:**
    - `MemberInput.memberPassword` (signup) and `ChangePasswordInput.newPassword`: `@IsString()` + `@MinLength(passwordMinLength)` + `@IsByteLength(0, passwordMaxBytes)`, with the messages `PASSWORD_TOO_SHORT` / `PASSWORD_TOO_LONG`.
    - `LoginInput.memberPassword` and `ChangePasswordInput.currentPassword`: only `@IsNotEmpty()`.
    - The constants `passwordMinLength = 8` and `passwordMaxBytes = 72` are in `api/libs/config.ts`.
    - No `@Length(5, 12)` is left.
  - **Checked:** 32 direct cases.
    - New passwords: 7 characters and `''` → too short; 8 characters, a passphrase with spaces, 72 ASCII bytes, 36 Cyrillic letters (72 bytes) and 18 emoji (72 bytes) → OK; 73 ASCII bytes, 37 Cyrillic letters and 19 emoji → too long.
    - `login` and `currentPassword`: 1, 5, 13 and 200 characters → OK; `''` → rejected.
- [x] **S14 — `login` and `signup` return the password hash**
  - **When:** found while fixing S12.
  - **Where:** `api/components/member/member.service.ts`
    - `signup`: returns `newMember.toObject()`, which still holds the bcrypt hash that was just saved
    - `login`: loads the member with `.select('+memberPassword')` for the bcrypt check, then returns that same document
  - **Problem:**
    - The hash leaves the service. GraphQL doesn't send it to the client, because `Member` has no `memberPassword` field.
    - But the `RESPONSE` log (`LoggingInterceptor`) stringifies the resolver result, and today only the 75-character cut keeps the hash out of the log.
    - Any other code that receives the returned object would see the hash too.
  - **Fix:** the hash must never leave the service; don't rely on log truncation.
    - `login`: after the bcrypt check, return a plain object with `memberPassword` removed.
    - `signup`: remove `memberPassword` from the object after `create`.
    - Other member reads don't select the field (`select: false` in the schema). `changePassword` loads it but returns only `true`.
  - **Verify:**
    - the objects returned by `login` and `signup` have no `memberPassword` key, but still have `accessToken` and the other fields
    - login with a wrong password is still rejected
  - **Fixed:**
    - Both methods return `toObject()` with `delete result.memberPassword` before the token is created.
    - `login` used to return the Mongoose document itself (with the hash loaded); it now returns the plain object, like `signup`. The GraphQL output is unchanged.
  - **Checked:** with real Mongoose documents built from `Member.model.ts` (no DB):
    - the `signup` and `login` results have no `memberPassword` key and no `$2…` hash in their JSON, but still have `accessToken` and `memberNick`;
    - the stored document keeps the hash, so login still works;
    - a wrong password → `WRONG_PASSWORD`.

- [x] **S15 — GraphQL error logs echo input values, including passwords (fix first)**
  - **When:** found in the S10 log sweep; **confirmed live**.
  - **Where:** `api/app.module.ts`, `formatError`:
    - `console.log('GRAPHQL GLOBAL ERR:', error)` (24) prints the raw error;
    - `console.log('GRAPHQL GLOBAL ERR:', graphQLFormattedError)` (35) prints the formatted one.
  - **Problem:**
    - When a GraphQL variable has a missing or unknown field, graphql-js writes the **whole input object** into the error message (`BAD_USER_INPUT`), e.g. `Variable "$i" got invalid value { memberPassword: "…" }; Field "memberNick" … was not provided.`
    - Both log lines print that message, so the plain-text password is logged twice.
    - Live probes:
      - `login` via variables without `memberNick`;
      - `updateMember` with `memberPassword` in variables (what an old frontend sends after S11).

      Both test passwords appeared twice in the API log. A wrong-typed field echoes only its own value.
  - **Fix:** redact the `sensitiveLogFields` values in error messages before they are logged (reusing the S12 redaction), or log only the code and path for `BAD_USER_INPUT`.
  - **Verify:** repeat the live probes → the test passwords appear nowhere in the API log; other errors are still logged usefully.
  - **Fixed:**
    - New `redactSensitiveText()` (`api/libs/utils.ts`). It replaces the value after any `sensitiveLogFields` key with `"***"` in graphql-js text (`memberPassword: "…"`), JSON (`"memberPassword":"…"`) and GraphQL block strings, including escaped quotes. S12's `redactRequestBody` now uses it for the query text, so there is one redaction rule.
    - `sensitiveLogFields` now also contains `accessToken`.
    - `formatError` redacts the message, each entry if it's an array. The **redacted message is also what the client gets.**
    - The two raw log lines are replaced by one: `GRAPHQL ERROR [<code>] <path>: <message>`.
    - Unexpected errors (not a Nest `HttpException` or a `GraphQLError`, found with Apollo's `unwrapResolverError`) also log their stack, redacted.
  - **Checked:**
    - 13 direct cases for `redactSensitiveText` (graphql-js form, nested input, two fields, escaped quotes, the JSON form, `accessToken`, block strings, a stack, and three texts without secrets that stay unchanged) plus `accessToken` in request variables. The 11 S12 cases still pass after the switch.
    - Live: `login` without `memberNick`, `updateMember` with `memberPassword`, and an input carrying `accessToken`, all via variables → the client and the log show `"***"`. A `login` with an unknown nick and an inline `signup` with a bad phone are logged with their code and path. None of the 6 test secrets appear anywhere in the API log.
- [x] **S16 — The `RESPONSE` log prints response bodies; only truncation keeps secrets out**
  - **When:** found in the S10 log sweep.
  - **Where:** `api/libs/interceptor/logging.interceptor.ts`: `this.logger.log(`${this.stringify(data)} - …ms`, 'RESPONSE')` logs the first 75 characters of every resolver result.
  - **Problem:**
    - Secrets are in the response objects, and only the 75-character cut keeps them out of the log:
      - the new `accessToken` (the last key) in `login`, `signup` and `updateMember`;
      - the `memberPassword` hash in `memberData` (see the `$lookup` point below).
    - Raising the limit, or a differently shaped result, would log them.
    - S14 fixed this for `login` / `signup` only; the policy itself is the root cause.
  - **Fix (policy change):** the `RESPONSE` log records only the **operation name, duration and success/error**, never the body.
  - **Fix (separately, data minimisation):** add a `$project` that excludes `memberPassword` to the member `$lookup`s in `api/libs/config.ts`: `lookupMember`, `lookupFavorite`, `lookupVisit`, `lookupFollowingData` and `lookupFollowerData`.
    - `select: false` in `Member.model.ts` only applies to `find`, not to `aggregate`, so these lookups return the hash today.
    - GraphQL drops the field from responses, but the hash still travels through the resolvers and the interceptor.
  - **Verify:**
    - `login`, `signup`, `updateMember` and a product list → the `RESPONSE` lines show only the operation name, duration and status, with no token, hash or data;
    - after the `$project`, the `memberData` objects from the lookups have no `memberPassword` key;
    - the GraphQL responses are unchanged.
  - **Fixed:**
    - `LoggingInterceptor` logs `RESPONSE` as `<Query|Mutation> <fieldName> - <ms>ms - success|error`, never the body. The name comes from the resolver info, not the client's optional `operationName`. Errors now get a line too (before, only successful results were logged). The `REQUEST` line and its redaction (S12) are unchanged.
    - New shared stage `excludeMemberSecrets` (`{ $project: { memberPassword: 0 } }`) in `api/libs/config.ts`.
      - The five member `$lookup`s (`lookupMember`, `lookupFollowingData`, `lookupFollowerData`, `lookupFavorite`, `lookupVisit`) use it as their `pipeline`, in the `localField`/`foreignField` + `pipeline` form (MongoDB 5.0+).
      - Two aggregations that run on `members` directly had the same leak and were not in the original list: `getCreators` and `getAllMembersByAdmin` (`api/components/member/member.service.ts`). Both now run the stage right after `$match`.
    - `memberPassword` has no `@Field`, so the GraphQL schema and responses are unchanged (not a breaking change).

### Other bugs in surviving code
- [x] **B1 — `MembersInquiry.search` type**
  - **Where:** `api/libs/dto/member/member.input.ts:123–124`
  - **Fix:** `@Field(() => MISearch)` instead of `AISearch`.
  - **Verify:**
    - the generated GraphQL schema shows `MembersInquiry.search: MISearch!`
    - `getAllMembersByAdmin(input: { page: 1, limit: 10, search: { memberType: USER } })` still works
- [x] **B2 — `memberImage: null` breaks reads (D-15)**
  - **Where:** `api/libs/dto/member/member.update.ts:27–29` (`MemberUpdate`), `:75–77` (`MemberUpdateByAdmin`)
  - **Fix:** reject `null` for `memberImage`, e.g. `@ValidateIf((o) => o.memberImage !== undefined)` + `@IsString()`. Removing an image sends `''`.
  - **Verify:**
    - `updateMember(input: { memberImage: null })` → validation error
    - `{ memberImage: "" }` → OK
    - `getMember` afterwards returns a string, not a non-null GraphQL error
- [x] **B3 — Like schema uses the wrong enum**
  - **Where:** `api/schemas/Like.model.ts:2,8`
  - **Fix:** import and use `LikeGroup` instead of `ViewGroup`.
  - **Verify:**
    - `LikeSchema.path('likeGroup').enumValues` equals `Object.values(LikeGroup)`
    - `likeTargetMember` and `likeTargetBoardArticle` still work

    The values are identical today; they diverge in step 4, when `ViewGroup` gains `BRIEF`.
- [x] **B4 — Favorites list includes deleted items (D-16)**
  - **Where:** `api/components/like/like.service.ts:62`
  - **Fix:** add `{ $match: { 'favoriteProperty.propertyStatus': PropertyStatus.ACTIVE } }` after the `$unwind` and **before** `$facet`.
  - **Verify:** like a property, then set it to `DELETE` with `updateProperty` → `getFavorities` no longer lists it, and `metaCounter[0].total` drops by 1.
  - Step 8 renames this to `favoriteProduct.productStatus`. With `PAUSED`, the same filter also hides paused products.
- [x] **B5 — Visited list includes deleted items (D-16)**
  - **Where:** `api/components/view/view.service.ts:46`
  - **Fix:** add a `'visitedProperty.propertyStatus': ACTIVE` match after the `$unwind` and before `$facet`.
  - **Verify:** view a property, then delete it → `getVisited` no longer lists it, and the total drops by 1.
  - Step 8 renames it to `visitedProduct.productStatus`.
- [x] **B6 — Member comment counter goes to the author**
  - **Where:** `api/components/comment/comment.service.ts:50–55`
  - **Fix:** increment `memberComments` on `input.commentRefId` (the member commented on), not on the author's `memberId`.
  - **Verify:** member A comments on member B's profile → B's `memberComments` +1, and A's is unchanged.
- [x] **B7 — `createComment` doesn't check the target**
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
- [x] **B8 — Board article `meLiked` is always empty**
  - **Where:** `api/components/board-article/board-article.service.ts:119`
  - **Fix:** `lookupAuthMemberLiked(memberId)` (the default `'$_id'`), not `'$followingId'`.
  - **Verify:** like an article, then call `getBoardArticles` as the same member → that article has `meLiked[0].myFavorite: true`.
- [x] **B9 — Self-engagement on member profiles (D-22)**
  - **Where:** `api/components/member/member.service.ts:99–106` (`getMember`), `:148–160` (`likeTargetMember`)
  - **Fix:** don't record a view when `memberId` equals `targetId`. Reject a self-like with `Message.NOT_ALLOWED_REQUEST`.
  - **Verify:**
    - A calls `getMember(A)` → `memberViews` unchanged
    - A calls `likeTargetMember(A)` → error, `memberLikes` unchanged
    - B viewing or liking A still counts
  - The product half (own product views and likes) is rewritten code, so it is fixed in Step 6.
- [x] **B10 — `updateMember` ignores its `memberStatus` filter**
  - **When:** found after Step 6 part 11.
  - **Where:** `api/components/member/member.service.ts:71–77`: `findByIdAndUpdate({ _id: memberId, memberStatus: MemberStatus.ACTIVE }, …)`
  - **Problem:**
    - An object is passed as the id. Mongoose casts it to its `_id` and drops `memberStatus: ACTIVE`. This is the same mistake as `removePropertyByAdmin`, fixed in Step 6 part 1.
    - The route guards accept any valid token (D-23), so a `BLOCK` or `DELETE` member with an unexpired token can still update their profile.
  - **Fix:** `findOneAndUpdate({ _id: memberId, memberStatus: MemberStatus.ACTIVE }, { $set: input }, { new: true })`.
  - **Verify:**
    - set a member to `BLOCK` in Compass, then call `updateMember` with their token → `UPDATE_FAILED`, and nothing changed
    - set them back to `ACTIVE` → the update works
  - **Fixed:** `findOneAndUpdate({ _id: memberId, memberStatus: MemberStatus.ACTIVE }, { $set: input }, { new: true })`. No other call in `apps/` passes an object as an id.
  - **Checked:**
    - Mongoose's own query cast (8.24.3, no DB): the old call's filter becomes `{ _id }`, which confirms the dropped status; the new one keeps `{ _id, memberStatus: "ACTIVE" }`.
    - `updateMember` with the real model building the query: `ACTIVE` → updated with a new `accessToken`; `BLOCK` / `DELETE` → `UPDATE_FAILED`.
- [x] **B11 — `@IsOptional()` lets `null` through to `$set` on required fields**
  - **When:** found after Step 6 part 11; `ProductUpdate.productTitle` was fixed on its own first.
  - **Problem:**
    - `@IsOptional()` skips every validator when the value is `null`.
    - The services pass the input to `findOneAndUpdate` / `findByIdAndUpdate`, which don't run schema validators, so `null` is stored even on required fields.
    - On `*Status` fields, `null` hides the document from every `ACTIVE` query, and the owner can't update it again, because the update matches `ACTIVE`.
  - **Where:**

    | DTO | Field | Schema |
    |---|---|---|
    | `MemberUpdate`, `MemberUpdateByAdmin` | `memberNick` | required, unique |
    | | `memberPhone` | required, unique |
    | `MemberUpdateByAdmin` | `memberStatus` | enum, default `ACTIVE` |
    | `BoardArticleUpdate` | `articleTitle`, `articleContent` | required |
    | | `articleStatus` | enum, default `ACTIVE` |
    | `CommentUpdate` | `commentContent` | required |
    | | `commentStatus` | enum, default `ACTIVE` |
    | `ProductUpdate` | `productStatus` | enum, default `ACTIVE` (`@IsIn` is skipped for `null`) |

    `memberPassword` is left out: S11 removes it from the update inputs.
  - **Correctly nullable, no change:**
    - `memberFullName` and `memberDesc`
    - `memberEmail` and `memberWhatsapp` (`null` removes the contact)
    - `articleImage` and `productDemoUrl`
    - ~~`productPrice`, which may be `null` for `FREE` / `CUSTOM` under D-03 (Step 6 part 12)~~ **Corrected:** until part 12, `productPrice` is still `required` in the schema and `Float!` in the output, so a stored `null` breaks every read of that product. It was added to the fix (see below).
  - **Fix:** the D-15 / B2 pattern for every field in the table: `@ValidateIf((o) => o.<field> !== undefined)` plus a type check (`@IsString()` or `@IsEnum(...)`), keeping the existing length and `@IsIn` rules.
  - **Verify:** for each field, `null` → validation error; leaving the field out → still works; a valid value → still works.
  - **Fixed:** `@IsOptional()` → `@ValidateIf((o) => o.<field> !== undefined)` with `@IsString()` (keeping the existing `@Length`) or `@IsEnum(...)`, for every field in the table, plus:
    - `ProductUpdate.productStatus`: `@ValidateIf` + the existing temporary `@IsIn([ACTIVE, DELETE])`. `@IsIn` itself rejects `null`, so no `@IsEnum` is needed while it exists (see the D-16 item in Step 6).
    - `ProductUpdate.productPrice`: `@ValidateIf` + `@IsNumber()`, so `null` is rejected **until part 12**, where D-03 replaces the rule (`null` for `FREE` / `CUSTOM`).
    - `BoardArticleUpdate` also covers `updateBoardArticleByAdmin`.
    - The optional fields above keep `@IsOptional()`, so `null` still clears them.
  - **Checked:** 29 direct validation cases.
    - All 12 changed fields: `null` → error, left out → OK, valid value → OK.
    - All 10 kept fields still accept `null`.
    - The existing rules still hold: `PAUSED` is rejected by the temporary guard; `memberNick` too short; `articleTitle` too long; `''` comment; an unknown `memberStatus`; a string price; `memberImage: null` (B2).
  - **API:** the GraphQL schema is unchanged. Clients that send `null` for fields they don't want to change must leave them out instead (Step 12 table).
- [x] **B12 — `memberPhone` has no format validation (D-25)**
  - **When:** found after Step 6 part 11.
  - **Where:**
    - `api/libs/dto/member/member.input.ts` (`MemberInput`, signup): only `@IsNotEmpty()`
    - `member.update.ts` (`MemberUpdate`, `MemberUpdateByAdmin`): only `@IsOptional()`
  - **Problem:**
    - Any string is accepted as a phone number, and `''` is accepted on update.
    - The field is required and unique (`Member.model.ts:24–28`), so junk values also take up the unique slot.
  - **Fix:** one phone rule shared by signup and both updates (e.g. E.164 like `whatsappNumberRegex`, with its own `Message`).
    - Choosing the format is a decision: record it in `docs/decisions.md` first.
    - Existing members with an invalid phone are only checked on their next update.
  - **Verify:** signup and update with `''`, letters, or a too-short or too-long number → validation error; a valid number → OK.
  - **Decision:** D-25 (Accepted): E.164, the same rule as `memberWhatsapp`. Options A (Korean `010…`) and C (no format) were rejected.
  - **Fixed:**
    - `whatsappNumberRegex` was **renamed to `e164PhoneRegex`** (`api/libs/config.ts`). It is the one shared rule for `memberPhone` and `memberWhatsapp`; the old name is gone from `apps/`.
    - `memberPhone` gets `@Matches(e164PhoneRegex, { message: Message.INVALID_PHONE })` in `MemberInput` (signup), `MemberUpdate` and `MemberUpdateByAdmin`.
    - New message `INVALID_PHONE`; `memberWhatsapp` keeps `INVALID_WHATSAPP`.
    - The update inputs keep the B11 `@ValidateIf` + `@IsString()`, so `null` is still rejected.
  - **Checked:** 45 direct cases.
    - 13 phone values in each of the 3 inputs: valid `+998…`, `+8210…`, `+1…`, and the 8- and 15-digit limits; rejected: `010…` without `+`, 7 and 16 digits, a country code starting with 0, spaces, dashes, `''` and letters.
    - Signup without a phone is still required; `null` on update is still rejected; leaving the phone out of an update is OK.
    - `memberWhatsapp` still validates with the same rule and its own message, and `null` still clears it.
  - **Data:** existing dev members with `010…` numbers keep working (login uses the nick). They must send E.164 the next time they update their phone (D-25).
- [x] **B13 — Debug and error logs print data they shouldn't**
  - **When:** found in the S10 log sweep.
  - **Where and problem:**
    - `api/components/like/like.service.ts:79`: `console.log('data:', data)` is a leftover debug line that prints the favorites aggregation. Node's default print depth hides `memberData` as `[Object]` today, so it's fragile, not leaking.
    - `api/components/member/member.service.ts:48` (`signup`), and the same `'Error: Service.model'` pattern in other services: they log the raw Mongo error message. A duplicate-key error (`E11000 … dup key: { memberPhone: "+998…" }`) includes the duplicated value (phone, nick) in the log.
  - **Fix:**
    - remove the debug `console.log` in `like.service.ts`;
    - log duplicate-key errors without the key values (e.g. the error code and the index name only).
  - **Verify:**
    - `getFavorities` → no `data:` line;
    - signup with an existing phone → the log line names the duplicate index, not the phone number; the client still gets `USED_MEMBER_NICK_OR_PHONE`.
  - **Fixed:**
    - Removed 7 debug logs in services: `console.log('data:', data)` in `like.service.ts`, and the `console.log('match:', match)` lines, which print filters built from client input, in `board-article.service.ts`, `follow.service.ts` (×2), `member.service.ts` (×2: `getCreators`, `getAllMembersByAdmin`) and `product.service.ts`. Service logs without data (`- Like modifier N -`, `memberStatsEditor: executed`, `- New View Insert -`) stay.
    - New helpers in `api/libs/utils.ts`:
      - `redactDuplicateKey()` replaces everything after `dup key: {` up to the end of the line with `***`. The collection and index names (e.g. `agentsHub.members index: memberPhone_1`) stay, so the log still names the field.
      - `describeDbError()` is the old `err instanceof Error ? …` message with that redaction applied.
    - The 6 `'Error: Service.model'` catch blocks (member `signup`, product, like, follow, board-article and comment creates) log `describeDbError(err)`. The thrown `Message.*` is unchanged.
    - E11000 errors that are not caught (`updateMember`, `updateMemberByAdmin`, `updateProduct`, `updateProductByAdmin`, and a `recordView` race) reach `formatError`. Its `GRAPHQL ERROR` line and stack line now apply `redactDuplicateKey`. The message returned to the client is unchanged; that leak is tracked in B15.
    - No GraphQL response changes.
- [x] **B14 — `ValidationPipe` messages never reach the client**
  - **When:** found while verifying S15.
  - **Where:** `api/app.module.ts`, `formatError`. It reads the message from `extensions.exception.response.message` or `extensions.response.message`, the shape older Nest versions used.
  - **Problem:**
    - In `@nestjs/apollo` 12 the details of a Nest `HttpException` are in **`extensions.originalError`** (`{ message, error, statusCode }`), so those reads never match.
    - Exceptions with a string message still arrive, because Nest copies that string into the error message.
    - But `ValidationPipe` puts its messages (an **array**) only in `originalError.message`, so the client gets just `"Bad Request Exception"`.
    - Every class-validator message is lost this way, e.g. `INVALID_PHONE`, `PASSWORD_TOO_SHORT` and the `productDesc` length.
  - **Fix:** read `extensions.originalError.message` first. The S15 redaction still applies to the result (string or array). Update `FormattedErrorExtensions` to the real shape.
  - **Verify:** live, check the actual response text:
    - signup with a bad phone → `INVALID_PHONE`;
    - signup with a 7-character password → `PASSWORD_TOO_SHORT`;
    - `createProduct` with a too-short `productDesc` → the class-validator length message;
    - a string-message exception (`NO_MEMBER_NICK`) is unchanged.
  - **Fixed:**
    - `formatError` reads `extensions.originalError?.message || formattedError.message`; the S15 redaction still applies.
    - `FormattedErrorExtensions` now describes the real `@nestjs/apollo` 12 shape (`originalError`, `status`); the old `exception` / `response` fields are gone.
  - **Checked live** (requests that fail validation, so nothing is written; `createProduct` with a CREATOR token signed by a throwaway `SECRET_TOKEN` that only the test process used). The response text:
    - bad phone → `INVALID_PHONE`; 7 characters → `PASSWORD_TOO_SHORT`; 73 bytes → `PASSWORD_TOO_LONG`; both errors → both messages;
    - `productDesc` of 19 / 3001 characters → the length messages;
    - `NO_MEMBER_NICK` and `TOKEN_NOT_EXIST` are unchanged;
    - the log line shows the same messages, with no test password.
  - **Response shape (decided):** the GraphQL spec defines `message` as a string.
    - For `ValidationPipe` errors, the messages are **joined with `"; "`** into `message`, and the original array goes to **`extensions.validationErrors`**, so the frontend can show them per field.
    - Both are redacted (S15).
    - Other errors have no `validationErrors`.
    - Rechecked live: 9 cases. The 6 validation cases above have a string `message` and the matching `validationErrors` (the two-error case gives `"…characters!; Phone number…"` and both entries). A Nest string exception, a guard exception and a graphql-js `BAD_USER_INPUT` (still redacted) have no `validationErrors`. No test secret appears in the log.
- [x] **B15 — Business errors are thrown as `InternalServerErrorException`**
  - **When:** found while verifying S15.
  - **Problem:** user mistakes such as an unknown nick or a wrong password are thrown as `InternalServerErrorException`, so the client gets `INTERNAL_SERVER_ERROR`. It can't tell a user error from a server fault, and monitoring counts every wrong password as a 500.
  - **Important, check first:** `@nestjs/apollo` 12 maps only 400 → `BAD_REQUEST`, 401 → `UNAUTHENTICATED`, 403 → `FORBIDDEN` and 422 → `BAD_USER_INPUT`. **Any other status, including 404 `NotFoundException`, still becomes `INTERNAL_SERVER_ERROR`**, with the real status in `extensions.status`, which our `formatError` drops. So the fix must also make `formatError` turn `extensions.status` 404 into a `NOT_FOUND` code (or keep `status`). Otherwise the 404 changes below are invisible to clients.
  - **Proposed classes** (paths under `api/components/`, lines as of commit `f18162e`):

    | Where | Message | Today | Proposed | Why |
    |---|---|---|---|---|
    | `member/member.service.ts:59` (login: nick missing or `DELETE`) | `NO_MEMBER_NICK` | 500 | **Unauthorized** | failed login |
    | `member/member.service.ts:65` (login: no stored password) | `NO_MEMBER_NICK` | 500 | **Unauthorized** | failed login |
    | `member/member.service.ts:69` (login) | `WRONG_PASSWORD` | 500 | **Unauthorized** | failed login |
    | `member/member.service.ts:61` (login) | `BLOCKED_USER` | 500 | **Forbidden** | known member, not allowed in |
    | `member/member.service.ts:84` (`updateMember`: caller not `ACTIVE`, B10) | `UPDATE_FAILED` | 500 | **Unauthorized** (`NOT_AUTHENTICATED`) | same rule as `changePassword` (D-23) |
    | `follow/follow.service.ts:25` (`subscribe` to yourself) | `SELF_SUBSCRIPTION_DENIED` | 500 | **BadRequest** | invalid request, like the D-22 self-like checks |
    | `follow/follow.resolver.ts:41, 54`, `follow/follow.service.ts:72, 104` (no member id in the search) | `BAD_REQUEST` | 500 | **BadRequest** | missing input |
    | `comment/comment.service.ts:74` (`commentRefId` not an ObjectId) | `NO_DATA_FOUND` | 500 | **BadRequest** | malformed input |
    | `product/product.service.ts:159` (`getCreatorProducts` asks for `DELETE`) | `NO_DATA_FOUND` | 500 | **BadRequest** | invalid filter |
    | `product/product.service.ts:61` (`getProduct`), `board-article/board-article.service.ts:58` (`getBoardArticle`), `member/member.service.ts:121` (`getMember`) | `NO_DATA_FOUND` | 500 | **NotFound** | target missing or not visible |
    | `product/product.service.ts:191`, `board-article/board-article.service.ts:138`, `member/member.service.ts:177` (like target) | `NO_DATA_FOUND` | 500 | **NotFound** | target missing or not `ACTIVE` |
    | `comment/comment.service.ts:90` (comment target) | `NO_DATA_FOUND` | 500 | **NotFound** | target missing or not `ACTIVE` |
    | `follow/follow.service.ts:62` (`unsubscribe`, not following) | `NO_DATA_FOUND` | 500 | **NotFound** | nothing to remove |
    | `product/product.service.ts:95`, `board-article/board-article.service.ts:84`, `comment/comment.service.ts:108` (owner updates) | `UPDATE_FAILED` | 500 | **NotFound** | missing, not yours, or not `ACTIVE`. Deliberately not Forbidden, so other members' items aren't revealed |
    | `product/product.service.ts:247`, `board-article/board-article.service.ts:192`, `member/member.service.ts:223` (admin updates) | `UPDATE_FAILED` | 500 | **NotFound** | target missing or not in an updatable status |
    | `product/product.service.ts:267`, `board-article/board-article.service.ts:210`, `comment/comment.service.ts:141` (admin removes) | `REMOVE_FAILED` | 500 | **NotFound** | no removable item with that id |

  - **Keep as `InternalServerErrorException`** (real server faults, or unreachable):
    - **Create `catch` blocks** (database errors): `board-article/board-article.service.ts:47`, `comment/comment.service.ts:42`.
    - **Stats editors and like-toggle results**, whose target was already checked: `product/product.service.ts:204, 283`, `board-article/board-article.service.ts:154, 221`, `member/member.service.ts:189, 241`.
    - **Upload write failures:** `member/member.resolver.ts:164, 203, 214`. A file over the size limit is a user error, but it arrives as a stream error; a 413-style code can be added later.
    - **`changePassword` `UPDATE_FAILED`** (`member/member.service.ts:107`): only possible in a race.
    - **Unreachable**, because `$facet` always returns exactly one document: `!result.length` / `!result` in `product/product.service.ts:134, 185, 232`, `board-article/board-article.service.ts:129, 181`, `member/member.service.ts:170, 216`, `follow/follow.service.ts:97, 130` and `comment/comment.service.ts:135`. Also `follow/follow.service.ts:29, 54`: `getMember` throws before these checks run. Keep them as 500 guards, or remove them in a cleanup.
  - **Already correct:** the auth guards (400 / 401 / 403); `changePassword` (400 / 401); the D-22 self-like checks and the duplicate like/follow/product creates (400); the uploader format and target checks (400); `signup` duplicates (400).
  - **Login messages:** with the proposed classes, `NO_MEMBER_NICK` vs `WRONG_PASSWORD` still tells anyone whether a nick exists (user enumeration). One generic message for both is a separate decision; record it before changing the messages. **Decided in D-27, done in Part 3.**
  - **Duplicate keys in updates (added in B13):** update methods without a catch (`updateMember`, `updateMemberByAdmin`, `updateProduct`, `updateProductByAdmin`) return the raw E11000 message to the client. Map duplicate-key errors to `USED_MEMBER_NICK_OR_PHONE` / a product title message. Since B13 the log redacts the value, but the client message still contains it.
  - **Side note:** `removeBoardArticleByAdmin` (`board-article/board-article.service.ts:203–210`) hard-deletes an article that is still `ACTIVE`, while `removeProductByAdmin` only removes items already set to `DELETE` (Step 6 part 1). Decide which rule is intended before changing either. **Decided in D-28 (option A), done in Part 4.**
  - **Split into 4 parts, one commit each:** 1. exception classes and status codes; 2. duplicate keys → `CONFLICT`; 3. login enumeration (D-27); 4. `removeBoardArticleByAdmin` rule (D-28).
  - **Part 1 done:**
    - Every case in the table above now throws the proposed class, with its message unchanged. The one exception is `updateMember` for a caller who isn't `ACTIVE`: it now throws `UnauthorizedException(NOT_AUTHENTICATED)` instead of `UPDATE_FAILED`. The login throws are left for Part 3; the "keep as 500" list is unchanged.
    - `formatError` turns `extensions.status` 404 into `NOT_FOUND` and 409 into `CONFLICT`. Other statuses are unchanged.
    - Guards: a missing token (`TOKEN_NOT_EXIST`) in `auth.guard.ts` and `roles.guard.ts` now throws 401 (`UNAUTHENTICATED`) instead of 400. The message is unchanged.
    - The client-visible codes are in the Step 12 table.
  - **Part 2 done:**
    - New helper `isDuplicateKeyError()` (`api/libs/utils.ts`) checks `code === 11000`, without importing the `mongodb` driver.
    - `updateMember`, `updateMemberByAdmin`, `updateProduct` and `updateProductByAdmin` catch errors from the update. A duplicate key throws `ConflictException` (`USED_MEMBER_NICK_OR_PHONE` for members, the new `USED_PRODUCT_TITLE` for products); any other error is rethrown unchanged (still `INTERNAL_SERVER_ERROR`, logged redacted since B13).
    - `createProduct` and `signup` keep their catch blocks. A duplicate key now throws `ConflictException` (`USED_PRODUCT_TITLE` / `USED_MEMBER_NICK_OR_PHONE`); other errors keep the old 400 (`CREATE_FAILED` / `USED_MEMBER_NICK_OR_PHONE`).
    - Every duplicate-key case now returns `CONFLICT`, and no raw E11000 message reaches the client.
    - The client-visible changes are in the Step 12 table.
  - **Part 3 done (D-27):**
    - `login`: an unknown nick, a `DELETE` member, no stored password and a wrong password all throw `UnauthorizedException(INVALID_CREDENTIALS)`. `BLOCK` is checked only after the password matches → `ForbiddenException(BLOCKED_USER)`.
    - Timing: `login` always runs one bcrypt compare, against `dummyPasswordHash` (`api/libs/config.ts`, cost 10) when there is no usable stored hash.
    - `NO_MEMBER_NICK` removed from `Message`; `WRONG_PASSWORD` stays for `changePassword`.
    - The client-visible changes are in the Step 12 table.
  - **Part 4 done (D-28, option A):**
    - `removeBoardArticleByAdmin` removes only articles with `articleStatus: DELETE`, the same rule as `removeProductByAdmin`. An `ACTIVE` article → `NotFoundException(REMOVE_FAILED)`.
    - No counter change in the remove: `memberArticles` is already decremented when the owner or an admin sets the article to `DELETE`. This also fixes the old drift, where an `ACTIVE` article removed in one step left the author's `memberArticles` one too high.
    - Orphaned comments and likes after a hard delete (articles and products) are not part of this change.
    - The client-visible change is in the Step 12 table.
  - **Verify (after the fix):** each listed case returns the proposed code (`BAD_REQUEST`, `UNAUTHENTICATED`, `FORBIDDEN` or `NOT_FOUND`) with its message, and real server faults still return `INTERNAL_SERVER_ERROR`.

- [ ] **B16 — Nested `search` inputs are never validated**
  - **When:** found in Step 6 part 13.
  - **Where:** every `*Inquiry` with a nested `search` object outside products: `BoardArticlesInquiry` (`BAISearch`), `AllBoardArticlesInquiry` (`ABAISearch`), `CommentsInquiry` (`CISearch`), `FollowInquiry` (`FollowSearch`), `CreatorsInquiry` (`CRISearch`) and `MembersInquiry` (`MISearch`).
  - **Problem:** the `search` fields have only `@IsNotEmpty()`. Without `@ValidateNested()` and `@Type(() => …)`, class-validator never checks the rules inside `search`. Checked with the real `ValidationPipe`: a 500-character `search.text` passed although it has `@MaxLength(100)`. So `searchTextMaxLength` and the enum checks in these search types are not enforced today.
  - **Fix:** add `@ValidateNested()` + `@Type(() => <SearchType>)` to each `search` field, as the three product inquiries got in Step 6 part 13.
  - **Verify:** a 101-character `search.text` in `getBoardArticles`, `getComments`, `getCreators` and `getAllMembersByAdmin` → `BAD_REQUEST`; valid searches still work.

---

## Step 3 — Config (package names, DB name, env, app names)

### Package and scripts — `package.json`
- [x] `"name": "nestar"` → `agentshub` (line 2). `package-lock.json` lines 2 and 8 regenerate with `npm install`.
- [x] `start:prod` runs `dist/apps/nestar/main`, but the app is `nestar-api` (line 15). Fix the path, and rename it again if the app folder is renamed.
- [x] `start:dev:batch` / `start:prod:batch` refer to `nestar-batch` (lines 13 and 16).
- [x] `test:e2e` points to `./test/jest-e2e.json`, which does not exist (line 22). The configs are `apps/*/test/jest-e2e.json`.
- [x] `format` / `lint` globs include `libs/**` and `test/**`, which don't exist at the root (lines 10 and 17). Harmless; clean up optionally.
- [ ] Empty `description` / `author` fields (lines 4–5).

### Monorepo app names — `nest-cli.json`
- [x] Rename the apps `nestar-api` / `nestar-batch` → `agentshub-api` / `agentshub-batch`, before any domain change (D-12, Accepted). This affects:
  - `nest-cli.json` (`sourceRoot`, `root`, `projects.*`, `tsConfigPath`; lines 4, 8, 11, 13–29)
  - `apps/nestar-api/tsconfig.app.json` line 5 and `apps/nestar-batch/tsconfig.app.json` line 5 (`outDir`)
  - every `../../nestar-api/src/...` import in the batch app (see Step 10)
  - the `package.json` scripts above
  - the folder names in `CLAUDE.md`
  - the existing `dist/apps/nestar-*` build output (delete and rebuild)

### Database and environment — `.env` (gitignored)
- [x] `MONGODB_DEV` and `MONGODB_PROD` both point to the database **`Nestar`**. Point `MONGODB_DEV` to a new, empty database **`agentsHub`**, so the original Nestar data stays untouched (D-01, D-13).
- [x] `MONGODB_PROD`: the production database name is decided at deploy time (D-13). Until then, it must not point to `Nestar`.
- [ ] No Nestar data is migrated (D-13, Accepted). Write a seed script (creators, users, products, briefs) for development.
- [x] No `.env.example` exists. Add one listing `PORT_API`, `PORT_BATCH`, `MONGODB_DEV`, `MONGODB_PROD` and `SECRET_TOKEN`.
- [x] Both `api/database/database.module.ts` and `batch/database/database.module.ts` (line 9) pick the URI by `NODE_ENV`. No change needed; keep them in sync.

### Branding strings
- [x] `api/app.service.ts:6`: `'Hello to Nestar API server!'`
- [x] `batch/batch.service.ts:74`: `'Hello to Nestar BATCH server!'`
- [x] `README.md`: stock NestJS README. Replace it with an AgentsHub README.
- [x] `AGENTS.md` and `SKILLS.md` call the project **"Petoria"**. Correct them to AgentsHub.
- [x] `CLAUDE.md`: update the app names and paths after the rename. Also remove the "Known issues" entries once they are fixed.

### Uploads
- Moved to Step 6 (Uploads). Step 3 is naming and config only and must not change behaviour.

---

## Step 4 — Enums (`api/libs/enums/`)

- [x] `member.enum.ts:5`: `MemberType.AGENT = 'AGENT'` → `CREATOR = 'CREATOR'`. All users changed in the same step: signup `@IsIn` (S1), `@Roles` in `checkAuthRoles` and `property.resolver.ts`, the `getAgents` match, and the batch ranking (`batch.service.ts`). Existing dev members with `memberType: 'AGENT'` must be migrated with `updateMany` and log in again.
- [x] `property.enum.ts` → rename to `product.enum.ts`. **Deferred to Step 6:** the Property schema, DTOs, services and the batch still use this file, so the rename and the deletes below happen when their users go (the build must stay green).
  - [x] Delete `PropertyType` (APARTMENT/VILLA/HOUSE, lines 3–10). Step 6.
  - [x] Delete `PropertyLocation` (Korean cities, lines 21–34) (D-10). Step 6.
    - Both deleted in Step 6 part 5, together with the fields that used them. `SOLD` was removed from `PropertyStatus` in the same part, so `property.enum.ts` now holds only `PropertyStatus { ACTIVE, DELETE }`.
    - `property.enum.ts` was deleted in Step 6 part 7, not part 9. `ProductStatus` already existed in `product.enum.ts`, so the rename switched every user to it.
  - [x] `PropertyStatus { ACTIVE, SOLD, DELETE }` → `ProductStatus { ACTIVE, PAUSED, DELETE }`. `SOLD` goes away together with `soldAt` (D-10). `ProductStatus` is added in a new `product.enum.ts`; deleting `PropertyStatus` is Step 6.
  - [x] Add `ProductPricing { FREE, ONE_TIME, SUBSCRIPTION, CUSTOM }` (D-03). In `product.enum.ts`.
- [x] New `AgentCategory { CUSTOMER_SUPPORT, SALES, MARKETING, CONTENT, DATA_ANALYSIS, AUTOMATION, EDUCATION, OTHER }`. Put it in its own file (e.g. `agent-category.enum.ts`), because products and briefs share it (D-09).
- [x] New `brief.enum.ts`: `BriefStatus { OPEN, CLOSED, DELETE }`.
- [x] `like.enum.ts:5`: `LikeGroup.PROPERTY` → `PRODUCT`. **No** `BRIEF` (briefs can't be liked). `PRODUCT` is added; `PROPERTY` is removed in Step 6.
- [x] `view.enum.ts:6`: `ViewGroup.PROPERTY` → `PRODUCT`, and add `BRIEF`. `PROPERTY` is removed in Step 6.
- [x] `comment.enum.ts:14`: `CommentGroup.PROPERTY` → `PRODUCT`, and add `BRIEF`. `PROPERTY` is removed in Step 6.
- [x] `notification.enum.ts:22`: `NotificationGroup.PROPERTY` → `PRODUCT`, and add `BRIEF`. `PROPERTY` is removed in Step 6.
- [x] `common.enum.ts`: add `Message` strings for the new rules, such as:
  - price required, or price not allowed, for the given pricing (D-03)
  - budget must be > 0 (D-04)
  - deadline must be in the future (D-05)
  - brief already closed
- [x] Each rename changes the GraphQL enum value. Changing them together with Steps 5–8 keeps the API compiling. Every usage is listed below.
- [x] **Step 6 cleanup:** remove `PROPERTY` from `LikeGroup`, `ViewGroup`, `CommentGroup` and `NotificationGroup`, and delete `property.enum.ts`.
  - **Done in Step 6 part 7:** `property.enum.ts` deleted. No code uses the `PROPERTY` values any more, and the migration converted the stored rows. **Done in Step 6 part 9:** the 4 `PROPERTY` values removed.
  - **Precondition (checked on 2026-10-06, before the values were removed):** this read-only check in the dev DB had to return 0 for all four counts, and it did. Mongoose takes its `enum:` lists from these enums, so a leftover `PROPERTY` row would be rejected on its next save. Run the same check on any other database before deploying part 9.
    ```js
    const d = db.getSiblingDB('agentsHub');
    printjson({
    	likes: d.likes.countDocuments({ likeGroup: 'PROPERTY' }),
    	views: d.views.countDocuments({ viewGroup: 'PROPERTY' }),
    	comments: d.comments.countDocuments({ commentGroup: 'PROPERTY' }),
    	notifications: d.notifications.countDocuments({ notificationGroup: 'PROPERTY' }),
    });
    ```
  - Only `CommentGroup` is part of the GraphQL schema (`createComment` input, `Comment` output). `LikeGroup`, `ViewGroup` and `NotificationGroup` are not exposed by any operation, so removing their value is not an API change.

---

## Step 5 — Member

### Schema — `api/schemas/Member.model.ts`
- [x] Remove `memberAddress` (lines 51–53).
- [x] `memberProperties` → `memberProducts` (lines 59–62). **Expand done in Step 5:** `memberProducts` is added next to `memberProperties`. Removing `memberProperties` is Step 6, when the Property service and the batch stop using it (the build must stay green).
  - **Done in Step 6 part 8:** `memberProperties` removed from the schema. Existing values were moved to `memberProducts` by `scripts/migrations/step6-part8-member-products.mongosh.js`.
- [x] Add `memberBriefs: { type: Number, default: 0 }`.
- [x] Add `memberEmail` and `memberWhatsapp` (String, optional). Stored only; they are not GraphQL fields until D-07 is implemented.
- [x] `memberImage` default stays `''` (line 48); the ER doc now matches (D-15). No schema change. Do **not** add Mongoose `required: true`, because it rejects `''`.
- `memberImage: null` on update (D-15): fixed in Step 2.5 (B2).

### DTOs — `api/libs/dto/member/`
- [x] `member.ts`:
  - remove `memberAddress` (35–36)
  - `memberProperties` → `memberProducts` (41–42)
  - add `memberBriefs`, plus `memberEmail` and `memberWhatsapp` as nullable fields

  **Done in Step 5:** `memberAddress` removed; `memberProducts` and `memberBriefs` added. **Done in Step 6 part 8:** the `memberProperties` `@Field` removed (a GraphQL change, already in the Step 12 table). `memberEmail` / `memberWhatsapp` became nullable fields in [Step 9](#step-9--contact-visibility-d-07) (D-07).
- [x] `member.input.ts`:
  - `AgentsInquiry` (61) → `CreatorsInquiry`
  - its `AISearch` class (46) → e.g. `CISearch`
  - the import of `aviableAgentSorts` (5, 73)

  **Done in Step 5:** `AISearch` became **`CRISearch`**, not `CISearch`. `comment.input.ts:27` already defines a `CISearch` input, and GraphQL type names must be unique.
- `MembersInquiry.search` type: fixed in Step 2.5 (B1).
- Signup `memberType` restriction and removal from `MemberUpdateByAdmin` (D-14): fixed in Step 2.5 (S1). Keep the `@IsIn` list intact through step 4's `AGENT → CREATOR` rename.
- [x] `member.update.ts`:
  - `memberAdress` (typo; it never matched the schema) at lines 32–33 and 80–81: remove it
  - add `memberEmail` (`@IsEmail`) and `memberWhatsapp` to `MemberUpdate` and `MemberUpdateByAdmin`

  **Done in Step 5:** `memberAdress` removed from both inputs. `memberEmail` (`@IsEmail`, max 254 characters) and `memberWhatsapp` (E.164, e.g. `+998901234567`) added to both, with the limits in `libs/config.ts`. `null` removes a contact; `''` is rejected. They are write-only until D-07 adds them to the `Member` output type.

### Service — `api/components/member/member.service.ts`
- [x] `getAgents` (123) → `getCreators`. It filters `memberType: MemberType.AGENT` (126).
- [x] `getAgents` checks `if (!result)` instead of `!result.length` (144). Make it consistent with the other list queries.
  - Fixed in `getCreators` (Step 5, its own `fix:` commit). No behaviour change: `$facet` always returns one document, so an empty result is `list: []`, not an error.
- Contact visibility for `memberEmail` / `memberWhatsapp` (D-07): `getMember` (87), the list queries and the `$lookup`s return the whole document. **Moved to [Step 9 — Contact visibility (D-07)](#step-9--contact-visibility-d-07)**, together with the list of paths that must hide the fields from guests.
- [x] `memberStatsEditor` callers that pass `'memberProperties'` are listed in Step 6.
  - Done in Step 6 part 8: all 3 callers (`createProduct`, `updateProduct`, `updateProductByAdmin`) pass `'memberProducts'`.

### Resolver — `api/components/member/member.resolver.ts`
- [x] `getAgents` query (72–77) → `getCreators`, using `CreatorsInquiry`.
- [x] `checkAuthRoles` uses `@Roles(MemberType.USER, MemberType.AGENT)` (44).
  - Already fixed in Step 4: `@Roles(MemberType.USER, MemberType.CREATOR)`.

### Config — `api/libs/config.ts`
- [x] `aviableAgentSorts` (6) → `aviableCreatorSorts`. Consider adding `memberProducts`.
  - Renamed with the same values. Adding `memberProducts` is deferred to Step 6, when the counter is actually maintained.
  - [ ] The counter is maintained since Step 6 part 8. Adding `memberProducts` as a sort option is still open: it is a new API option, so it was kept out of the pure-rename part.

### Auth side effect
- [ ] `api/components/auth/auth.service.ts:21–31` puts the **whole member** in the JWT, and `RolesGuard` (`guards/roles.guard.ts:30`) reads `memberType` from the token. Tokens issued before the rename still carry `AGENT` and `memberProperties` for up to 30 days. Rotate `SECRET_TOKEN` or force a re-login after the migration.
  - The whole-member payload itself is a security item: see **S9** in Step 2.5 (fix before D-07).

---

## Step 6 — Product (replaces Property)

> **Part 7 (pure Property → Product rename) verified on 2026-10-05.**
> - Both apps build with 0 errors, and the API starts with the new GraphQL schema (`Product`, `ProductStatus`, `CreatorProductsInquiry`, `CPISearch`; no `Property` types).
> - The dev DB migration `scripts/migrations/step6-part7-property-to-product.mongosh.js` ran on the dev DB. Every check was 0: no `properties` collection, no `property*` keys in `products`, and no `PROPERTY` likes, views, comments or notifications.
> - Postman smoke tests passed for all 9 renamed operations, plus `getFavorities`, `getVisited` and `createComment(PRODUCT)`, including the temporary `PAUSED` rejection on `updateProduct` / `updateProductByAdmin`.
> - Deliberately left for later parts: `memberProperties` (part 8), the `PROPERTY` enum values (part 9), and the `property` upload target (part 10).

> **Part 8 (`memberProperties` → `memberProducts`) verified on 2026-10-06.**
> - Both apps build with 0 errors. The GraphQL `Member` type has `memberProducts` and no `memberProperties`.
> - The dev DB migration `scripts/migrations/step6-part8-member-products.mongosh.js` ran; no member has `memberProperties` any more.
> - Postman smoke tests passed: `createProduct` adds 1 to `memberProducts`, and owner and admin `DELETE` each subtract 1. Querying `memberProperties` is rejected by schema validation, and `getCreators` returns `memberProducts`.
> - Still open from this area: `memberProducts` as a creator sort option (Step 5 config) and the D-22 creator formula (Step 10).

### Files to rename
- [x] `api/schemas/Property.model.ts` → `Product.model.ts`
- [x] `api/libs/dto/property/{property,property.input,property.update}.ts` → `libs/dto/product/product*.ts`
- [x] `api/components/property/{property.module,property.resolver,property.service}.ts` → `components/product/product*.ts`
- [x] `api/components/components.module.ts:3,15`: `PropertyModule` → `ProductModule`
  - Done in Step 6 part 7 (`git mv`). `libs/enums/property.enum.ts` was deleted; the code uses the existing `ProductStatus` from `product.enum.ts`.

### Schema — `Property.model.ts` → `Product.model.ts`
- [x] Remove these fields (D-10):
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

  Done in Step 6 part 5, together with the output DTO, the inputs and the service.
- [x] Rename `property*` → `product*`: Status, Title, Price, Views, Likes, Comments, Rank, Images and Desc.
  - Done in Step 6 part 7. Existing documents were renamed by the migration script.
- [x] `productPrice`: `required: true` (36) → optional (D-03).
  - Done in Step 6 part 12: no `required`; the rule is checked in `ProductService` (D-03).
- [x] Make productDesc required (schema + input validation) (D-18):
  - schema: `propertyDesc` (79–81) → `productDesc: { type: String, required: true }`
  - `ProductInput`: `@IsNotEmpty()` instead of `@IsOptional()`; keep `@Length`
  - `Product` output type: non-null `@Field(() => String)` instead of `nullable: true` (`property.ts:54–55`)
  - `ProductUpdate`: stays optional, but must reject `null` and `''` so the description can't be cleared
  - Done in Step 6 part 11. The length is **20–3000** characters (not the old 5–500) on create and update, because it is the main text for semantic search later (D-18). The limits are `productDescMinLength` / `productDescMaxLength` in `libs/config.ts`. The update uses `@ValidateIf(… !== undefined)`, so `null` and `''` are rejected (D-15 pattern).
- [x] Add these fields:
  - `productCategory` (AgentCategory, required)
  - `productPricing` (ProductPricing, required)
  - `productDemoUrl` (String)
  - `productTags` ([String])
  - Done in Step 6 part 11 (schema, output, create and update inputs). Rules:
    - `productDemoUrl`: http(s) with protocol, max 500 characters; `null` on update removes it.
    - `productTags`: max 10, 1–30 characters each, not blank. Saved trimmed, lowercased and without duplicates by `normalizeTags()` (`libs/utils.ts`) in `createProduct`, `updateProduct` and `updateProductByAdmin`. On update, `null` is rejected and `[]` removes all tags.
    - `productCategory` / `productPricing` on update: `null` is rejected.
  - Dev data: the old test products lacked the new required fields, and one such product breaks every product read and list (non-null GraphQL fields). `scripts/migrations/step6-part11-delete-test-products.mongosh.js` deletes them together with their likes, views, comments and notifications, and resets `memberProducts` (option B; D-13, the seed script replaces them). Run it before starting the part 11 API.
- [x] `collection: 'properties'` (111) → `'products'`.
  - Done in Step 6 part 7. The migration script renamed the collection.
- [x] Replace the unique index `{ propertyType, propertyLocation, propertyTitle, propertyPrice }` (114) with the indexes from the ER doc:
  - unique `{ memberId: 1, productTitle: 1 }`
  - `{ memberId: 1, productStatus: 1 }`
  - `{ productCategory: 1, productStatus: 1 }`
  - `{ productStatus: 1, productRank: -1 }`

  **Done in Step 6 part 5:** the old unique index is replaced with unique `{ memberId, propertyTitle }`, `{ memberId, propertyStatus }` and `{ propertyStatus, propertyRank: -1 }`. Mongoose doesn't drop old indexes, so `propertyType_1_propertyLocation_1_propertyTitle_1_propertyPrice_1` must be dropped by hand in any existing `properties` collection. **Done in Step 6 part 7:** the `product*` index names. The migration script dropped the old indexes and created the new ones. **Done in Step 6 part 11:** the `{ productCategory, productStatus }` index.
- [x] Mongoose model name `'Property'` → `'Product'`. It is used in `property.module.ts:15`, `property.service.ts:29`, `batch/batch.module.ts:16`, `batch/batch.service.ts:12` and the `ref: 'Property'` in `Notification.model.ts:47`.
  - Done in Step 6 part 7 (also `comment.module.ts` and `comment.service.ts`).

### DTO — `property.ts` → `product.ts`
- [x] `Property` / `Properties` → `Product` / `Products`.
  - Done in Step 6 part 7.
- [x] Remove `propertyType`, `propertyLocation`, `propertyAddress`, `propertySquare`, `propertyBeds`, `propertyRooms`, `propertyBarter`, `propertyRent`, `soldAt` and `constructedAt` (12–37, 57–61, 66–73).
  - Done in Step 6 part 5.
- [x] `propertyType`, `propertyStatus` and `propertyLocation` are exposed as `@Field(() => String)`, not as their enums (12–19). Use `@Field(() => ProductStatus)` and so on for the new enum fields. (bug, fix in its own commit)
  - `propertyType` and `propertyLocation` were removed in Step 6 part 5 (D-10). `propertyStatus` was fixed in Step 6 part 6: it is now `@Field(() => PropertyStatus)`, and the part 7 rename carries it over as `ProductStatus`. The enum rule for the new fields is tracked in the next item.
- [x] Add `productCategory`, `productPricing`, `productPrice` (nullable Float), `productDemoUrl` (nullable) and `productTags` (nullable `[String]`).
  - **Done in Step 6 part 11:** `productCategory: AgentCategory!`, `productPricing: ProductPricing!`, `productDemoUrl: String`, `productTags: [String!]`, and `productDesc: String!`. **Done in Step 6 part 12:** `productPrice: Float` (nullable; `null` for `FREE` / `CUSTOM`).
  - `productCategory` and `productPricing` must be `@Field(() => AgentCategory)` / `@Field(() => ProductPricing)`, not `String` (see the item above).

### DTO — `property.input.ts` → `product.input.ts`
- [x] `PropertyInput` (9–70) → `ProductInput`:
  - drop Type, Location, Address, Square, Beds, Rooms, Barter, Rent and `constructedAt`
  - make `productPrice` optional (`@Min` > 0 is checked in the service, D-03)
  - `productImages`: `@ArrayMinSize(1)`
  - `productDesc`: required (D-18; see the schema item above)
  - `productDemoUrl`: `@IsUrl({ protocols: ['http','https'], require_protocol: true })`
  - `productTags`: optional `[String]`

  **Done in Step 6 part 5:** the dropped fields (first sub-point). **Done in Step 6 part 7:** the rename. **Done in Step 6 part 11:** `productCategory` / `productPricing` required, image minimum (`@ArrayMinSize(1)`), required desc (20–3000), demo URL and tags. **Done in Step 6 part 12:** optional price (`@IsOptional() @IsNumber()`); the D-03 check is in the service.
- [x] Remove `SquaresRange` (81–88). Decide whether `PeriodsRange` (90–97) is still needed.
  - Done in Step 6 part 5. `SquaresRange` is deleted. `PeriodsRange` is kept, because filtering listings by `createdAt` is still useful.
- [x] `PricesRange` (73–79) uses `Int`. Prices are Float in USD (D-06), so use `Float`. Per D-03, price filters must only match `ONE_TIME` / `SUBSCRIPTION`.
  - Done in Step 6 part 13: `start` / `end` are `Float` (≥ 0); a price range only matches `ONE_TIME` / `SUBSCRIPTION` products, and `start > end` is rejected.
- [x] `PIsearch` (99–141):
  - remove `locationList`, `typeList`, `roomsList`, `bedsList`, `options` and `squaresRange`
  - add `categoryList: AgentCategory[]`, `pricingList: ProductPricing[]` and `tagList?`

  **Done in Step 6 part 5:** the removals (first sub-point). **Done in Step 6 part 13:** `categoryList`, `pricingList` and `tagList` (all tags must match), in a shared abstract `ProductFilters` input that `PIsearch`, `CPISearch` and `ALPISearch` extend.
- [x] `PropertiesInquiry` (144) → `ProductsInquiry`.
  - Done in Step 6 part 7. `PIsearch` keeps its name (the letters still fit "Product").
- [x] `AgentPropertiesInquiry` (177) → `CreatorProductsInquiry`. `APISearch.propertyStatus` → `productStatus`.
  - Done in Step 6 part 7. `APISearch` became `CPISearch` (the "A" was the agent role, like `AISearch` → `CRISearch` in Step 5).
- [x] `AllPropertiesInquiry` (214) → `AllProductsInquiry`. In `ALPISearch`, `propertyLocationList` (209) → `productCategoryList`.
  - **Done in Step 6 part 5:** `propertyLocationList` was removed. **Done in Step 6 part 7:** the `AllProductsInquiry` rename (`ALPISearch` keeps its name; `propertyStatus` → `productStatus`). **Done in Step 6 part 13:** `ALPISearch` has the shared filters, including `categoryList` (named like the public filter, not `productCategoryList`), plus `memberId` and `periodsRange`.
- [x] `OrdinaryInquiry` (240–250) is generic, but it lives in the property DTO and is imported by `like.service.ts:8` and `view.service.ts:6`. Move it to a shared place, e.g. `libs/dto/common.input.ts`.
  - Moved to `libs/dto/common.input.ts` in Step 6 part 4. Like, view and the property service/resolver import it from there. The GraphQL type name and fields are unchanged, so it is not an API change.

### DTO — `property.update.ts` → `product.update.ts`
- [x] Remove Type, Location, Address, Square, Beds, Rooms, Barter, Rent, `soldAt` and `constructedAt`.
  - Done in Step 6 part 5.
- [x] Add `productCategory`, `productPricing`, `productPrice`, `productDemoUrl` and `productTags`.
  - **Done in Step 6 part 11:** category, pricing, demo URL and tags. `productImages` now rejects `null` and `[]`. **Done in Step 6 part 12:** `productPrice` accepts `null` (clears the price); the D-03 check runs on the merged values in the service.
- [x] (bug, fix in its own commit) `ProductUpdate.productTitle` uses `@IsOptional()`, which lets `null` through. The service then `$set`s `null` on a required field (`findOneAndUpdate` doesn't run schema validators). Reject `null` with the same `@ValidateIf(… !== undefined)` pattern. Found during Step 6 part 11.
  - Fixed: `@ValidateIf((o) => o.productTitle !== undefined)` + `@IsString()` + `@Length(3, 100)`. `null`, `''` and non-strings are rejected; omitting the field still works.

### Service — `property.service.ts` → `product.service.ts`
- [x] `createProperty` (35–50):
  - add the D-03 price/pricing check
  - the memberStatsEditor key `'memberProperties'` (41) → `'memberProducts'`

  **Done in Step 6 part 8:** the counter key. **Done in Step 6 part 12:** D-03 via `checkPricingRule()`.
- [x] `getProperty` (52–76):
  - `ViewGroup.PROPERTY` (62) → `PRODUCT`
  - `LikeGroup.PROPERTY` (70) → `PRODUCT`
  - `'propertyViews'` → `'productViews'`

  Done in Step 6 part 7 (now `getProduct`). Existing rows are converted by `scripts/migrations/step6-part7-property-to-product.mongosh.js`.
- [x] `updateProperty` (78–101):
  - remove the `SOLD` → `soldAt` branch (87, 93)
  - run D-03 on the **merged** pricing/price, so the existing doc must be loaded first
  - `'memberProperties'` (96) → `'memberProducts'`

  **Done in Step 6 part 5:** the `SOLD` → `soldAt` branch was removed; the counter now changes only on `DELETE`. **Done in Step 6 part 8:** the counter key. **Done in Step 6 part 12:** `shapePricingUpdate()` loads the stored pricing/price, merges the input, runs `checkPricingRule()`, and clears the price (`$unset`) when the final pricing is `FREE` / `CUSTOM` and no price is sent. `updateProductByAdmin` uses the same helper.
- [ ] `getProduct` (D-16):
  - `ACTIVE` → everyone
  - `PAUSED` → only the owner (`memberId` matches the caller) or an `ADMIN` caller; everyone else gets `NO_DATA_FOUND`
  - `DELETE` → nobody
  - The current search allows only `ACTIVE` (55).
- [ ] `getProduct` (D-16): record **no view** and don't increment `productViews` when the product is `PAUSED`, even for the owner.
- [ ] `updateProduct` (D-16):
  - match `productStatus: { $ne: DELETE }` instead of `ACTIVE` (84), so a paused product can be resumed
  - allowed owner transitions: `ACTIVE ↔ PAUSED`, and `ACTIVE | PAUSED → DELETE`
- [ ] `product.update.ts` (D-16): replace the temporary `@IsIn([ProductStatus.ACTIVE, ProductStatus.DELETE])` on `ProductUpdate.productStatus` with `@IsEnum(ProductStatus)`, and keep the `@ValidateIf((o) => o.productStatus !== undefined)` (B11). Don't just delete it: `@IsIn` is also what rejects `null` today, so without a replacement `null` passes again. The temporary guard was added in Step 6 part 7 (so the rename to `ProductStatus` did not make `PAUSED` settable before this logic exists). It covers both `updateProduct` and `updateProductByAdmin`.
- [ ] `updateProduct` / `updateProductByAdmin` (D-16):
  - `memberProducts` −1 only on a transition to `DELETE` (from `ACTIVE` or `PAUSED`)
  - **no** counter change on pause or unpause
- [ ] `updateProductByAdmin` (D-16): match `productStatus ≠ DELETE`, the same as the owner update (257).
- [ ] `getProperties` / `shapeMatchQuery` (103–164):
  - remove the location/rooms/beds/type/squares/options filters and the `$or` for options
    - **Done in Step 6 part 5.**
  - add category/pricing/tag filters
  - text search on `productTitle` (and maybe `productTags`)
  - (bug, fix in its own commit) `text` goes into `new RegExp` unescaped (158). Use the `escapeRegex` helper added in Step 2.5 (S8); the member and board-article cases are already fixed there.
    - **Done in Step 6 part 2:** `escapeRegex(text)`, plus `@MaxLength(searchTextMaxLength)` on `PIsearch.text`, the same as the member and board-article searches. **Still open** in this item: the sub-points not marked done.
  - keep the `productStatus: ACTIVE` match (104) for every caller, including the `memberId` filter used on other members' profiles. Paused products never appear here, not even for the owner (D-16).
- [ ] `getCreatorProducts` (D-16): the owner sees `ACTIVE` + `PAUSED` (the current `≠ DELETE` match, 180). Keep it.
- [x] `getFavorities` / `getVisited` (166–172) call `likeService.getFavoriteProperties` / `viewService.getVisitedProperties` (see Step 8). Keep the misspelled operation name `getFavorities` (convention).
  - Done in Step 6 part 7: they call `getFavoriteProducts` / `getVisitedProducts` and return `Products`.
- [x] `getAgentProperties` (174–204) → `getCreatorProducts`.
  - Done in Step 6 part 7.
- [x] `likeTargetProperty` (206–222):
  - `LikeGroup.PROPERTY` (213) → `PRODUCT`
  - `'propertyLikes'` → `'productLikes'`
  - keep the `ACTIVE`-only target check (207). It rejects likes **and** unlikes on `PAUSED` products (D-16).

  Done in Step 6 part 7 (now `likeTargetProduct`); the `ACTIVE` check is unchanged.
- [x] `getAllPropertiesByAdmin` (224–251): `propertyLocationList` filter → category filter. Admins see every status, including `PAUSED` (D-16).
  - **Done in Step 6 part 5:** the location filter was removed. **Done in Step 6 part 13:** the category filter and the other shared filters, applied by the same `shapeMatchQuery` as `getProducts` and `getCreatorProducts`.
- [x] `updatePropertyByAdmin` (253–275): the same `SOLD`/`soldAt` removal, plus `'memberProperties'` (269).
  - **Done in Step 6 part 5:** the `SOLD` / `soldAt` removal. **Done in Step 6 part 8:** the counter key.
- [x] `removePropertyByAdmin` (277–286) (bug, fix in its own commit): `findByIdAndDelete(search)` passes an object as the id. Use `findOneAndDelete(search)`.
  - Fixed in Step 6 part 1. Mongoose cast the object to its `_id` and dropped the `propertyStatus: DELETE` condition, so `ACTIVE` properties were hard-deleted too. Now only a property that is already `DELETE` can be removed.
- [x] (bug, D-22, fix in its own commit) Self-engagement on own products:
  - `getProduct` must not record a view when the caller owns the product (`property.service.ts:61`)
  - `likeTargetProduct` must reject liking your own product (`:206`)

  The profile half is fixed in Step 2.5 (B9).
  - Fixed in Step 6 part 3, on `getProperty` / `likeTargetProperty` before the rename, with the same pattern as B9. The owner's views are not recorded. The owner's like is rejected with `NOT_ALLOWED_REQUEST` after the target lookup, so a missing or non-`ACTIVE` property still returns `NO_DATA_FOUND`. Because likes toggle, the owner can't unlike either.
- [x] `propertyStatsEditor` (288) → `productStatsEditor`. Callers: `comment.service.ts:37`.
  - Done in Step 6 part 7.

### Resolver — `property.resolver.ts` → `product.resolver.ts`
- [x] `@Roles(MemberType.AGENT)` → `CREATOR` on create (26), update (49) and `getAgentProperties` (91).
  - Already `CREATOR` since Step 4.
- [x] Rename the operations (done in Step 6 part 7):
  - `createProperty` → `createProduct`
  - `getProperty` → `getProduct`
  - `updateProperty` → `updateProduct`
  - `getProperties` → `getProducts`
  - `getAgentProperties` → `getCreatorProducts`
  - `likeTargetProperty` → `likeTargetProduct`
  - `getAllPropertiesByAdmin` → `getAllProductsByAdmin`
  - `updatePropertyByAdmin` → `updateProductByAdmin`
  - `removePropertyByAdmin` → `removeProductByAdmin`
- [x] Rename the `@Args('propertyId')` arguments (41, 105, 135) → `'productId'`.
  - Done in Step 6 part 7.
- [x] The admin mutations log `'Query: …'` (127, 136). Fix them to `'Mutation: …'`.
  - Done in Step 6 part 7, while renaming those log lines.

### Config — `api/libs/config.ts`
- [x] `aviableOptions = ['propertyBarter','propertyRent']` (9): remove it (D-10).
  - Done in Step 6 part 5, together with the `options` search filter that used it.
- [x] `aviablePropertySorts` (10–17) → `aviableProductSorts`, with `product*` keys.
  - Done in Step 6 part 7.

### Uploads (moved from Step 3)
- [x] Upload target whitelist `validUploadTargets` (added in Step 2.5, S2) in `api/libs/config.ts`: change `property` → `product`. This changes behaviour (uploads with `target: "property"` are rejected afterwards), so it belongs here and not in Step 3.
  - Done in Step 6 part 10: `['member', 'product', 'article']`.
- [x] Create `uploads/product/` (the folder is local and gitignored, so create it on each machine). Old Nestar images in `uploads/property/` are not migrated (D-13).
  - Done in Step 6 part 10 on this machine, as an empty folder. Nothing was copied from `uploads/property/`, and `productImages` paths in the dev DB were not rewritten: those are Nestar real-estate images and test data (D-13), which the seed script will replace. `uploads/property/` stays on disk for now.
- [x] (bug, separate fix, commit later) Upload folders must be created by the code (mkdir recursive) at startup or before writing, so a fresh server does not fail every upload.
  - Before the fix, `imageUploader` / `imagesUploader` (`member.resolver.ts`) piped into `createWriteStream(url)`, which does not create folders. On a machine without `uploads/<target>/`, every upload to that target failed (`UPLOAD_FAILED`, or a silently skipped image in `imagesUploader`).
  - Fixed after Step 6 part 10: both uploaders call `mkdir(dirname(url), { recursive: true })` right before writing, after the target allow-list and path checks. Doing it before each write (not only at startup) also covers a folder deleted while the server runs.
- [x] (bug) `imagesUploader` hides a failed image. The per-file `catch` only logs `'Error, file missing!'` (it also swallows the `PROVIDE_ALLOWED_FORMAT` error), and the result is `[String!]!`:
  - If the **last** file(s) fail, the array is just shorter, so the image is silently dropped.
  - If an **earlier** file fails, the array has a hole, and GraphQL returns an opaque "Cannot return null for non-nullable field" error.
  - In both cases the client can't tell which file failed, and the files that were written stay on disk as orphans.
  - Fixed with option A, **all-or-nothing** (chosen over per-file results because it needs no API change, and product image sets are used as a whole):
    - All files are processed with `Promise.allSettled`.
    - If any file fails, every file this request wrote (including a partly written one) is deleted. The request then fails with the error of the first failing file in upload order, naming it, e.g. `Please provide jpg, jpeg or png images! (file 2: c.gif)` (400) or `Upload failed! (file 3: big.png)` (500).
    - Writing uses `stream/promises` `pipeline` instead of `pipe`. Before, a read-stream error (e.g. a file over the 15 MB limit) was not forwarded, so the request never finished.
    - The return type stays `[String!]!`; on success the URLs are in upload order.
    - Checked with a direct call of the resolver method in a scratch folder: all valid; a bad MIME type in file 2; a read error in file 3; target `property`. After each failure, no files were left.
- [x] (bug) `imageUploader` (single file) has the same stream handling: `pipe` doesn't forward read-stream errors (a file over the size limit makes the request hang), a write error rejects with `false` instead of an exception, and a partly written file is not removed. Fix it the same way (`pipeline`, remove the file on failure) in its own commit.
  - Fixed in the same way as `imagesUploader`:
    - writing uses `stream/promises` `pipeline`;
    - any read or write error removes the partly written file and throws `InternalServerErrorException(UPLOAD_FAILED)`;
    - the format and target checks are unchanged.
  - Checked with a direct call of the resolver method in a scratch folder: a valid file with the folder missing; a read error (simulated size limit), which now fails at once with no file left; a bad MIME type; target `property`.

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
- [x] `api/components/like/like.service.ts` (Done in Step 6 part 7):
  - `getFavoriteProperties` (46–83) → `getFavoriteProducts`
  - `LikeGroup.PROPERTY` (48)
  - `$lookup from: 'properties'` (56) → `'products'`
  - alias `favoriteProperty` (59, 62, 69, 80) → `favoriteProduct`
  - return type `Properties`
  - imports `OrdinaryInquiry` / `Properties` from the property DTO (8–9)
- [x] Favorites `ACTIVE` filter (added in Step 2.5, B4): rename it to `'favoriteProduct.productStatus': ProductStatus.ACTIVE`, keeping it before `$facet`. This also hides `PAUSED` products (D-16).
- [x] `api/libs/config.ts:132–139`: `lookupFavorite` uses `favoriteProperty.memberId` / `favoriteProperty.memberData` → `favoriteProduct.*`.

### View
- [x] `api/schemas/View.model.ts:26`: the unique index `{ memberId, viewRefId }` is kept; the ER doc now matches (D-18). No code change.
- [x] `api/components/view/view.service.ts` (Done in Step 6 part 7):
  - `getVisitedProperties` (30–65) → `getVisitedProducts`
  - `ViewGroup.PROPERTY` (32)
  - `from: 'properties'` (40)
  - alias `visitedProperty` (43, 46, 53, 62) → `visitedProduct`
  - imports (6, 8)
- [x] Visited `ACTIVE` filter (added in Step 2.5, B5): rename it to `'visitedProduct.productStatus': ProductStatus.ACTIVE`, keeping it before `$facet` (D-16).
- [x] `api/libs/config.ts:141–148`: `lookupVisit` uses `visitedProperty.*` → `visitedProduct.*`.

### Comment
- [ ] `api/components/comment/comment.service.ts`:
  - `PropertyService` import and injection (10, 20)
  - `case CommentGroup.PROPERTY` → `propertyStatsEditor('propertyComments')` (36–42) becomes `PRODUCT` → `productStatsEditor('productComments')`
  - add `case CommentGroup.BRIEF` → `briefStatsEditor('briefComments')`

  **Done in Step 6 part 7:** the `PropertyService` and `PRODUCT` / `productStatsEditor('productComments')` renames. **Still open:** the `BRIEF` case (Step 7).
- [ ] `api/components/comment/comment.module.ts:10,24`: `PropertyModule` → `ProductModule`, and add `BriefModule`.
  - **Done in Step 6 part 7:** `ProductModule` and the `'Product'` model. **Still open:** `BriefModule`.
- `MEMBER` comment counter on the author: fixed in Step 2.5 (B6).
- [ ] `createComment` target check (added in Step 2.5, B7 for `PROPERTY`/`ARTICLE`/`MEMBER`):
  - rename the `PROPERTY` case to `PRODUCT`; the target must be `ACTIVE`, so comments on `PAUSED` products are rejected (D-16)
  - add `BRIEF` (target must exist and not be `DELETE`)

  **Done in Step 6 part 7:** the `PRODUCT` case (still `ACTIVE` only). **Still open:** `BRIEF`.
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

  **Done in Step 6 part 7:** `productId` (existing documents are renamed by the migration script). **Still open:** `briefId`.
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

## Step 9 — Contact visibility (D-07)

> **Depends on S9** (slim JWT, Step 2.5). Do not start this step until S9 is done. Once the contacts are GraphQL fields, every path outside GraphQL that could leak them must already be closed.
> Moved here from Step 5. Since Step 5, `memberEmail` / `memberWhatsapp` are stored in the schema and accepted as validated, write-only inputs (`MemberUpdate`, `MemberUpdateByAdmin`). They are plain TS properties without `@Field` on `Member`, so no query returns them yet.

### Goal
- [ ] Add `memberEmail` and `memberWhatsapp` to the GraphQL `Member` type as `@Field(() => String, { nullable: true })` (`api/libs/dto/member/member.ts`). Remove the "no `@Field` until D-07" comment.
- [ ] A request without a valid token (a guest) gets `null` for both fields **everywhere a `Member` is returned**. A logged-in member gets the stored value, or `null` if it isn't set.

### Approach
- [ ] Record the chosen approach in `docs/decisions.md` as a **Proposed** decision before implementing it. D-07 says the approach is chosen in this step.
- **Preferred: one field-level check**, so the rule lives in one place and is not repeated in every query.
  - Example: a `@ResolveField` for each contact field on a `@Resolver(() => Member)` class. GraphQL runs a field resolver for every `Member` object in a response, however that object was loaded: `findOne`, a list `$facet`, or a `$lookup` `memberData`. Existing queries need no change, and new queries are covered automatically.
  - Alternative, if field resolvers turn out impractical: a single serializer or interceptor that walks the response and sets the fields to `null` for guests. This is still one place.
  - **Not acceptable:** hiding the fields per query (a `$project` in each service or lookup). It is easy to miss one path, and D-07 requires the rule to be enforced in the API.
- **Auth inside the field check:**
  - The route guards don't cover it. They put `authMember` on `req.body` only for guarded operations, and `signup` / `login` have no guard.
  - Read the `Authorization` header from the GraphQL context request and verify it with `AuthService.verifyToken`.
  - Verify **once per request** and cache the result on the request. Otherwise a list of 50 members verifies the token 100 times.
  - A missing, invalid or expired token means a guest (`null`), never an error.
- **Open questions** (answer them in the same decision; answered in **D-23**: only `ACTIVE` members see contacts, and `signup` / `login` return `null`):
  - **Blocked or deleted members:** is a valid token whose member is now `BLOCK` / `DELETE` "logged in"? After S9 the token has no `memberStatus`. Options: treat it as logged in (as the guards do today), or load the status once per request.
  - **Own data in `signup` / `login` responses:** the request has no token yet, so a token-based check returns `null` for the member's own contacts. Accept this (the client calls `getMember` afterwards), or treat the returned member as the caller.

### Paths that must return `null` to guests
The field-level check covers all of them automatically. Keep the list as the verification checklist; the Step 5 audit listed them first.
- [ ] `getMember` (`member.service.ts:87`), including `getMember(null, …)` embedded as `memberData` in `getBoardArticle` and `getProperty` (→ `getProduct`, Step 6). `follow.service.ts:28,53` also calls `getMember(null, …)`, but only as an existence check; the result is not returned.
- [ ] `Members.list`: `getCreators`, and `getAllMembersByAdmin` (admins are logged in, so they see contacts).
- [ ] Member-returning mutations: `signup`, `login`, `updateMember`, `likeTargetMember`, `updateMemberByAdmin`.
- [ ] Every `$lookup` in `api/libs/config.ts`:
  - `lookupMember` → `memberData` in `getBoardArticles`, `getAllBoardArticlesByAdmin`, `getComments`, and the property (product, Step 6) and brief (Step 7) lists
  - `lookupFollowingData` / `lookupFollowerData` → `followingData` / `followerData` in `getMemberFollowings` / `getMemberFollowers`
  - `lookupFavorite` / `lookupVisit` → `favoriteProduct.memberData` / `visitedProduct.memberData` in `getFavorities` / `getVisited` (renamed in Step 8)
- [ ] Output types that embed a `Member`, so the check is visible in the schema: `BoardArticle.memberData`, `Comment.memberData`, `Follower.followerData`, `Following.followingData`, `Property.memberData` (→ `Product.memberData`, Step 6), `Brief.memberData` (Step 7).

### Outside GraphQL
- [ ] JWT: covered by S9 (the payload is only `_id`, `memberType`, `memberNick`).
- [ ] Socket chat: still sends only `{ _id, memberNick, memberImage, memberType }` (S3; also listed in Step 8 → Socket).

### Verify
- Give member A an email and a WhatsApp number. Then:
  - a guest calls `getMember(A)` → both `null`
  - member B (logged in) calls `getMember(A)` → the stored values
  - an invalid or expired token → both `null` (guest), and no error
  - block member B in Compass (`memberStatus: "BLOCK"`), then call `getMember(A)` with B's token → both `null`; set B back to `ACTIVE` → the stored values again (D-23)
- As a guest, every path above that embeds A (`getCreators`, `getBoardArticles`, `getComments`, `getMemberFollowers` / `getMemberFollowings`, and later products, briefs, favorites and visited) → both `null`.
- The schema shows both fields as nullable `String` on `Member`.
- A list request verifies the token only once (check with a log line or a counter during the test).

---

## Step 10 — Batch (`apps/nestar-batch/`)

- [x] `batch/batch.module.ts:9,16`: imports `PropertySchema` from `../../nestar-api/src/schemas/Property.model` and registers it as `'Property'` → `ProductSchema` / `'Product'`.
- [x] `batch/batch.service.ts`:
  - imports `Property` / `PropertyStatus` (3, 6)
  - `@InjectModel('Property') propertyModel` (12) → `productModel`

  Done in Step 6 part 7 (both items above).
- [ ] `batchRollback` (15–36):
  - `propertyStatus: ACTIVE` / `propertyRank` (19, 21) → `product*`
  - reset `productRank` for all non-deleted products (`productStatus ≠ DELETE`), not only `ACTIVE`, so a product that is reactivated doesn't keep a stale rank (D-16)
  - `memberType: MemberType.AGENT` (29) → `CREATOR`

  **Done in Step 6 part 7:** the `product*` field rename (still `ACTIVE` only). `CREATOR` has been in place since Step 4. **Still open:** the `≠ DELETE` reset (D-16).
- [ ] `batchProperties` (38–53) → `batchProducts`. The rank becomes `productLikes*2 + productViews*1` (line 48: rename the fields only; weights unchanged). Comments are never used (D-17).
  - keep ranking only `ACTIVE` products (41). Paused products get no rank (D-16).

  Done in Step 6 part 7 (rename only; formula and `ACTIVE` filter unchanged).
- [ ] `batchAgents` (55–71) → `batchCreators`:
  - `memberType: AGENT` (58)
  - formula (65–66) `memberProperties*5 + memberArticles*3 + memberLikes*2 + memberViews*1` → **`memberLikes*2 + memberViews*1`** (D-22). Drop `memberProperties`/`memberProducts` and `memberArticles` from both the formula and the destructuring at line 65. The creator's own post counts are not a ranking signal.
  - Step 6 part 8 renamed `memberProperties` → `memberProducts` in the current formula (`memberProducts*5 + …`, weights unchanged). The D-22 change above is still open.
- Self-engagement in rankings (D-22): the profile half is fixed in Step 2.5 (B9), and the product half in Step 6 (its own commit).
- [ ] `batch/batch.controller.ts`:
  - `BATCH_TOP_PROPERTIES` / `BATCH_TOP_AGENTS` (4, 35, 46)
  - `batchTopProperties` / `batchTopAgents` (36, 47)
  - logger contexts (38, 49)
  - the commented-out nightly job (62–73) calls `batchProperties` / `batchAgents`

  **Done in Step 6 part 7:** `BATCH_TOP_PRODUCTS`, `batchTopProducts`, its logger context and `batchProducts` in the nightly job. **Still open:** the agents → creators names.
- [ ] `batch/batch.controller.ts:8`: `new Logger('BatchController.name')` is a string literal, not `BatchController.name`. (cosmetic)
- [ ] `batch/libs/config.ts:6–7`: `BATCH_TOP_PROPERTIES` → `BATCH_TOP_PRODUCTS` and `BATCH_TOP_AGENTS` → `BATCH_TOP_CREATORS`.
  - **Done in Step 6 part 7:** `BATCH_TOP_PRODUCTS`. **Still open:** `BATCH_TOP_CREATORS`.
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
  | Error responses: validation failures returned only `"Bad Request Exception"` | Since B14: `errors[0].message` is always a string. For validation failures (`extensions.code: BAD_REQUEST`) it holds all messages joined with `"; "`, and `extensions.validationErrors` holds them as an array (one entry per failed rule, e.g. `["Password must be at least 8 characters!", "Phone number must be in international format, …"]`) to show next to the fields. Other errors have only `extensions.code`. Sensitive values in messages are shown as `"***"` (S15) |
  | Update inputs accepted `null` for required fields and stored it | Since B11: `null` is a validation error (`BAD_REQUEST`) for `memberNick`, `memberPhone`, `memberStatus` (admin), `articleTitle`, `articleContent`, `articleStatus`, `commentContent`, `commentStatus`, `productStatus` and (until Step 6 part 12) `productPrice`. **Leave a field out to keep it unchanged; don't send `null`.** `null` still clears the optional fields: `memberFullName`, `memberDesc`, `memberEmail`, `memberWhatsapp`, `articleImage`, `productDemoUrl`, and since Step 6 part 12 `productPrice` (see the D-03 row) |
  | Passwords 5–12 characters everywhere | Since S13 (D-26): `signup` and `changePassword.newPassword` need at least 8 characters and at most 72 bytes (UTF-8), with no composition rules; errors `PASSWORD_TOO_SHORT` / `PASSWORD_TOO_LONG`. `login` and `changePassword.currentPassword` only need a non-empty value, so existing passwords keep working |
  | `memberPhone`: any non-empty string | Since B12 (D-25): E.164 only (`+`, country code, digits, 8–15 digits, e.g. `+998901234567`) in `signup`, `updateMember` and `updateMemberByAdmin`; error `INVALID_PHONE`. No spaces or dashes; the API doesn't reformat. Same rule as `memberWhatsapp` |
  | `updateMember` / `updateMemberByAdmin` with `memberPassword` | removed (S11, D-24): sending it fails GraphQL validation. New `changePassword(input: { currentPassword, newPassword }): Boolean!` for the logged-in member; errors `WRONG_PASSWORD`, `SAME_PASSWORD`, and `NOT_AUTHENTICATED` for a blocked or deleted member. Admins can't set passwords. Existing tokens stay valid after a change |
  | `getAgents(AgentsInquiry)`, search input type `AISearch` | `getCreators(CreatorsInquiry)`, search input type `CRISearch` (same fields: `memberStatus`, `memberType`, `text`) |
  | `Property`, `Properties` types | `Product`, `Products` |
  | `Property.property*` fields (`propertyStatus`, `propertyTitle`, `propertyPrice`, `propertyViews`, `propertyLikes`, `propertyComments`, `propertyRank`, `propertyImages`, `propertyDesc`) | `product*` (same fields; also inside `getFavorities` / `getVisited`) |
  | `createProperty`, `getProperty(propertyId)`, `updateProperty`, `getProperties`, `getAgentProperties`, `likeTargetProperty(propertyId)` | `createProduct`, `getProduct(productId)`, `updateProduct`, `getProducts`, `getCreatorProducts`, `likeTargetProduct(productId)` |
  | Input types `PropertyInput`, `PropertyUpdate`, `PropertiesInquiry`, `AgentPropertiesInquiry` (search `APISearch`), `AllPropertiesInquiry` | `ProductInput`, `ProductUpdate`, `ProductsInquiry`, `CreatorProductsInquiry` (search `CPISearch`), `AllProductsInquiry`. `PIsearch` / `ALPISearch` keep their names. Input fields `property*` → `product*`, including `search.propertyStatus` → `search.productStatus` |
  | `sort` values `propertyLikes`, `propertyViews`, `propertyRank`, `propertyPrice` | `productLikes`, `productViews`, `productRank`, `productPrice` (old values are rejected) |
  | `getAllPropertiesByAdmin`, `updatePropertyByAdmin`, `removePropertyByAdmin(propertyId)` | `getAllProductsByAdmin`, `updateProductByAdmin`, `removeProductByAdmin(productId)` |
  | `getFavorities`, `getVisited` (return `Properties`) | same names, return `Products` |
  | Property search: `locationList`, `typeList`, `roomsList`, `bedsList`, `options`, `squaresRange` | removed; replaced by `categoryList`, `pricingList`, `tagList` (Step 6 part 13, see the row below) |
  | Product list search: `PIsearch` (`memberId`, `pricesRange` as `Int`, `periodsRange`, `text`), `CPISearch` / `ALPISearch` (`productStatus` only); `sort: productPrice` put products without a price first in ASC; `search` fields were not validated | Since Step 6 part 13: all three search inputs share `categoryList: [AgentCategory!]`, `pricingList: [ProductPricing!]`, `pricesRange`, `tagList: [String!]` and `text`. `ALPISearch` also gets `memberId` and `periodsRange`; `CPISearch` has no `memberId` (always the caller). `PricesRange` is `Float!` (≥ 0) and only matches `ONE_TIME` / `SUBSCRIPTION` products (D-03); with `pricingList`, only the overlap is matched. `start > end` → `BAD_REQUEST` `INVALID_PRICE_RANGE`. `tagList` matches products that have **all** the tags (normalized like `productTags`). The rules inside `search` are now enforced (`BAD_REQUEST`): unknown enum values, an invalid `memberId`, `text` over 100 characters, more than 10 tags, negative prices. `sort: productPrice` puts products without a price last in both directions; every product sort breaks ties by the newest `_id`. `getCreators` gets the sort `memberProducts` (a sort option only, not part of `memberRank`, D-22) |
  | `createProduct(input)` with title, price, images and an optional desc | Since Step 6 part 11: `productCategory: AgentCategory!` and `productPricing: ProductPricing!` are required; `productDesc` is required (20–3000 characters); `productImages` needs at least 1 image; optional `productDemoUrl` (http(s), max 500) and `productTags` (max 10, 1–30 characters, returned normalized: trimmed, lowercased, no duplicates). `updateProduct` / `updateProductByAdmin` reject `null` for category, pricing, tags, images and desc, and `''` for desc |
  | `Product.productPrice: Float!`, `ProductInput.productPrice: Float!`; any price with any pricing (including 0) | Since Step 6 part 12 (D-03): `Product.productPrice` and `ProductInput.productPrice` are nullable `Float`; the price is `null` for `FREE` / `CUSTOM` (typed clients must handle `null`). `createProduct`, `updateProduct` and `updateProductByAdmin` return `BAD_REQUEST`: `PRICE_NOT_ALLOWED` ("Price is not allowed for FREE and CUSTOM pricing!") for a price with `FREE` / `CUSTOM`, and `PRICE_REQUIRED` ("Price greater than 0 is required for ONE_TIME and SUBSCRIPTION pricing!") for a missing price or one ≤ 0 with `ONE_TIME` / `SUBSCRIPTION`. Updates check the **final** pair (stored values merged with the input): leave `productPrice` out to keep it, send `null` to clear it. Switching to `FREE` / `CUSTOM` without a price clears the stored price; switching to `ONE_TIME` / `SUBSCRIPTION` needs a price unless one is already stored. `SUBSCRIPTION` prices are per month, all prices in USD (D-06) |
  | `PropertyStatus` enum; `PropertyStatus.SOLD`, `soldAt`, `constructedAt`, barter/rent | `ProductStatus`; SOLD and the dates removed; `PAUSED` is listed, but `updateProduct` / `updateProductByAdmin` reject it until the D-16 part |
  | `LikeGroup` / `ViewGroup` / `CommentGroup` `PROPERTY` | `PRODUCT` (+ `BRIEF` for view/comment). Since Step 6 part 9, `CommentGroup.PROPERTY` no longer exists: `createComment` with `commentGroup: PROPERTY` fails GraphQL validation (`GRAPHQL_VALIDATION_FAILED`). The other group enums are not in the GraphQL schema |
  | `imagesUploader(target: "property")` | `target: "product"` |
  | — | new `Brief` queries and mutations (Step 7) |
  | `getComments(search: { commentRefId })` | `search: { commentRefId, commentGroup }`. `commentGroup` is required; a paused or missing product returns `NO_DATA_FOUND` (D-16) |
  | Error codes: almost every business error returned `extensions.code: INTERNAL_SERVER_ERROR` | Since B15 part 1, messages unchanged unless stated:<br>• **`NOT_FOUND`**: `getProduct`, `getBoardArticle` and `getMember` when the item is missing or hidden; `likeTargetProduct`, `likeTargetBoardArticle` and `likeTargetMember` when the target is missing; `createComment` when the target is missing or not `ACTIVE`; `unsubscribe` when not following; the owner updates `updateProduct`, `updateBoardArticle` and `updateComment` (missing, not yours, or not `ACTIVE`); `updateProductByAdmin`, `updateBoardArticleByAdmin` and `updateMemberByAdmin`; `removeProductByAdmin`, `removeBoardArticleByAdmin` and `removeCommentByAdmin`.<br>• **`BAD_REQUEST`**: `subscribe` to yourself; `getMemberFollowings` / `getMemberFollowers` without a member id; `createComment` with a malformed `commentRefId`; `getCreatorProducts` asking for `DELETE`.<br>• **`UNAUTHENTICATED`**: `updateMember` by a blocked or deleted member, with the message changed from `UPDATE_FAILED` to `NOT_AUTHENTICATED`; any guarded operation without a token (`TOKEN_NOT_EXIST`, before: `BAD_REQUEST`).<br>Real server faults still return `INTERNAL_SERVER_ERROR` |
  | Duplicate nick, phone or product title: `signup` and `createProduct` returned `BAD_REQUEST` (`createProduct` with `CREATE_FAILED`); the four update operations returned `INTERNAL_SERVER_ERROR` with the raw MongoDB `E11000 …` text | Since B15 part 2, every duplicate returns **`CONFLICT`**:<br>• `signup`, `updateMember`, `updateMemberByAdmin`: `USED_MEMBER_NICK_OR_PHONE` ("Already used member nick or phone")<br>• `createProduct`, `updateProduct`, `updateProductByAdmin`: new `USED_PRODUCT_TITLE` ("A product with this title already exists for this creator!")<br>Other `signup` / `createProduct` failures keep `BAD_REQUEST` |
  | `login` errors: `NO_MEMBER_NICK` (unknown nick or deleted member), `WRONG_PASSWORD`, `BLOCKED_USER` (checked before the password), all with `INTERNAL_SERVER_ERROR` | Since B15 part 3 (D-27): an unknown nick, a deleted member and a wrong password all return **`UNAUTHENTICATED`** with `INVALID_CREDENTIALS` ("Wrong member nick or password!"). A blocked member gets **`FORBIDDEN`** with `BLOCKED_USER` only when the password is correct; with a wrong password they get `INVALID_CREDENTIALS` like everyone else. `NO_MEMBER_NICK` no longer exists. Show one login error; there is no separate "unknown nick" state |
  | `removeBoardArticleByAdmin` hard-deleted only `ACTIVE` articles; an article already set to `DELETE` could not be removed | Since B15 part 4 (D-28): it removes only articles with `articleStatus: DELETE`, like `removeProductByAdmin`. An `ACTIVE` article returns `NOT_FOUND` with `REMOVE_FAILED`. Admin UI: first `updateBoardArticleByAdmin` with `articleStatus: DELETE`, then `removeBoardArticleByAdmin` |

- [ ] In the frontend repo, remove the real-estate pages and filters (location, beds, rooms, square, barter/rent, sold state) in the same step (D-10).
- [ ] Contact info must come from the API's null-for-guests behaviour, not only from hiding it in the UI (D-07).
- [ ] After S9 the token holds only `_id`, `memberType`, `memberNick`. Load the member profile from the login response, and on page reload from the API, never from the token.
- [ ] Show placeholder when memberImage is '' (D-15).
- [ ] Community chat (D-19):
  - render message text as plain text only (text nodes, or the framework's default escaping), never as HTML (`innerHTML` / `dangerouslySetInnerHTML`)
  - hide the send box for guests (they can only read)
  - show the server's validation and rate-limit errors
  - use only the public member fields (`_id`, `memberNick`, `memberImage`, `memberType`)
- [ ] Owner product management: pause/resume buttons (`ACTIVE ↔ PAUSED`), and a "paused" badge in the owner's own product list (D-16).
- [ ] Handle `NO_DATA_FOUND` from `getProduct` for paused products (e.g. old links and shared URLs). Hide like/comment controls on the owner's own paused product (D-16).

---

## Step 13 — Refactors and cleanup

- [ ] Extract the shared single-file save logic (format check, mkdir, pipeline, partial-file cleanup) used by `imageUploader` and `imagesUploader` into one helper.
  - Both uploaders in `api/components/member/member.resolver.ts` currently repeat the same steps:
    - MIME check against `validMimeTypes`
    - `getSerialForImage` + `getUploadPath`
    - `mkdir(dirname(url), { recursive: true })`
    - `pipeline(createReadStream(), createWriteStream(url))`
    - `unlink` of the partly written file on failure

    This logic came from the fixes after Step 6 part 10.
  - Keep each uploader's own behaviour: `imageUploader` throws plain messages. `imagesUploader` adds the `(file N: name)` label and stays all-or-nothing, so it also removes the other files of the request.
- [ ] Move the helper functions from `api/libs/config.ts` to `api/libs/utils.ts`: `libs/config.ts` holds settings, and `libs/utils.ts` holds helpers.
  - `libs/utils.ts` was created in Step 6 part 11 with `normalizeTags()`.
  - Candidates to move: `escapeRegex`, `getSerialForImage`, `getUploadPath`, `shapeInToMongoObjectId`, and the `$lookup` builders (`lookupMember`, `lookupAuthMemberLiked`, …).
  - Update every import in the same commit. This is a pure move with no behaviour change.
- [ ] guards (auth/roles/without) use console.log for memberNick; move to Logger.debug or remove

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
