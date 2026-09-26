# Pool Tournament Referee Call App

A mobile-first Next.js 15 web application for managing referee calls at pool tournaments. Players request referees at specific tables, referees acknowledge and fulfill requests from a live queue, and admins manage the tournament lifecycle — all without shouting across the venue.

## Tech Stack

- **Framework**: Next.js 15 (App Router, TypeScript)
- **Styling**: Tailwind CSS 4
- **Database**: AWS DynamoDB (single-table design)
- **Hosting**: AWS Amplify
- **Testing**: Vitest, fast-check (property-based), Testing Library

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- An AWS account with DynamoDB access

### Local Development

```bash
# Install dependencies
npm ci

# Copy environment variables
cp .env.local.example .env.local
# Edit .env.local with your values (see Environment Variables below)

# Run the development server
npm run dev
```

The app will be available at `http://localhost:3000`.

## Environment Variables

Create a `.env.local` file (or configure in Amplify console) with the following:

| Variable | Description |
|----------|-------------|
| `ADMIN_SECRET` | Shared secret that gates access to the `/admin` tournament creation interface. Use a strong, random string. |
| `DYNAMODB_TABLE_NAME` | DynamoDB table name (default: `RefereeCallApp`) |
| `NEXT_PUBLIC_BASE_URL` | Base URL for generating absolute join links (e.g., `https://your-app.amplifyapp.com`) |
| `AWS_REGION` | AWS region for DynamoDB (default: `us-east-1`) |
| `AWS_ACCESS_KEY_ID` | IAM access key with DynamoDB permissions |
| `AWS_SECRET_ACCESS_KEY` | IAM secret access key |
| `VAPID_PUBLIC_KEY` | Web Push VAPID public key (see Push Notifications below). Optional — push is disabled if unset. |
| `VAPID_PRIVATE_KEY` | Web Push VAPID private key. Keep secret. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Same value as `VAPID_PUBLIC_KEY`; exposed to the browser to create subscriptions. |
| `VAPID_SUBJECT` | Contact URI for push (`mailto:you@example.com` or an https URL). |

## Push Notifications (referee call alerts)

Referees can opt in to OS-level notifications so their phone alerts them when a
new call comes in, even when the app isn't in the foreground. This uses the Web
Push standard (Push API + service worker + VAPID) — no native app required.

### Setup

1. Generate a VAPID keypair once:
   ```bash
   npx web-push generate-vapid-keys
   ```
2. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
   (the public key again) plus `VAPID_SUBJECT` in your environment / Amplify
   console. If these are unset, the app runs normally but the "Enable
   notifications" control is hidden and no pushes are sent.
3. **Amplify only:** the build reads a curated allowlist of env vars into
   `.env.production` (see `amplify.yml`). The VAPID variables are included in
   that allowlist — if you add more env vars later, remember that
   `NEXT_PUBLIC_*` values must be present at **build time** to be inlined into
   the client bundle, so they must appear in the `amplify.yml` grep.
4. Deploy. Referees will see an "Enable call notifications" button on their
   tournament page; tapping it requests permission and subscribes their device.

Generate a **separate** keypair for production (don't reuse local dev keys), and
treat it as long-lived: changing the keypair invalidates every existing referee
subscription and forces everyone to re-subscribe. `VAPID_PRIVATE_KEY` is a
secret — keep it in the Amplify console, never in the repo.

Notifications are sent to **all** referees who have enabled them in a tournament
whenever a new call is created. Sending is best-effort and never blocks or fails
call creation; subscriptions the push service reports as expired are pruned
automatically.

### Platform notes

- **Android / Chrome / Firefox / desktop**: works in the browser after the
  referee enables notifications.
- **iOS / iPhone (Safari)**: Apple only allows Web Push for sites **installed to
  the Home Screen** as a PWA, on **iOS 16.4 or later**. Referees on iPhone must
  use Share → "Add to Home Screen", open the app from that icon, then enable
  notifications. Without installing, iOS will not deliver web push.
- Delivery is best-effort and may be delayed when the browser is fully closed on
  some platforms; the in-app queue still updates live via polling while the page
  is open.

### Tournament Directors and admin access

The app supports two kinds of privileged users:

- **Tournament Directors** are user accounts (email + password) that own the tournaments they create. A director can only see and manage their own tournaments. Passwords are hashed with scrypt (via Node's built-in `crypto`) and never stored or returned in plaintext.
- **Admin** is the holder of the `ADMIN_SECRET`. The admin can see and manage any tournament without needing per-tournament tokens, and is the only one who can create director accounts (invite-only).

Sign-in flow:

1. Go to `/login`. Directors sign in with email and password; the admin signs in with the `ADMIN_SECRET`. Both receive an HttpOnly session cookie.
2. `/admin` lists the tournaments you own (directors) or all tournaments (admin), and lets you create new ones.
3. The admin can open `/admin/directors` to create director accounts. Share the temporary password securely; there is no self-service signup.

Ownership notes:

- Tournaments created by a director are stamped with that director as owner. Tournaments created via the legacy `ADMIN_SECRET` path (or before this feature existed) have no owner and are visible to the admin only.
- The legacy per-tournament admin token still works for managing a specific tournament, so existing links and bookmarks keep functioning.

Account and session management:

- The admin can disable (or re-enable) a director from `/admin/directors`. A disabled director cannot sign in. Signing out revokes the session server-side, not just in the browser.
- Sessions carry a numeric `ttl` attribute (Unix epoch seconds). To have DynamoDB automatically purge expired session records, enable **Time to Live (TTL)** on the table with the TTL attribute name set to `ttl`. Without TTL enabled, expired sessions are still rejected at read time but the records are not auto-deleted.

### Token storage and security

- The **admin token** is stored only as a SHA-256 hash and is never persisted or returned in plaintext after creation. Save it when the tournament is created.
- The **referee and player join tokens** are stored in plaintext on the tournament record so an authenticated admin can re-display the join QR codes for an existing tournament from any device (via `GET /api/tournaments/[id]/join-links`, which requires an admin session). These tokens only gate joining a tournament as a referee or player; they carry no admin privileges.
- Tournaments created before this behavior was added will not have stored join tokens, so their QR codes cannot be recovered — recreate the tournament or share the original links saved at creation time.

## DynamoDB Table Provisioning

The app requires a single DynamoDB table. You can create it using either method:

### Option A: AWS CDK (automated)

```bash
# Install CDK globally if you haven't already
npm install -g aws-cdk

# Deploy the table stack
npx cdk deploy --app "npx ts-node infra/dynamodb.ts"
```

### Option B: AWS Console (manual)

1. Go to the DynamoDB console in your target region.
2. Create a table with:
   - **Table name**: `RefereeCallApp`
   - **Partition key**: `PK` (String)
   - **Sort key**: `SK` (String)
   - **Billing mode**: On-demand (PAY_PER_REQUEST)
3. Add a Global Secondary Index:
   - **Index name**: `GSI1`
   - **Partition key**: `GSI1PK` (String)
   - **Sort key**: `GSI1SK` (String)
   - **Projection**: All attributes
4. (Recommended) Enable **Time to Live (TTL)** with the attribute name `ttl` so expired session records are purged automatically.

## AWS Amplify Deployment

### Setup

1. Push this repository to GitHub, GitLab, or Bitbucket.
2. Open the [AWS Amplify Console](https://console.aws.amazon.com/amplify/).
3. Click **New app** → **Host web app** → select your repository and branch.
4. Amplify will auto-detect the `amplify.yml` build specification.
5. Under **Environment variables**, add all variables listed above.
6. Deploy.

Amplify will run `npm ci` and `npm run build`, then serve the Next.js SSR application.

### Custom Domain

In Amplify Console → Domain management, add your custom domain and Amplify will provision an SSL certificate automatically.

## Rotating the ADMIN_SECRET

To rotate the admin secret:

1. Generate a new strong random string.
2. Update the `ADMIN_SECRET` environment variable in the Amplify Console (or your deployment environment).
3. Redeploy the application.

No database migration is needed — the secret is only checked at request time. Existing tournament tokens and sessions are unaffected.

## Running Tests

```bash
# Run all tests (unit + property-based)
npm test

# Or equivalently
npx vitest --run
```

The test suite includes:
- Unit tests for database queries, session management, call logic, and API routes
- Property-based tests (fast-check) for table range parsing, queue positions, call limits, atomic acknowledgement, and token security

## Project Structure

```
app/              → Next.js App Router pages and API routes
components/       → React UI components (admin, referee, player)
lib/              → Core business logic
  ├── auth/       → Token utilities and session management
  ├── calls/      → Call creation, acknowledgement, completion
  ├── db/         → DynamoDB client and typed queries
  ├── hooks/      → React hooks (polling)
  ├── queue/      → Queue position calculation
  ├── tables/     → Table range parser
  └── utils/      → Shared utilities
infra/            → Optional CDK infrastructure code
```

## License

Private — not for redistribution.
