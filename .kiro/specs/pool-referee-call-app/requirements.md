# Requirements Document

## Introduction

The Pool Tournament Referee Call App is a mobile-responsive web application for managing referee calls at pool tournaments. It eliminates verbal shouting and manual tracking by providing a digital call queue system where players request referees at specific tables, referees acknowledge and fulfill those requests, and admins manage the tournament lifecycle. The system uses magic-link join URLs (no passwords), supports up to 2 simultaneous active calls per team, and archives all data as read-only once a tournament is closed.

## Glossary

- **Admin**: A tournament organizer with full control over tournament creation, configuration, and closure.
- **Referee**: A tournament official who receives, acknowledges, and fulfills referee calls at pool tables.
- **Player**: A team captain or player representative who submits referee calls on behalf of their team.
- **Tournament**: A configured pool competition with a set of active table numbers, join tokens, and a lifecycle status.
- **Call**: A request by a player for a referee to attend a specific pool table.
- **Table Range**: An admin-defined expression (e.g., `11-18, 29-36`) that expands to a sorted list of valid table numbers for a tournament.
- **Queue**: The ordered list of unanswered or in-progress calls visible to referees.
- **Session**: A server-issued HTTP-only cookie that authenticates a user's role and tournament membership after joining via a magic link.
- **adminToken**: The URL token granting admin access to a specific tournament dashboard.
- **refereeToken**: The URL token used by a referee to join a tournament.
- **playerToken**: The URL token used by a player to join a tournament.
- **ADMIN_SECRET**: A global environment variable that gates access to the `/admin` tournament creation interface.
- **Table_Range_Parser**: The server-side component that parses admin-entered table range strings into sorted unique lists of table numbers.
- **Queue_Position_Calculator**: The server-side component that determines a team's numeric position in a referee's active queue.
- **Call_Manager**: The server-side component that enforces call creation rules, processes acknowledgements atomically, and marks calls complete.
- **Session_Manager**: The server-side component that issues and validates HTTP-only session cookies.
- **State_Endpoint**: The polling API endpoint that returns the current tournament state to all active clients.
- **Archive**: The read-only historical record of a closed tournament's calls, referees, and teams.
- **GSI1**: The DynamoDB Global Secondary Index used to efficiently query unanswered and per-referee call queues.

---

## Requirements

### Requirement 1: Global Admin Authentication

**User Story:** As a global administrator, I want to access the tournament creation interface using a shared secret, so that only authorized operators can create new tournaments.

#### Acceptance Criteria

1. THE Admin_Interface SHALL require a valid `ADMIN_SECRET` environment variable value to be presented before granting access to `/admin`.
2. IF an invalid or missing `ADMIN_SECRET` is provided to `/admin`, THEN THE Admin_Interface SHALL return an HTTP 401 response and deny access.
3. THE Admin_Interface SHALL store the `ADMIN_SECRET` exclusively as a server-side environment variable and SHALL NOT expose it in any client-side code or API response.

---

### Requirement 2: Tournament Creation

**User Story:** As a global administrator, I want to create a tournament with a name and table ranges, so that I can configure a session for an upcoming pool event.

#### Acceptance Criteria

1. WHEN a valid tournament creation request is submitted to `POST /api/admin/tournaments`, THE Admin_Interface SHALL create a tournament record with a unique `tournamentId`, a `name`, a `status` of `active`, and a `createdAt` timestamp.
2. WHEN a tournament is created, THE Admin_Interface SHALL generate three cryptographically unguessable UUID tokens: one `adminToken`, one `refereeToken`, and one `playerToken`.
3. WHEN a tournament is created, THE Admin_Interface SHALL store only the hashed values of the three tokens in the tournament record.
4. THE Admin_Interface SHALL return the three plaintext tokens to the global admin exactly once, in the creation response.
5. WHEN a tournament creation request includes a table range string, THE Table_Range_Parser SHALL expand the string into a sorted list of unique integer table numbers and store the result on the tournament record.
6. IF a table range string contains an invalid format, THEN THE Table_Range_Parser SHALL return a descriptive error message and reject the tournament creation request.
7. THE Admin_Interface SHALL provide a live preview of the expanded table number list as the admin types the table range string, before submitting the form.
8. THE Admin_Interface SHALL list all tournaments when a valid GET request is made to `GET /api/admin/tournaments`.

---

### Requirement 3: Table Range Parsing

**User Story:** As a global administrator, I want to enter table ranges using a compact notation like `11-18, 29-36`, so that I don't have to list every table number individually.

#### Acceptance Criteria

1. WHEN a range segment (e.g., `11-18`) is parsed, THE Table_Range_Parser SHALL expand it into all integers from the lower bound to the upper bound inclusive.
2. WHEN a single number segment (e.g., `29`) is parsed, THE Table_Range_Parser SHALL include that integer as-is.
3. WHEN a table range string contains multiple comma-separated segments, THE Table_Range_Parser SHALL parse each segment independently and combine the results.
4. THE Table_Range_Parser SHALL deduplicate the combined result so that each table number appears exactly once.
5. THE Table_Range_Parser SHALL sort the final list of table numbers in ascending order.
6. IF a range segment has a lower bound greater than its upper bound (e.g., `18-11`), THEN THE Table_Range_Parser SHALL return a descriptive validation error.
7. IF a table range string is empty or contains only whitespace, THEN THE Table_Range_Parser SHALL return a descriptive validation error.
8. IF a segment contains non-integer characters (e.g., `1a-18`), THEN THE Table_Range_Parser SHALL return a descriptive validation error.
9. FOR ALL valid table range strings, parsing the string SHALL produce a non-empty sorted list of unique integers (round-trip invariant: re-formatting the list back to a canonical range string and re-parsing SHALL produce the same sorted unique list).

---

### Requirement 4: Magic-Link Join — Referee

**User Story:** As a referee, I want to join a tournament by following a shared link and entering my name, so that I can start receiving referee calls without needing an account.

#### Acceptance Criteria

1. WHEN a referee navigates to `/join/referee/[token]`, THE Session_Manager SHALL validate the token against the stored hash for the tournament's `refereeToken`.
2. IF the token is invalid or does not match any tournament, THEN THE Session_Manager SHALL display an error page and deny access.
3. IF the associated tournament has a `status` of `closed`, THEN THE Session_Manager SHALL display a message indicating the tournament is closed and deny join access.
4. WHEN a referee submits a non-empty display name on the join screen, THE Session_Manager SHALL create a `REF#{refereeId}` record in DynamoDB and issue an HTTP-only `sessionId` cookie tied to that record with `role = referee`.
5. WHEN a valid referee session cookie is issued, THE Session_Manager SHALL redirect the referee to `/t/[id]/referee`.
6. THE Session_Manager SHALL reject session requests where the display name is empty or contains only whitespace.

---

### Requirement 5: Magic-Link Join — Player

**User Story:** As a player captain, I want to join a tournament by following a shared link and entering my team name, so that I can submit referee calls on behalf of my team.

#### Acceptance Criteria

1. WHEN a player navigates to `/join/player/[token]`, THE Session_Manager SHALL validate the token against the stored hash for the tournament's `playerToken`.
2. IF the token is invalid or does not match any tournament, THEN THE Session_Manager SHALL display an error page and deny access.
3. IF the associated tournament has a `status` of `closed`, THEN THE Session_Manager SHALL display a message indicating the tournament is closed and deny join access.
4. WHEN a player submits a non-empty team name on the join screen, THE Session_Manager SHALL create a `TEAM#{teamId}` record in DynamoDB and issue an HTTP-only `sessionId` cookie tied to that record with `role = player`.
5. WHEN a valid player session cookie is issued, THE Session_Manager SHALL redirect the player to `/t/[id]/player`.
6. THE Session_Manager SHALL reject session requests where the team name is empty or contains only whitespace.

---

### Requirement 6: Referee Call Creation

**User Story:** As a player captain, I want to select a table number and submit a referee call, so that a referee is notified to attend my table.

#### Acceptance Criteria

1. WHEN a player submits a call to `POST /api/tournaments/[id]/calls`, THE Call_Manager SHALL validate that the session cookie corresponds to a valid player session for the specified tournament.
2. WHEN a player submits a call, THE Call_Manager SHALL validate that the selected `tableNumber` is in the tournament's configured list of table numbers.
3. WHEN a player submits a call, THE Call_Manager SHALL count the team's calls where `status` is `unanswered` or `acknowledged`, and reject the request with an HTTP 429 response if the count is greater than or equal to 2.
4. WHEN a call is accepted, THE Call_Manager SHALL create a `CALL#{callId}` record with `status = unanswered`, the `teamId`, `teamName`, `tableNumber`, and a `createdAt` timestamp.
5. WHEN a call is created, THE Call_Manager SHALL write the GSI1 attributes so the call appears in the unanswered queue (`GSI1PK = T#{id}#UNANSWERED`, `GSI1SK = createdAt`).
6. IF the player's session cookie is missing, expired, or invalid, THEN THE Call_Manager SHALL return an HTTP 401 response.
7. IF the tournament `status` is `closed`, THEN THE Call_Manager SHALL return an HTTP 403 response and reject the call.
8. THE Player_UI SHALL display a dropdown containing only the table numbers configured for the tournament.

---

### Requirement 7: Call Acknowledgement (Atomic Claim)

**User Story:** As a referee, I want to acknowledge a call so that the player knows I am on my way and other referees do not duplicate my response.

#### Acceptance Criteria

1. WHEN a referee submits an acknowledge request to `POST /api/calls/[callId]/acknowledge`, THE Call_Manager SHALL validate that the session cookie corresponds to a valid referee session for the tournament owning the call.
2. THE Call_Manager SHALL execute a `TransactWriteItems` operation that atomically updates the call record from `status = unanswered` to `status = acknowledged`, setting `refereeId`, `refereeName`, and `acknowledgedAt`, conditioned on `status = unanswered`.
3. IF two referees simultaneously attempt to acknowledge the same call, THEN THE Call_Manager SHALL ensure exactly one succeeds and the other receives an HTTP 409 response.
4. WHEN acknowledgement succeeds, THE Call_Manager SHALL update the call's GSI1 attributes so the call appears in the acknowledging referee's per-referee queue (`GSI1PK = T#{id}#REF#{refId}`, `GSI1SK = acknowledgedAt`).
5. IF the call is already acknowledged or completed, THEN THE Call_Manager SHALL return an HTTP 409 response to the requesting referee.
6. IF the tournament `status` is `closed`, THEN THE Call_Manager SHALL return an HTTP 403 response.

---

### Requirement 8: Call Completion

**User Story:** As a referee, I want to mark a call as complete after attending the table, so that the queue is updated and the player is informed.

#### Acceptance Criteria

1. WHEN a referee submits a complete request to `POST /api/calls/[callId]/complete`, THE Call_Manager SHALL validate that the session cookie corresponds to the referee who acknowledged the call.
2. THE Call_Manager SHALL update the call record `status` from `acknowledged` to `completed` and set `completedAt`.
3. IF the requesting referee did not acknowledge the call (i.e., `refereeId` does not match), THEN THE Call_Manager SHALL return an HTTP 403 response.
4. IF the call `status` is not `acknowledged`, THEN THE Call_Manager SHALL return an HTTP 409 response.
5. WHEN a call is marked complete, THE Call_Manager SHALL remove it from the per-referee active queue visible to other clients within the next polling cycle.

---

### Requirement 9: Tournament State Polling

**User Story:** As a referee, player, or admin, I want the displayed queue to refresh automatically, so that I see up-to-date call statuses without manually reloading the page.

#### Acceptance Criteria

1. THE State_Endpoint SHALL respond to `GET /api/tournaments/[id]/state` with the current unanswered call queue, all per-referee queues, and the requesting session's own calls.
2. THE State_Endpoint SHALL require a valid session cookie for the tournament; IF the cookie is missing or invalid, THEN THE State_Endpoint SHALL return an HTTP 401 response.
3. THE Player_UI SHALL poll `GET /api/tournaments/[id]/state` at an interval of no more than 4 seconds while the player view is active.
4. THE Referee_UI SHALL poll `GET /api/tournaments/[id]/state` at an interval of no more than 4 seconds while the referee view is active.
5. THE Admin_UI SHALL poll `GET /api/tournaments/[id]/state` at an interval of no more than 4 seconds while the admin dashboard is active.
6. THE State_Endpoint SHALL include a server-generated `lastUpdatedAt` ISO 8601 timestamp in every response.
7. THE Player_UI SHALL display the `lastUpdatedAt` timestamp so players can verify data freshness.

---

### Requirement 10: Player Call Status Display

**User Story:** As a player captain, I want to see the current status of my submitted calls and my position in the referee's queue, so that I know what to expect.

#### Acceptance Criteria

1. WHEN a call has `status = unanswered`, THE Player_UI SHALL display the message `Waiting for referee...` for that call.
2. WHEN a call has `status = acknowledged` and the team is not first in the acknowledging referee's queue, THE Queue_Position_Calculator SHALL compute the team's position N, and THE Player_UI SHALL display `Acknowledged by {refereeName} — you are #N in queue`.
3. WHEN a call has `status = acknowledged` and the team is first in the acknowledging referee's queue, THE Player_UI SHALL display `{refereeName} is on their way`.
4. WHEN a call has `status = completed`, THE Player_UI SHALL remove that call from the active calls list.
5. THE Player_UI SHALL display all active calls (status `unanswered` or `acknowledged`) for the current team on the player home screen.

---

### Requirement 11: Referee UI

**User Story:** As a referee, I want a clear mobile-optimized interface showing new calls and my personal queue, so that I can efficiently manage my workload.

#### Acceptance Criteria

1. THE Referee_UI SHALL display two tabs: "New Calls" showing all `unanswered` calls, and "My Queue" showing calls the referee has acknowledged, ordered by `acknowledgedAt` ascending.
2. THE Referee_UI SHALL display each call card with: the table number, the team name, and the elapsed time since `createdAt` (for unanswered calls) or since `acknowledgedAt` (for acknowledged calls).
3. THE Referee_UI SHALL provide an "Acknowledge" action button on each unanswered call card.
4. THE Referee_UI SHALL provide a "Mark Complete" action button on each acknowledged call card in the referee's queue.
5. THE Referee_UI SHALL use tap targets of at least 44×44 CSS pixels for all interactive controls.
6. THE Referee_UI SHALL display a sticky header showing the count of unanswered calls and the count of calls in the referee's personal queue.

---

### Requirement 12: Admin Dashboard

**User Story:** As a tournament admin, I want a dashboard showing all queues and recent activity, so that I can monitor the tournament in real time.

#### Acceptance Criteria

1. THE Admin_UI SHALL display the unanswered call queue, all referee queues, and a recent activity log on the tournament dashboard.
2. WHEN the viewport width is 1024 CSS pixels or greater, THE Admin_UI SHALL display the unanswered queue, referee queues, and recent activity in a three-column layout.
3. THE Admin_UI SHALL display copyable join link URLs for the referee token and the player token.
4. THE Admin_UI SHALL provide a "Close Tournament" button that requires an explicit confirmation step before submitting the close request.
5. THE Admin_UI SHALL show the tournament name and current `status` prominently on the dashboard.

---

### Requirement 13: Tournament Closure

**User Story:** As a tournament admin, I want to close the tournament when play has ended, so that no new calls or joins are accepted and the data is preserved for review.

#### Acceptance Criteria

1. WHEN an admin submits a valid close request to `POST /api/tournaments/[id]/close` with the `adminToken`, THE Admin_Interface SHALL update the tournament `status` from `active` to `closed`.
2. WHEN a tournament `status` is `closed`, THE Call_Manager SHALL reject all new call creation requests with HTTP 403.
3. WHEN a tournament `status` is `closed`, THE Session_Manager SHALL reject all new join requests (referee and player) with a message indicating the tournament is closed.
4. WHEN a tournament `status` is `closed`, THE Call_Manager SHALL reject all acknowledge and complete requests with HTTP 403.
5. IF the close request does not include a valid `adminToken`, THEN THE Admin_Interface SHALL return an HTTP 401 response.

---

### Requirement 14: Archive and History

**User Story:** As a tournament admin, I want to view a read-only archive of a closed tournament, so that I can review results and call history after the event.

#### Acceptance Criteria

1. WHEN an admin requests `GET /api/tournaments/[id]/archive` with a valid `adminToken`, THE Admin_Interface SHALL return all call records, referee records, and team records for the tournament in a read-only format.
2. THE Archive SHALL include for each call: `callId`, `teamName`, `tableNumber`, `status`, `refereeName` (if acknowledged), `createdAt`, `acknowledgedAt` (if present), and `completedAt` (if present).
3. THE Admin_UI SHALL display the archive as a read-only view with no action buttons.
4. IF the tournament `status` is `active`, THEN THE Admin_Interface SHALL return an HTTP 403 response to archive requests.
5. IF the `adminToken` is invalid, THEN THE Admin_Interface SHALL return an HTTP 401 response.

---

### Requirement 15: Session Security and Expiry

**User Story:** As a system operator, I want session cookies to be secure and time-limited, so that stale or compromised sessions cannot be reused indefinitely.

#### Acceptance Criteria

1. THE Session_Manager SHALL issue sessions as HTTP-only cookies that are not accessible to client-side JavaScript.
2. THE Session_Manager SHALL store each session as a `SESSION#{sessionId}` record in DynamoDB with an `expiresAt` attribute.
3. WHEN a session record is past its `expiresAt` time, THE Session_Manager SHALL treat it as invalid and return an HTTP 401 response.
4. THE Session_Manager SHALL include session records' `role`, `tournamentId`, `displayName`, and optionally `teamId` or `refereeId` in the DynamoDB session record.
5. THE Session_Manager SHALL NOT store or log the plaintext token values after hashing them at tournament creation time.

---

### Requirement 16: Queue Position Calculation

**User Story:** As a player captain, I want to know my numeric position in a referee's queue, so that I can estimate how long I will need to wait.

#### Acceptance Criteria

1. WHEN computing a team's queue position, THE Queue_Position_Calculator SHALL query the per-referee queue ordered by `acknowledgedAt` ascending and count the number of calls ahead of the team's call.
2. THE Queue_Position_Calculator SHALL return position 1 when the team's call is the first item in the referee's queue.
3. FOR ALL referee queues, the sequence of position values assigned to calls SHALL be contiguous positive integers starting from 1 with no gaps or duplicates (position invariant).
4. WHEN a call ahead in the queue is marked complete and removed, THE Queue_Position_Calculator SHALL recalculate all subsequent positions so that positions remain contiguous.

---

### Requirement 17: Max Active Calls Enforcement

**User Story:** As a system operator, I want to prevent teams from flooding the queue with excessive calls, so that referee bandwidth is fairly distributed.

#### Acceptance Criteria

1. WHEN a player attempts to create a call, THE Call_Manager SHALL query all calls for the team with `status` of `unanswered` or `acknowledged`.
2. IF the count of active calls for the team is 2 or greater, THEN THE Call_Manager SHALL reject the new call with an HTTP 429 response and a message stating the maximum active call limit has been reached.
3. THE Player_UI SHALL disable the call submission button and display an explanatory message when the team already has 2 active calls.
4. FOR ALL teams, at no point in time SHALL a team have more than 2 calls simultaneously in `unanswered` or `acknowledged` status (max-calls invariant).

---

### Requirement 18: Join Link Distribution

**User Story:** As a tournament admin, I want easy-to-copy join URLs including QR codes, so that I can quickly distribute access to referees and players at the venue.

#### Acceptance Criteria

1. THE Admin_UI SHALL display the full absolute URL for the referee join link and the player join link.
2. THE Admin_UI SHALL provide a one-click copy-to-clipboard action for each join link.
3. WHERE a QR code generation library is available, THE Admin_UI SHALL render a scannable QR code for each join link.
4. THE Admin_UI SHALL display the join links on the tournament dashboard immediately after tournament creation.

---

### Requirement 19: Responsive and Accessible Design

**User Story:** As a referee or player, I want the app to work well on a mobile phone at a pool venue, so that I can use it comfortably under real-world conditions.

#### Acceptance Criteria

1. THE Referee_UI SHALL be designed mobile-first with a minimum supported viewport width of 320 CSS pixels.
2. THE Player_UI SHALL be designed mobile-first with a minimum supported viewport width of 320 CSS pixels.
3. THE Referee_UI SHALL use tap targets of at least 44×44 CSS pixels for all interactive controls.
4. THE Player_UI SHALL use tap targets of at least 44×44 CSS pixels for all interactive controls.
5. THE Referee_UI and THE Player_UI SHALL maintain a color contrast ratio of at least 4.5:1 for normal text against their backgrounds, in accordance with WCAG 2.1 AA.

---

### Requirement 20: Error and Empty States

**User Story:** As any user of the app, I want clear feedback when something goes wrong or there is no data to show, so that I am not left confused by a blank screen.

#### Acceptance Criteria

1. WHEN the unanswered queue is empty, THE Referee_UI SHALL display a message indicating there are no pending calls.
2. WHEN a referee's personal queue is empty, THE Referee_UI SHALL display a message indicating there are no acknowledged calls.
3. WHEN a player has no active calls, THE Player_UI SHALL display a message prompting the player to submit a call.
4. WHEN an API request fails, THE Referee_UI and THE Player_UI SHALL display a user-readable error message and SHALL NOT display raw error objects or stack traces.
5. WHEN a network error occurs during polling, THE State_Endpoint client SHALL continue polling and SHALL indicate the connection issue to the user without crashing the page.

---

## Correctness Properties for Property-Based Testing

### P1: Table Range Parser — Round-Trip Property

For all valid table range strings S, let L = parse(S). Formatting L back to a canonical comma-separated range string and parsing again SHALL produce a list equal to L.

- **Type**: Round-trip
- **Component**: Table_Range_Parser
- **Rationale**: Parsers are tricky to get right; round-trip testing catches off-by-one errors in range expansion and deduplication.

### P2: Table Range Parser — Sorted Unique Invariant

For all valid table range strings S, every list L = parse(S) SHALL be strictly monotonically increasing (each element greater than the previous), ensuring both sort order and uniqueness.

- **Type**: Invariant
- **Component**: Table_Range_Parser
- **Rationale**: Deduplication and sorting must both hold simultaneously for downstream table selection to be correct.

### P3: Table Range Parser — Non-Empty Result Invariant

For all valid non-empty table range strings S, parse(S) SHALL return a list with at least one element.

- **Type**: Invariant
- **Component**: Table_Range_Parser
- **Rationale**: An empty result from a valid input would silently disable all table selections.

### P4: Queue Position Calculator — Contiguous Positions Invariant

For any referee queue containing N acknowledged calls, the set of position values assigned to those calls SHALL equal {1, 2, ..., N} with no gaps and no duplicates.

- **Type**: Invariant
- **Component**: Queue_Position_Calculator
- **Rationale**: Gaps or duplicate position numbers would produce misleading wait-time estimates for players.

### P5: Queue Position Calculator — Position After Removal Invariant

For any referee queue, removing the call at position K SHALL cause all calls at positions > K to decrement by exactly 1, producing a new contiguous sequence starting from 1.

- **Type**: Metamorphic
- **Component**: Queue_Position_Calculator
- **Rationale**: Verifies that queue re-ordering after completion is consistent regardless of which position is removed.

### P6: Max Active Calls — Invariant

For all teams, at no point in the system state SHALL a team have more than 2 calls in `unanswered` or `acknowledged` status simultaneously.

- **Type**: Invariant / Model-based
- **Component**: Call_Manager
- **Rationale**: The enforcement must hold under concurrent submissions; property testing can simulate rapid sequential calls and verify the count never exceeds 2.

### P7: Atomic Acknowledgement — Confluence Property

For any set of N concurrent acknowledge requests for the same call, exactly 1 SHALL succeed (setting `status = acknowledged`) and N-1 SHALL fail with HTTP 409, regardless of the order in which the requests arrive.

- **Type**: Confluence / Concurrency
- **Component**: Call_Manager (DynamoDB TransactWriteItems)
- **Rationale**: The race condition between referees is the highest-risk correctness issue in the system; this property must hold for any value of N ≥ 2.

### P8: Session Token Hashing — Non-Reversibility Invariant

For all issued tokens T, the stored value SHALL NOT equal T (i.e., stored = hash(T) ≠ T for all T).

- **Type**: Invariant / Security
- **Component**: Session_Manager
- **Rationale**: Tokens stored in plaintext would allow a DynamoDB read to yield a valid join link, defeating the security model.

### P9: Closed Tournament — Mutation Rejection Invariant

WHILE a tournament has `status = closed`, for all mutating operations (create call, acknowledge, complete, join), THE system SHALL return a non-2xx HTTP status for every such request, regardless of session validity.

- **Type**: Invariant / State-driven
- **Component**: Call_Manager, Session_Manager
- **Rationale**: Closed tournaments must be completely immutable; this property verifies no code path bypasses the status check.
