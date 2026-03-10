This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

> **Production Deployment**: API hardening with admin key authentication, rate limiting, and match management system active.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Admin Key (v0 Auth)

Match endpoints are protected by a shared secret admin key. This prevents unauthorized reads/writes of match timelines.

### Protected Endpoints

- `POST /api/matches` - Create a new match
- `POST /api/matches/[matchId]/snapshots` - Save a match snapshot
- `GET /api/matches/[matchId]/snapshots` - Retrieve snapshots timeline
- `GET /api/matches/[matchId]/latest` - Retrieve latest snapshot

### Open Endpoints (No Auth Required)

- `/api/health` - Health check
- `/api/winprob` - Compute win probability (read-only)
- `/api/statement-prob` - Parse betting statements (read-only)
- `/api/extract-scorecard` - OCR extraction endpoint

### Setting Up Admin Key Locally

1. **Create or update `.env.local`:**
   ```bash
   ADMIN_KEY=your-secret-key-here
   DATABASE_URL=postgresql://...
   ```

2. **The key will be automatically loaded when you run:**
   ```bash
   npm run dev
   ```

3. **In the UI at `/match`:**
   - A blue "Admin Key" section appears at the top
   - Enter your `ADMIN_KEY` value
   - Click **"Save"** - it stores to localStorage
   - Status shows as "✓ Saved"

4. **Test create/save operations:**
   - Create a match
   - Add snapshots
   - All requests include the `x-admin-key` header automatically

### Deploying with Admin Key to Vercel

1. **Add ADMIN_KEY to Vercel Environment Variables:**
   - Go to **Vercel Project Settings** → **Environment Variables**
   - Name: `ADMIN_KEY`
   - Value: (same secret key from your `.env.local`)
   - Select: **Production**, **Preview**, **Development**
   - Click **"Save"**

2. **Redeploy:**
   ```bash
   git add . 
   git commit -m "Update config"
   git push origin main
   # Vercel will auto-redeploy with ADMIN_KEY set
   ```

3. **Verify:**
   - Open `/match` page on your deployed app
   - Enter the same ADMIN_KEY value
   - Save it and try creating a match

### Error Handling

**401 Unauthorized:** 
- You entered an invalid key or no key at all
- Solution: Check the admin key input and resave

**500 Server Error with "ADMIN_KEY environment variable":**
- Server is misconfigured (ADMIN_KEY not set on deployment)
- Solution: Add ADMIN_KEY to Vercel Environment Variables and redeploy

**`/api/health` remains public and does not require admin key.**

## Rate Limit (v0)

All match-related APIs now use a simple in-memory token bucket limiter:

- Limit: **60 requests per minute per IP**
- IP source: first IP from `x-forwarded-for`, fallback `"unknown"`
- Exceeded limit response: **HTTP 429** with JSON error

### Rate-limited Endpoints

- `POST /api/matches`
- `POST /api/matches/[matchId]/snapshots`
- `GET /api/matches/[matchId]/snapshots`
- `GET /api/matches/[matchId]/latest`
- `POST /api/statement-prob`
- `POST /api/winprob`
- `POST /api/extract-scorecard`

Because this limiter is in-memory (v0), counters reset when server instances restart.

### Security Notes

- Admin key is stored in browser localStorage (not secure for highly sensitive data)
- For production, consider:
  - Using short-lived tokens (JWT)
  - Implementing proper OAuth or session-based auth
  - Using HTTPS only (Vercel handles this)
- Never commit `.env.local` to Git (it's in `.gitignore`)

## Match Data & Cricsheet Imports

## Local V4 Training Workflow (IPL + T20I)

Large training exports are generated locally from raw JSON directories and are git-ignored under `training/`.

### 1) Export combined v4 training rows

```bash
IPL_JSON_DIR=../ipl_json T20I_JSON_DIR=../t20s_json npm run export:v4
```

Optional flags:

```bash
npm run export:v4 -- --maxMatches 500 --seed 42 --sampleEveryBalls 6 --includeCompetitions ipl,t20i --balancedByCompetition
```

By default, this writes:

- `training/training_rows_v4.jsonl`

Each JSONL row uses:

- `{ matchKey, matchId, competition, ballKey, innings, legalBallNumber, battingTeam, y, features }`

### 2) Train v4 logistic regression

```bash
npm run train:v4logreg -- --data training/training_rows_v4.jsonl
```

The trainer streams the JSONL file and writes artifact:

- `lib/model/artifacts/v4_logreg.json`

Trainer accepts additional flags:

```bash
npm run train:v4logreg -- --data training/training_rows_v4.jsonl --seed 42 --iters 3000 --lr 0.05 --l2 1e-4 --standardize true
```

### 3) Compare v4-logreg vs v3 heuristic

```bash
npm run eval:compare:v3v4
```

This evaluates both models on the same validation set (20% holdout by matchKey) and reports:
- Brier score, LogLoss, Accuracy
- Calibration bins for each model
- Side-by-side metrics comparison

Example output:
```
=== V3 Metrics (Heuristic) ===
Brier:    0.216066
LogLoss:  0.732979
Acc@0.5:  70.69%

=== V4 Metrics (LogReg) ===
Brier:    0.250204
LogLoss:  0.693556
Acc@0.5:  50.61%

>>> Winner by LogLoss: V4 (LogReg)
```

### 4) Use v4-logreg in production

The v4-logreg artifact is committed to git and loaded automatically. To use as the default model:

```bash
# Set environment variable on your server (Vercel, etc.)
DEFAULT_MODEL_VERSION=v4-logreg
```

Then predictions use v4-logreg:

```typescript
import { computeWinProb } from "@/lib/model";

const result = computeWinProb(matchState); 
// modelVersion will be "v4-logreg" if DEFAULT_MODEL_VERSION is set
// Uses trained artifact from lib/model/artifacts/v4_logreg.json
```

### Model Version Registration

All available models are registered in `lib/model/index.ts`:
- `v0` - constant 0.5 baseline
- `v1` - logistic regression heuristic
- `v3-lgbm` - LightGBM with rolling features (default if not specified)
- `v4-lgbm` - LightGBM v4 extended features
- `v4-logreg` - Streaming-trained logistic regression on v4 features

Set `DEFAULT_MODEL_VERSION` to change the default:

```bash
DEFAULT_MODEL_VERSION=v3-lgbm npm run build  # Use v3-lgbm as default
DEFAULT_MODEL_VERSION=v4-logreg npm run dev  # Use v4-logreg locally
```

## Team Mapping (A/B Sides)

All matches use a consistent **"A" / "B" side system** for storing match data:

#### Manual Matches
- **Team A** = whatever you enter in the UI
- **Team B** = whatever you enter in the UI
- `source = null`, `sourceMatchId = null` (no Cricsheet data)

#### Imported Matches (Cricsheet JSON) – Team Normalization

To fix the **#1 win-probability bug** (Team A representing different real-world teams across matches), imported matches are **automatically normalized**:

- **Team A** = alphabetically lower of the two teams
- **Team B** = alphabetically higher of the two teams
- `teamAName` / `teamBName` fields store the original teams for reference

**Example:**
- Match 1: CSK vs RCB → normalized to CSK (Team A) vs RCB (Team B)
- Match 2: RCB vs MI → normalized to MI (Team A) vs RCB (Team B)
- Match 3: CSK vs MI → normalized to CSK (Team A) vs MI (Team B)

This ensures:
- ✅ Team A is always the same alphabetical position across all imports
- ✅ Global models see consistent team representations
- ✅ Win probabilities remain meaningful when aggregating match data

**Import metadata:**
- `source = "cricsheet"`, `sourceMatchId = filename` (e.g., "335982")
- `matchDate` - parsed from `info.dates[0]`
- `venue`, `city` - from JSON metadata
- `winnerTeam` - stored as "A" or "B" (relative to normalized order)
- `tossWinnerTeam` - stored as "A" or "B"
- `tossDecision` - "bat" or "field"

### BallEvent Storage

All ball events store `battingTeam` as "A" or "B" relative to the match's normalized teamA/teamB values, regardless of whether the match was manually created or imported.

### Win Probability Computation

The `computeWinProb()` function returns **Team A win percentage consistently** for both manual and imported matches. Interpretation:
- **Manual match:** Team A win% for the teams you entered
- **Imported match:** Team A win% for the alphabetically-lower team

This is why normalization is important: without it, Team A would represent different real-world teams in different matches, making the model predictions meaningless.

### Team Mapping Utilities

For code that needs to convert between team names and sides:

```typescript
import { teamNameToSide, sideToTeamName } from "@/lib/cricket/teamMapping";

// Convert team name to side
const side = teamNameToSide({ teamA: "CSK", teamB: "RCB" }, "RCB"); // Returns "B"

// Convert side to team name
const name = sideToTeamName({ teamA: "CSK", teamB: "RCB" }, "A"); // Returns "CSK"
```

## Realtime Delivery API (Post-Delivery Predictions)

Endpoint: `POST /api/realtime/delivery` (admin protected)

This endpoint accepts a canonical post-delivery payload and writes:
- `LiveBallEvent` for every delivery
- `BallPrediction` only for legal deliveries (`!wide && !noBall`)

Predictions are computed **after** the delivery is applied to innings state (post-delivery context).

Canonical payload shape:

```json
{
  "matchId": "<match-id>",
  "innings": 1,
  "over": 4,
  "ballInOver": 2,
  "battingTeamName": "Mumbai Indians",
  "strikerName": "R Sharma",
  "nonStrikerName": "I Kishan",
  "bowlerName": "J Bumrah",
  "runs": { "total": 1, "bat": 1, "extras": 0 },
  "extras": { "wides": 0, "noballs": 0, "byes": 0, "legbyes": 0 },
  "wickets": [],
  "provider": "realtime-delivery",
  "providerEventId": "optional-stable-event-id",
  "occurredAt": "2026-03-05T12:34:56.000Z"
}
```

Response includes `legalBallNumber` and `teamAWinProb` for legal balls.

## Live Feed Providers

The system includes an **API-agnostic provider abstraction** for live cricket deliveries. Currently implemented:

### File-Based Simulator Provider

Demo provider for testing the full live workflow (delivery→prediction→odds→edge) without external APIs.

**Setup:**

1. Provide a JSONL or JSON file with deliveries:
   - **Environment variable**: `LIVE_SIM_FILE=data/live-sim/sample-match.jsonl`
   - Or match-specific: `LIVE_SIM_FILE_<matchId>=path/to/file.jsonl`

2. File format: **JSONL** (one delivery per line) or **JSON array**
   - Each delivery must match the canonical `LiveDeliveryInput` shape
   - Innings 2 deliveries **must** include `targetRuns`
   - If `provider` or `providerEventId` missing, auto-populated

3. Sample fixture included: `data/live-sim/sample-match.jsonl` (~25 deliveries for testing)

**Usage:**

```bash
# Pull next delivery from simulator
POST /api/realtime/tick
x-admin-key: <admin-key>
Content-Type: application/json

{
  "matchId": "sample-match-001",
  "liveProvider": "file-sim",
  "oddsPayload": { /* ... */ }
}

# Response includes:
# - deliveriesProcessed: 1
# - nextCursor: "1" (index of next delivery)
# - prediction, edge, staleness as usual
```

**Provider Cursor Tracking:**

Cursors persist in `LiveProviderCursor` table:
- `matchId_provider` unique constraint ensures one cursor per match+provider
- Auto-upserted on each tick
- Can be reset by deleting the row

**Future Extensions:**

- `lib/providers/live/<provider-name>/provider.ts` - Add new live feed sources
- All must implement `LiveDeliveryProvider` interface (see `lib/providers/live/types.ts`)

### BallEvents Provider (Imported Data Replay)

Replays existing `BallEvent` rows (imported from cricsheet) as a live feed. Useful for testing predictions, edge signals, and odds flow with historical data without waiting for live matches.

**Features:**

- Converts imported `BallEvent` rows to `LiveDelivery` payloads
- Only emits **legal deliveries** (legalBallNumber ≠ null AND isWide=false AND isNoBall=false)
- Automatically computes `targetRuns` for innings 2 (innings 1 total + 1)
- Converts player IDs to names, batting team "A"/"B" to actual team names
- Stable provider event IDs: `ballEvent:<BallEvent.id>`

**Usage:**

```bash
# Pull next legal delivery from imported BallEvent
POST /api/realtime/tick
x-admin-key: <admin-key>
Content-Type: application/json

{
  "matchId": "<match-id>",
  "liveProvider": "ball-events"
}

# Response:
{
  "ok": true,
  "prediction": { "innings": 1, "legalBallNumber": 5, ... },
  "provider": {
    "liveProvider": "ball-events",
    "deliveriesProcessed": 1,
    "nextCursor": "clm5x9k2p...",
    "lastProviderEventId": "ballEvent:clm5x9k2p..."
  }
}
```

### Provider Reset Endpoint

Reset live data to replay from the beginning:

```bash
POST /api/realtime/reset
x-admin-key: <admin-key>
Content-Type: application/json

{
  "matchId": "<match-id>"
}

# Deleted:
# - LiveBallEvent rows
# - LiveInningsState rows
# - BallPrediction rows (model="v3-lgbm")
# - LiveProviderCursor rows (resets all provider cursors to start)
```

After reset, calling `/api/realtime/tick` with `liveProvider="ball-events"` will emit deliveries from ball 1 again.

### Admin UI

Available at `/admin/realtime`:
- Provider dropdown: `None` | `File Simulator` | `Ball Events (Imported)`
- "Tick Once" / "Auto Tick" controls
- Display: cursor, deliveries processed, latest prediction+edge
- "Reset" button to clear provider state

## Step 36: Realtime Dashboard (Live Predictions & Market Insights)

A comprehensive dashboard for visualizing live predictions, market odds, and edge signals as the match progresses.

### Features

- **Win Probability Chart**: SVG line chart showing Team A win probability over time (x-axis: innings/legalBallNumber)
- **Real-time Controls**: Match selector, provider dropdown, auto-tick toggle, edge/staleness thresholds
- **Latest Snapshots**: Three-card layout showing model prediction, market odds, and edge signal status
- **Opportunity Highlighting**: Automatically highlights profitable edge signals (non-stale, above threshold)
- **Live Data Flow**: Auto-tick every 1.2s to continuously poll predictions and market data

### API Endpoints

**GET `/api/realtime/series?matchId=...&modelVersion=v3-lgbm&limit=240`**

Returns historical prediction series for charting:

```json
{
  "ok": true,
  "matchId": "...",
  "modelVersion": "v3-lgbm",
  "count": 120,
  "data": [
    { "innings": 1, "legalBallNumber": 1, "teamAWinProb": 0.998, "createdAt": "2026-03-06T10:00:00Z" },
    { "innings": 1, "legalBallNumber": 2, "teamAWinProb": 0.875, "createdAt": "2026-03-06T10:01:00Z" },
    ...
  ]
}
```

**GET `/api/markets/latest?matchId=...`**

Returns latest model prediction, market odds, and edge signal:

```json
{
  "ok": true,
  "matchId": "...",
  "prediction": {
    "innings": 1,
    "legalBallNumber": 5,
    "teamAWinProb": 0.969,
    "createdAt": "2026-03-06T10:05:00Z"
  },
  "market": {
    "marketName": "rollbit",
    "observedAt": "2026-03-06T10:05:02Z",
    "oddsA": 1.42,
    "oddsB": 2.90,
    "impliedProbA": 0.704,
    "impliedProbB": 0.345
  },
  "edge": {
    "marketName": "rollbit",
    "observedAt": "2026-03-06T10:05:02Z",
    "teamAWinProb": 0.969,
    "marketProbA_raw": 0.704,
    "marketProbA_fair": 0.695,
    "overround": 0.049,
    "edgeA": 0.274,
    "stale": false,
    "stalenessSeconds": 2
  }
}
```

### Dashboard URL

Open the dashboard at:

```
http://localhost:3000/realtime/dashboard
```

Select a match, choose provider (ball-events for imported data), and click "Start Auto Tick" to begin live updates.

### Staleness Detection

The dashboard automatically computes staleness between:
- Model prediction timestamp (`BallPrediction.createdAt`)
- Market odds timestamp (`OddsTick.observedAt`)

If difference > 10 seconds, the edge signal is marked stale and muted (no highlighting).

## Step 37: Paper Trading & Backtesting (Simulation Only)

Paper trading is fully simulated and never places real-money bets.

### Models

- `PaperAccount` (`paper_accounts`)
- `PaperBet` (`paper_bets`)

PnL convention used everywhere: **net PnL excluding returned stake**
- win: `stake * (oddsDecimal - 1)`
- loss: `-stake`

### Strategy (edge-v1)

Implemented in `lib/paper/strategyEdgeV1.ts`:
- Reject stale signals
- Require `abs(edgeA) >= threshold` (default `0.03`)
- Flat stake default `10`
- MVP side logic: Team A only (`edgeA > 0`)

### Endpoints (Admin Protected)

- `POST /api/paper/place`
  - Body: `{ accountName?, matchId, edgeSignalId, stake?, threshold? }`
  - Creates an `open` paper bet after strategy validation

- `GET /api/paper/overview?accountName=default&matchId=...`
  - Returns account info, open bets, settled bets
  - Balance computed as: `startingBalance + sum(settled pnl)`

- `POST /api/paper/backtest`
  - Body: `{ threshold?, stake?, includeTeamB?, limitMatches? }`
  - Runs limited backtest over completed matches and returns summary metrics

- `POST /api/paper/settle`
  - Body: `{ accountName?, matchId? }`
  - Settles open paper bets where `winnerTeam` is known
  - Skips open bets for matches without final result

### UI

Open: `/paper`
- Account overview cards
- Open and settled bets tables
- “Run Backtest” button (calls `/api/paper/backtest`)
- “Settle Open Bets” button (calls `/api/paper/settle`)

### CLI Backtest

```bash
npm run backtest:edge-v1
```

Optional env vars:
- `BACKTEST_THRESHOLD`
- `BACKTEST_STAKE`
- `BACKTEST_LIMIT`
- `BACKTEST_INCLUDE_TEAM_B=1`

The backtest outputs bets count, win rate, total pnl, ROI, average odds, and pnl distribution.

## Training Feature Exports (v3/v4)

Use the feature export CLI to generate training rows from imported completed matches.

```bash
# Default: v4 features
npm run export:training

# Explicit v4
npm run export:training -- --featureVersion v4

# Backward-compatible v3 export
npm run export:training -- --featureVersion v3
```

Output files are versioned:

- `training/training_rows_v4.jsonl` (default)
- `training/training_rows_v3.jsonl`

Additional versioned metadata files are also written:

- `training/export_summary_v4.json` / `training/export_summary_v3.json`
- `training/validation_sample_v4.json` / `training/validation_sample_v3.json`
- `training/feature_documentation_v4.json` / `training/feature_documentation_v3.json`

## Learn More


To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploying to Vercel

### Prerequisites
- GitHub repository with the cricket-oracle code
- Neon PostgreSQL account with DATABASE_URL connection string
- Vercel account

### Step-by-Step Deployment Instructions

#### 1. **Push Code to GitHub**
```bash
# Initialize git (if not done)
git init
git add .
git commit -m "Initial commit: cricket oracle app"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/cricket-oracle.git
git push -u origin main
```

#### 2. **Connect Repository to Vercel**
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click **"Add New..."** → **"Project"**
3. Click **"Import Git Repository"**
4. Select GitHub and authorize Vercel to access your GitHub account
5. Search for `cricket-oracle` repository and click **"Import"**

#### 3. **Configure Environment Variables**
Before deploying, set the DATABASE_URL for both Preview and Production:

1. In the **Vercel Project Settings** (after import):
   - Go to **Settings** → **Environment Variables**
   
2. **Add DATABASE_URL for all environments:**
   - Name: `DATABASE_URL`
   - Value: Your Neon PostgreSQL connection string from `.env.local`
   - Select: **Production**, **Preview**, **Development**
   - Click **"Save"**

   Example connection string format:
   ```
   postgresql://neondb_owner:YOUR_PASSWORD@ep-xxx.aws.neon.tech/neondb?sslmode=require&channel_binding=require
   ```

#### 4. **Configure Build Settings** (if needed)
Default settings should work, but verify:
- **Build Command**: `next build` (default)
- **Output Directory**: `.next` (default)
- **Node.js Version**: 18.17+ (default)

#### 5. **Deploy**
1. Click **"Deploy"** button (will appear after configuration)
2. Vercel will automatically:
   - Install dependencies (including `postinstall` script which runs `prisma generate`)
   - Build the project
   - Deploy to production

#### 6. **Run Prisma Migrations in Production**
After first deployment, you need to run migrations on the production database:

**Option A: Via Vercel CLI (Recommended)**
```bash
npm install -g vercel
vercel env pull               # Download env vars from Vercel
npx prisma migrate deploy     # Run migrations against production DB
```

**Option B: Via Vercel Deployment Hooks**
1. Add a `.vercel/post-deploy.sh` hook (not required for initial setup)
2. Or manually run migrations after deployment confirmation

#### 7. **Verify Production Deployment**
Check that the app is running:
1. Go to Vercel project URL (provided after deployment)
2. Visit `/api/health` endpoint
   - Example: `https://your-app.vercel.app/api/health`
   - Should return: `{"ok":true,"db":true,"timestamp":"..."}`

### Production Safety Checklist

- ✅ DATABASE_URL set in all environments (Production, Preview, Development)
- ✅ Prisma client generated via `postinstall` script
- ✅ Migrations run before accepting traffic (via `prisma migrate deploy`)
- ✅ Health endpoint returns `db: true` (verifies DB connectivity)
- ✅ No hardcoded database URLs in source code
- ✅ `.env.local` is in `.gitignore` (prevents accidental credential leaks)

### Troubleshooting

**"Error: ENOENT: no such file or directory" during build**
- Ensure `postinstall` script runs: check Vercel Build Logs
- Verify `@prisma/client` is in dependencies (not devDependencies)

**"PrismaClientInitializationError: Can't reach database server"**
- Verify DATABASE_URL is set in Vercel Environment Variables
- Check Neon database status at https://console.neon.tech
- Ensure connection string includes `?sslmode=require`

**Health endpoint returns `db: false`**
- Check Vercel logs: `vercel logs <project-name> --prod`
- Verify DATABASE_URL connectivity locally: `node -e "require('dotenv').config(); console.log(process.env.DATABASE_URL)"`

### Redeploying After Code Changes

```bash
git add .
git commit -m "Your changes"
git push origin main
# Vercel automatically redeploys on push to main
```

### Next Steps

- Monitor [Vercel Analytics](https://vercel.com/docs/analytics)
- Set up [error tracking](https://vercel.com/docs/concepts/deployments/deploy-hooks)
- Scale database connections via Neon's [Autoscaling](https://neon.tech/docs/manage/autoscaling)

For more details, see [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying).
