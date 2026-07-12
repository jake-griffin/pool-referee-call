# Implementation Plan: Pool Tournament Referee Call App

## Overview

Implement a mobile-first Next.js 15 (App Router) web application for managing referee calls at pool tournaments. The stack is TypeScript + Tailwind CSS, with DynamoDB single-table persistence and AWS Amplify Hosting for deployment. Tasks are ordered bottom-up: project scaffold → database layer → domain logic → API route handlers → UI components → deployment config → property-based and integration tests.

## Tasks

- [x] 1. Scaffold project and configure tooling
  - Initialise a new Next.js 15 App Router project with TypeScript at `~/Projects/pool-referee-call` (`npx create-next-app@latest --typescript --tailwind --app`).
  - Install AWS SDK v3 packages: `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`.
  - Install testing dependencies: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `fast-check`.
  - Install UI utilities: `qrcode.react`, `ulid` (for sortable IDs).
  - Configure `vitest.config.ts` with jsdom environment and path aliases matching `tsconfig.json`.
  - Create the directory skeleton matching the project structure in the design (`app/`, `lib/`, `components/`, `infra/`).
  - Add `.env.local.example` with `ADMIN_SECRET`, `DYNAMODB_TABLE_NAME`, `NEXT_PUBLIC_BASE_URL`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
  - _Requirements: 1.3, 2.1_

- [x] 2. Implement DynamoDB client and typed queries
  - [x] 2.1 Create DynamoDB singleton client
    - Write `lib/db/client.ts` exporting a `DynamoDBDocumentClient` singleton configured from env vars with the SDK v3 `DynamoDBClient` and `fromEnv` credentials.
    - Apply exponential backoff (3 retries, base 100 ms) via the `retryMode: "standard"` client config.
    - _Requirements: 2.1, 7.2_

  - [x] 2.2 Write typed query and mutation functions
    - Write `lib/db/queries.ts` implementing all DynamoDB operations: `getTournamentMeta`, `putTournament`, `getSession`, `putSession`, `putReferee`, `putTeam`, `getCall`, `putCall`, `updateCallAcknowledge` (TransactWriteItems), `updateCallComplete`, `queryUnansweredQueue`, `queryRefereeQueue`, `queryAllTournamentItems`, `listTournaments`, `closeTournament`, `getTournamentState`.
    - Every function must accept and return plain typed objects (no HTTP concerns).
    - Use `PK`/`SK` key patterns from the design: `T#{id}` partition, `META`, `REF#`, `TEAM#`, `CALL#`, `SESSION#` sort keys.
    - Wire GSI1 attributes on put/update for calls as described in the data model.
    - _Requirements: 2.1, 6.4, 6.5, 7.2, 7.4, 8.2, 9.1_

  - [x] 2.3 Write unit tests for query functions (mock DynamoDB client)
    - Test `getTournamentMeta` returns null for missing items.
    - Test `updateCallAcknowledge` maps `TransactionCanceledException` to a typed `AlreadyClaimedError`.
    - Test `getTournamentState` assembles the full response shape correctly from mocked query results.
    - _Requirements: 7.3, 9.1_

- [x] 3. Implement token utilities and Session_Manager
  - [x] 3.1 Implement token utilities in `lib/auth/tokens.ts`
    - Implement `generateToken()` using Node.js `crypto.randomUUID()`.
    - Implement `hashToken(token)` returning `"sha256:" + sha256hex(token)`.
    - Implement `verifyToken(plaintext, stored)` using `timingSafeEqual`.
    - _Requirements: 2.2, 2.3, 15.5_

  - [x] 3.2 Write property test for token non-reversibility (Property 8)
    - // Feature: pool-referee-call-app, Property 8: Session Token Non-Reversibility
    - Use `fc.string()` to generate arbitrary token strings; assert `hashToken(t) !== t` for all inputs.
    - **Property 8: Session Token Non-Reversibility**
    - **Validates: Requirement 15.5**

  - [x] 3.3 Implement Session_Manager in `lib/auth/session.ts`
    - Implement `issueSession(payload, ttlHours?)`: generates a UUID session ID, writes `SESSION#{sessionId}` to DynamoDB, returns a `Set-Cookie` header string (HTTP-only, Secure, SameSite=Lax).
    - Implement `getSession(request)`: extracts `sessionId` from the `Cookie` header, fetches the DynamoDB record, returns `null` if missing or past `expiresAt`.
    - Implement `requireSession(session, tournamentId, allowedRoles)`: throws a typed `AuthError` on mismatch; route handlers map this to 401/403.
    - _Requirements: 4.4, 5.4, 15.1, 15.2, 15.3, 15.4_

  - [x] 3.4 Write unit tests for Session_Manager
    - Test `issueSession` returns a cookie header with `HttpOnly` and `SameSite=Lax` flags.
    - Test `getSession` returns null when `expiresAt` is in the past.
    - Test `requireSession` throws `AuthError` for wrong role and wrong tournament.
    - _Requirements: 15.1, 15.2, 15.3_

- [x] 4. Implement Table_Range_Parser
  - [x] 4.1 Implement `parseTableRange` and `formatTableRange` in `lib/tables/range-parser.ts`
    - Implement `parseTableRange(input: string): ParseResult` following the algorithm in the design: split on commas, handle single numbers and `lo-hi` ranges, deduplicate with a `Set`, sort ascending, return `{ ok: true, tables }` or `{ ok: false, error }`.
    - Implement `formatTableRange(tables: number[]): string` collapsing consecutive integers to `lo-hi` segments.
    - Handle all edge cases: empty input, `"11-11"`, `"18-11"`, `"1a-18"`, overlapping segments.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 2.5, 2.6_

  - [x] 4.2 Write property test for round-trip consistency (Property 1)
    - // Feature: pool-referee-call-app, Property 1: Table Range Parser — Round-Trip
    - Generate sorted unique positive integer arrays with `fc.array(fc.integer({min:1, max:999}), {minLength:1})` (deduplicated and sorted in the test setup); assert `parseTableRange(formatTableRange(L)).tables` deep-equals `L`.
    - **Property 1: Table Range Parser — Round-Trip**
    - **Validates: Requirements 3.1, 3.3, 3.4, 3.5, 3.9**

  - [x] 4.3 Write property test for sorted unique output invariant (Property 2)
    - // Feature: pool-referee-call-app, Property 2: Table Range Parser — Sorted Unique Output Invariant
    - Generate valid table range strings from known-good integer lists; assert every element in the result is strictly greater than the previous.
    - **Property 2: Table Range Parser — Sorted Unique Output Invariant**
    - **Validates: Requirements 3.4, 3.5**

  - [x] 4.4 Write property test for inverted range rejection (Property 3)
    - // Feature: pool-referee-call-app, Property 3: Table Range Parser — Inverted Range Rejection
    - Generate pairs `(a, b)` where `a > b` using `fc.integer` with constraints; assert `parseTableRange("${a}-${b}")` returns `{ ok: false }`.
    - **Property 3: Table Range Parser — Inverted Range Rejection**
    - **Validates: Requirement 3.6**

  - [x] 4.5 Write unit tests for Table_Range_Parser error cases
    - Test empty string → error.
    - Test whitespace-only string → error.
    - Test non-integer characters → error.
    - Test `"11-11"` → `[11]`.
    - Test `"11-18, 11-13"` → deduplicated `[11,12,13,14,15,16,17,18]`.
    - _Requirements: 3.6, 3.7, 3.8_

- [x] 5. Checkpoint — core library layer complete
  - Ensure all tests in `lib/` pass (`vitest --run`). Ask the user if any questions arise before proceeding to domain logic.

- [x] 6. Implement Queue_Position_Calculator
  - [x] 6.1 Implement `assignPositions` and `getTeamPosition` in `lib/queue/position.ts`
    - Implement `assignPositions(queue: QueueEntry[]): PositionedQueueEntry[]`: sort by `acknowledgedAt` ascending, map to `{ ...entry, position: index + 1 }`.
    - Implement `getTeamPosition(queue: PositionedQueueEntry[], teamId: string): number | null`.
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 10.2, 10.3_

  - [x] 6.2 Write property test for queue position contiguity invariant (Property 6)
    - // Feature: pool-referee-call-app, Property 6: Queue Position Contiguity Invariant
    - Generate arrays of `QueueEntry` objects with `fc.array`; run `assignPositions` and assert the resulting `position` values equal `{1, ..., N}`.
    - **Property 6: Queue Position Contiguity Invariant**
    - **Validates: Requirements 16.1, 16.2, 16.3**

  - [x] 6.3 Write property test for position after removal metamorphic property (Property 7)
    - // Feature: pool-referee-call-app, Property 7: Queue Position After Removal — Metamorphic Property
    - Generate a queue of N entries; pick a random index K to remove; run `assignPositions` on the remaining N-1 entries and assert positions equal `{1, ..., N-1}` with all previously-higher entries decremented by 1.
    - **Property 7: Queue Position After Removal — Metamorphic Property**
    - **Validates: Requirements 16.4, 10.2, 10.3**

- [x] 7. Implement Call_Manager
  - [x] 7.1 Define typed error classes in `lib/calls/errors.ts`
    - Create `TournamentClosedError`, `InvalidTableError`, `MaxCallsError`, `AlreadyClaimedError`, `CallNotFoundError`, `WrongRefereeError`, `WrongStatusError` — each extending `Error` with a typed `code` discriminant.
    - _Requirements: 6.7, 7.5, 7.6, 8.3, 8.4, 13.2, 13.4_

  - [x] 7.2 Implement `createCall` in `lib/calls/manager.ts`
    - Verify tournament is active; verify `tableNumber` is in `tournament.tableNumbers`; count team's active calls via GSI1 queries; reject with `MaxCallsError` if count ≥ 2; write `CALL#{callId}` with `status=unanswered` and GSI1 unanswered attributes.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 17.1, 17.2_

  - [x] 7.3 Write property test for max active calls invariant (Property 4)
    - // Feature: pool-referee-call-app, Property 4: Max Active Calls Invariant
    - Simulate arbitrary sequences of `createCall` attempts for a single team using an in-memory DynamoDB mock; assert the count of active calls never exceeds 2 at any simulated state.
    - **Property 4: Max Active Calls Invariant**
    - **Validates: Requirements 6.3, 17.4**

  - [x] 7.4 Implement `acknowledgeCall` in `lib/calls/manager.ts`
    - Verify tournament is active; verify call exists and belongs to tournament; execute `TransactWriteItems` with `status = "unanswered"` condition; on `TransactionCanceledException(ConditionalCheckFailed)` throw `AlreadyClaimedError`; update GSI1 to referee partition.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 7.5 Write property test for atomic acknowledgement (Property 5)
    - // Feature: pool-referee-call-app, Property 5: Atomic Acknowledgement — Exactly-One Confluence
    - Use `fc.integer({min:2, max:10})` to generate N; simulate N concurrent acknowledge requests against a shared in-memory call record; assert exactly 1 success and N-1 `AlreadyClaimedError` throws regardless of interleaving order.
    - **Property 5: Atomic Acknowledgement — Exactly-One Confluence**
    - **Validates: Requirements 7.2, 7.3**

  - [x] 7.6 Implement `completeCall` in `lib/calls/manager.ts`
    - Verify tournament is active; verify referee ownership; `UpdateItem` with `status=acknowledged AND refereeId=:refId` condition; set `status=completed`, `completedAt=now()`; remove GSI1 attributes.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 7.7 Write unit tests for Call_Manager
    - Test `createCall` rejects invalid table numbers (HTTP 400 mapping).
    - Test `createCall` returns `MaxCallsError` when active count = 2.
    - Test `acknowledgeCall` maps `TransactionCanceledException` → `AlreadyClaimedError`.
    - Test `completeCall` returns `WrongRefereeError` when refereeId mismatches.
    - Test all three functions return `TournamentClosedError` when tournament status is `closed`.
    - _Requirements: 6.2, 6.3, 7.3, 8.3, 13.2, 13.4_

- [x] 8. Checkpoint — domain logic complete
  - Run `vitest --run`. All domain layer tests must pass. Ask the user if questions arise before building API routes.

- [x] 9. Implement API route handlers
  - [x] 9.1 Implement `POST /api/admin/tournaments` and `GET /api/admin/tournaments`
    - Write `app/api/admin/tournaments/route.ts`.
    - `POST`: validate `Authorization: Bearer <ADMIN_SECRET>` header; parse and validate request body (`name`, `tableRange`); call `parseTableRange`; generate three UUIDs via `generateToken()`; hash all three with `hashToken()`; write tournament record to DynamoDB; return 201 with plaintext tokens (never stored).
    - `GET`: validate `ADMIN_SECRET`; query all tournaments; return array of summaries (no tokens).
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8_

  - [x] 9.2 Implement `POST /api/tournaments/[id]/join/referee` and `POST /api/tournaments/[id]/join/player`
    - Write `app/api/tournaments/[id]/join/referee/route.ts` and `.../player/route.ts`.
    - Validate token from request body against stored hash; reject empty names; write `REF#` or `TEAM#` record; call `issueSession`; set `Set-Cookie` header; return 200 with `refereeId`/`teamId`.
    - Return 403 with closed message if tournament status is `closed`.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 13.3_

  - [x] 9.3 Implement `POST /api/tournaments/[id]/calls`
    - Write `app/api/tournaments/[id]/calls/route.ts`.
    - Call `getSession` → `requireSession` (role: player); call `createCall`; map domain errors to HTTP status codes (400, 401, 403, 429); return 201.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 9.4 Implement `POST /api/calls/[callId]/acknowledge` and `POST /api/calls/[callId]/complete`
    - Write `app/api/calls/[callId]/acknowledge/route.ts` and `.../complete/route.ts`.
    - Validate referee session; call `acknowledgeCall` / `completeCall`; map errors → 401, 403, 409; return 200 with updated call record.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.1, 8.2, 8.3, 8.4, 8.5, 13.4_

  - [x] 9.5 Implement `GET /api/tournaments/[id]/state`
    - Write `app/api/tournaments/[id]/state/route.ts`.
    - Validate any valid session for the tournament; call `getTournamentState` from `lib/db/queries.ts`; return 200 with `TournamentStateResponse`; include `lastUpdatedAt`.
    - _Requirements: 9.1, 9.2, 9.6_

  - [x] 9.6 Implement `POST /api/tournaments/[id]/close` and `GET /api/tournaments/[id]/archive`
    - Write `app/api/tournaments/[id]/close/route.ts`: validate `adminToken` from body or header; update tournament `status` to `closed`; return 200.
    - Write `app/api/tournaments/[id]/archive/route.ts`: validate `adminToken`; assert `status = closed` (else 403); return all CALL#, REF#, TEAM# records.
    - _Requirements: 13.1, 13.5, 14.1, 14.2, 14.4, 14.5_

  - [x] 9.7 Write property test for closed tournament mutation rejection (Property 9)
    - // Feature: pool-referee-call-app, Property 9: Closed Tournament Mutation Rejection
    - Use `fc.constantFrom` to pick from all mutating route handlers; for each, assert that when the tournament record has `status = "closed"`, the handler returns a non-2xx status regardless of otherwise-valid session and body.
    - **Property 9: Closed Tournament Mutation Rejection**
    - **Validates: Requirements 13.2, 13.3, 13.4**

  - [x] 9.8 Write unit tests for API route handlers
    - Test each route handler's happy path and every documented error branch (400, 401, 403, 409, 429).
    - Verify raw DynamoDB errors and stack traces are never included in response bodies.
    - _Requirements: 1.2, 6.6, 7.5, 8.3, 8.4, 13.5, 14.5, 20.4_

- [x] 10. Checkpoint — API layer complete
  - Run `vitest --run`. All route handler tests must pass. Ask the user if questions arise before building UI.

- [x] 11. Implement shared UI utilities and polling hook
  - Create `lib/hooks/usePolling.ts`: a custom React hook that calls a fetch function on a configurable interval (default 3 s), tracks `consecutiveErrorCount`, shows a banner after 3 consecutive failures, and continues polling without crashing.
  - Create `lib/utils/time.ts`: `elapsedSeconds(isoTimestamp: string): number` utility used by call cards.
  - Create `lib/utils/errors.ts`: `extractUserMessage(response: Response): Promise<string>` — reads JSON body `message` field, never exposes raw errors.
  - _Requirements: 9.3, 9.4, 9.5, 20.4, 20.5_

- [x] 12. Implement Admin UI
  - [x] 12.1 Implement `<CreateTournamentForm />` component
    - Write `components/admin/CreateTournamentForm.tsx`: controlled form with `name` input and `tableRange` input; call `parseTableRange` client-side for live preview of expanded table numbers; submit to `POST /api/admin/tournaments`; display the returned tokens and join links (shown once).
    - _Requirements: 2.7, 3.1–3.9, 18.1, 18.4_

  - [x] 12.2 Implement `<TournamentList />` component
    - Write `components/admin/TournamentList.tsx`: fetches `GET /api/admin/tournaments`; renders tournament name, status, and a link to the tournament admin dashboard.
    - _Requirements: 2.8, 12.5_

  - [x] 12.3 Implement `<JoinLinks />` component
    - Write `components/admin/JoinLinks.tsx`: displays full absolute referee and player join URLs; one-click copy via `navigator.clipboard.writeText`; renders `<QRCodeSVG>` from `qrcode.react` for each link.
    - _Requirements: 18.1, 18.2, 18.3, 18.4_

  - [x] 12.4 Implement `<QueueBoard />` and `<RefereeQueues />` components
    - Write `components/admin/QueueBoard.tsx`: three-column layout on ≥ 1024 px (unanswered queue | referee queues | recent activity); single-column on mobile.
    - Write `components/admin/RefereeQueues.tsx`: renders each referee's queue from `refereeQueues` in the polling state.
    - Recent activity: last 20 completed/acknowledged calls sorted by `completedAt` descending.
    - _Requirements: 12.1, 12.2_

  - [x] 12.5 Implement Global Admin page and Tournament Admin Dashboard page
    - Write `app/admin/page.tsx`: ADMIN_SECRET gate (redirect to login if not set in cookie/header); render `<CreateTournamentForm />` and `<TournamentList />`.
    - Write `app/admin/[id]/page.tsx`: server component fetches tournament meta; renders `<QueueBoard />`, `<JoinLinks />`, tournament name/status, and "Close Tournament" button with confirmation step; polls via `usePolling` at ≤ 4 s.
    - _Requirements: 1.1, 1.2, 12.3, 12.4, 12.5, 9.5_

  - [x] 12.6 Implement tournament archive page
    - Write `app/t/[id]/archive/page.tsx`: fetch `GET /api/tournaments/[id]/archive`; render read-only table of all calls with required fields; no action buttons.
    - _Requirements: 14.2, 14.3_

- [x] 13. Implement Referee UI
  - [x] 13.1 Implement `<StickyHeader />` component
    - Write `components/referee/StickyHeader.tsx`: displays count badges for unanswered calls and the referee's personal queue count; sticks to top of viewport.
    - _Requirements: 11.6_

  - [x] 13.2 Implement `<CallCard />` component
    - Write `components/referee/CallCard.tsx`: displays table number, team name, elapsed ticking time (re-computed each render from `createdAt` or `acknowledgedAt`).
    - "Acknowledge" button (New Calls tab) triggers `POST /api/calls/[callId]/acknowledge`; "Mark Complete" button (My Queue tab) triggers `POST /api/calls/[callId]/complete`.
    - Disabled + spinner while request is in flight; re-enables on response; shows error toast on failure.
    - Minimum 44×44 px tap targets.
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 19.3, 20.4_

  - [x] 13.3 Implement `<QueueTabs />` component
    - Write `components/referee/QueueTabs.tsx`: two tabs "New Calls" and "My Queue"; renders `<CallCard />` per item; empty-state messages for each tab.
    - _Requirements: 11.1, 20.1, 20.2_

  - [x] 13.4 Implement Referee main page
    - Write `app/t/[id]/referee/page.tsx`: server component validates session on load; client component polls `GET /api/tournaments/[id]/state` at ≤ 4 s via `usePolling`; renders `<StickyHeader />` and `<QueueTabs />`; shows connection-issue banner on 3 consecutive polling errors.
    - _Requirements: 9.4, 11.1, 19.1, 19.3, 20.5_

- [x] 14. Implement Player UI
  - [x] 14.1 Implement `<CallForm />` component
    - Write `components/player/CallForm.tsx`: `<select>` populated from `tournament.tableNumbers` (minimum 44×44 px); disabled + explanatory message when active call count ≥ 2; on submit, `POST /api/tournaments/[id]/calls` with optimistic local state append; reverts on error.
    - _Requirements: 6.8, 17.3, 19.4, 20.4_

  - [x] 14.2 Implement `<MyCallsList />` component
    - Write `components/player/MyCallsList.tsx`: renders `myCalls` from the polling state; per call: table number, status badge, referee name if acknowledged, queue position string from `getTeamPosition`; displays `lastUpdatedAt` timestamp; empty-state message.
    - Status display logic: `unanswered` → "Waiting for referee..."; `acknowledged` + position > 1 → "Acknowledged by {refereeName} — you are #N in queue"; `acknowledged` + position = 1 → "{refereeName} is on their way"; `completed` → remove from list.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 9.7, 20.3_

  - [x] 14.3 Implement Player main page
    - Write `app/t/[id]/player/page.tsx`: validates session on load; polls `GET /api/tournaments/[id]/state` at ≤ 4 s; renders `<CallForm />` and `<MyCallsList />`; shows connection-issue banner on 3 consecutive errors.
    - _Requirements: 9.3, 19.2, 19.4, 20.5_

- [x] 15. Implement join pages
  - Write `app/join/referee/[token]/page.tsx`: server component fetches tournament by token (hash lookup); renders error page on invalid token; renders closed message if tournament is `closed`; renders name-entry form that posts to `/api/tournaments/[id]/join/referee`; redirects to `/t/[id]/referee` on success.
  - Write `app/join/player/[token]/page.tsx`: same pattern for player join, posting to `/api/tournaments/[id]/join/player`, redirecting to `/t/[id]/player`.
  - Both pages must meet 44×44 px tap targets and 320 px minimum viewport.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 19.1, 19.2_

- [x] 16. Checkpoint — UI complete
  - Run `vitest --run`. All component snapshot and interaction tests must pass. Ask the user if questions arise before deployment config.

- [x] 17. Configure AWS Amplify and deployment artifacts
  - Write `amplify.yml` with build commands (`npm ci`, `npm run build`), environment variable forwarding, and Next.js SSR output config.
  - Write `infra/dynamodb.ts` as an optional AWS CDK stack that provisions the `RefereeCallApp` DynamoDB table with `PK`/`SK` keys, GSI1 (`GSI1PK`/`GSI1SK`, project ALL), and on-demand billing.
  - Add `README.md` deployment section documenting: Amplify app setup, required environment variables, how to provision the DynamoDB table (CDK or manual console), and how to rotate the `ADMIN_SECRET`.
  - _Requirements: 2.1, 15.3_

- [x] 18. Write integration tests
  - [x] 18.1 Write round-trip integration test
    - Test the full happy path using a local DynamoDB-local or mocked client: create tournament → join as referee → join as player → create call → acknowledge → complete; assert DynamoDB item state at each step.
    - _Requirements: 2.1, 4.4, 5.4, 6.4, 7.2, 8.2_

  - [x] 18.2 Write concurrent acknowledge integration test
    - Simulate two simultaneous `acknowledgeCall` invocations for the same call against an in-memory transactional DynamoDB mock; assert exactly one 200 and one 409.
    - _Requirements: 7.3_

- [x] 19. Final checkpoint — all tests pass
  - Run `vitest --run`. All tests (unit, property, integration) must pass with zero failures. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP.
- Each task references specific requirements for traceability.
- Checkpoints at tasks 5, 8, 10, 16, and 19 ensure incremental validation.
- Property tests use `fast-check` with `numRuns: 100` minimum; each `fc.assert` call maps to exactly one correctness property from the design document.
- Unit tests validate specific examples and edge cases; property tests validate universal invariants.
- The `ADMIN_SECRET` environment variable must never appear in client bundles — always read it server-side only.
- Tokens are returned plaintext in the tournament creation response exactly once; only SHA-256 hashes are stored in DynamoDB.
