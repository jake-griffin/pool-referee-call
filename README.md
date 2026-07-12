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
