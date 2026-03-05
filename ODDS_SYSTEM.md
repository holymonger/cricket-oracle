# Odds Ingestion & Edge Detection System

## Overview

This system fetches cricket match odds from external aggregator APIs, normalizes them, removes vig (bookmaker margin), and compares against LightGBM model predictions to identify edge opportunities.

**⚠️ IMPORTANT SAFETY NOTICE**
- This system is for **analysis and research purposes only**
- **Never place bets automatically** based on these signals
- Always verify odds and team name mappings manually
- Edge signals are informational only - not betting advice
- Past performance does not guarantee future results
- Gambling involves risk - only bet what you can afford to lose

## Architecture

### Components

1. **Team Name Canonicalization** (`lib/teams/`)
   - Normalizes team names for consistent matching
   - Handles IPL team renames (e.g., RCB Bengaluru → Bangalore)
   - Maps market team names to match sides (A or B)

2. **Decimal Odds Utilities** (`lib/markets/decimal.ts`)
   - Converts decimal odds ↔ implied probabilities
   - Removes vig/overround from two-sided markets
   - Computes fair probabilities via proportional normalization

3. **Aggregator Client** (`lib/providers/oddsAggregator/`)
   - Fetches odds from external API
   - Configurable via environment variables
   - Health check support

4. **Database Models** (Prisma)
   - `Market`: Market/bookmaker identifiers
   - `MarketEvent`: Unique betting events per match/market
   - `OddsTick`: Time-series of odds observations
   - `EdgeSignal`: Computed edge = model_prob - market_fair_prob

5. **API Endpoints** (`app/api/markets/`)
   - `POST /api/markets/poll`: Fetch odds and compute edges
   - `GET /api/markets/signals`: Retrieve recent edge signals

6. **UI** (`app/markets/page.tsx`)
   - View edge signals with filtering
   - Staleness indicators
   - Color-coded positive/negative edges

## Database Schema

### Market
```prisma
model Market {
  id            String         @id @default(cuid())
  name          String         @unique  // "rollbit", "polymarket"
  marketEvents  MarketEvent[]
}
```

### MarketEvent
```prisma
model MarketEvent {
  id                    String      @id
  matchId               String      // FK to Match
  marketId              String      // FK to Market
  externalEventId       String      // Market's unique ID
  selectionTeamAName    String      // Raw team name from market
  selectionTeamBName    String
  status                String?     // "open", "closed", "settled"
  oddsTicks             OddsTick[]
  
  @@unique([marketId, externalEventId])
}
```

### OddsTick
```prisma
model OddsTick {
  id                String      @id
  marketEventId     String
  observedAt        DateTime
  side              String      // "A" or "B"
  oddsDecimal       Float       // e.g. 2.50
  impliedProbRaw    Float       // 1/oddsDecimal (includes vig)
  sourceJson        Json?       // Raw data for debugging
}
```

### EdgeSignal
```prisma
model EdgeSignal {
  id                String      @id
  matchId           String
  marketEventId     String
  modelVersion      String      // "v3-lgbm", "v1", etc
  observedAt        DateTime
  teamAWinProb      Float       // Model's prediction
  marketProbA       Float       // Market fair probability (vig removed)
  edgeA             Float       // teamAWinProb - marketProbA
  overround         Float?      // (pA_raw + pB_raw)
  notes             String?     // "stale prediction", "one-sided market"
}
```

## Setup

### 1. Environment Variables

Add to `.env.local`:
```bash
ODDS_AGGREGATOR_URL=http://localhost:3001  # Your aggregator service URL
ODDS_AGGREGATOR_KEY=your_api_key_here      # Optional API key
```

### 2. Run Database Migration

```bash
npx prisma migrate dev --name add_odds_models
```

### 3. Generate Prisma Client

```bash
npx prisma generate
```

## Usage

### Fetch Odds & Compute Edges

**Via API:**
```bash
curl -X POST http://localhost:3000/api/markets/poll \
  -H "Content-Type: application/json" \
  -H "x-admin-key: YOUR_ADMIN_KEY" \
  -d '{"matchId": "clx123..."}'
```

**Via UI:**
1. Navigate to `/markets`
2. Enter admin key
3. Enter match ID
4. Click "Poll Now"

### View Edge Signals

**Via UI:**
- Navigate to `/markets`
- Adjust edge threshold filter (default: 3%)
- Click "Load Signals"
- Signals are color-coded:
  - 🟢 Green (+Edge): Model favors Team A
  - 🔴 Red (-Edge): Market favors Team A (value on Team B)
  - ⚠️ Yellow background: Stale prediction (>10s old)

**Via API:**
```bash
curl http://localhost:3000/api/markets/signals \
  -H "x-admin-key: YOUR_ADMIN_KEY"
```

## Aggregator API Format

Your odds aggregator should return:

```json
{
  "matchId": "clx123...",
  "timestamp": "2026-03-05T12:00:00Z",
  "markets": [
    {
      "marketName": "rollbit",
      "externalEventId": "evt_abc123",
      "observedAt": "2026-03-05T12:00:00Z",
      "selections": [
        { "teamName": "Mumbai Indians", "oddsDecimal": 1.75 },
        { "teamName": "Chennai Super Kings", "oddsDecimal": 2.15 }
      ]
    },
    {
      "marketName": "polymarket",
      "externalEventId": "0x456def",
      "observedAt": "2026-03-05T12:00:00Z",
      "selections": [
        { "teamName": "Mumbai Indians", "oddsDecimal": 1.80 },
        { "teamName": "Chennai Super Kings", "oddsDecimal": 2.10 }
      ]
    }
  ]
}
```

## Edge Calculation

### Step 1: Fetch Odds
```typescript
oddsA = 1.75  // Team A odds
oddsB = 2.15  // Team B odds
```

### Step 2: Compute Raw Implied Probabilities
```typescript
pA_raw = 1 / 1.75 = 0.5714  // 57.14%
pB_raw = 1 / 2.15 = 0.4651  // 46.51%
overround = 0.5714 + 0.4651 = 1.0365  // 3.65% vig
```

### Step 3: Remove Vig (Fair Probabilities)
```typescript
pA_fair = 0.5714 / 1.0365 = 0.5513  // 55.13%
pB_fair = 0.4651 / 1.0365 = 0.4487  // 44.87%
// pA_fair + pB_fair = 1.0
```

### Step 4: Get Model Prediction
```typescript
teamAWinProb_model = 0.62  // 62% from LightGBM
```

### Step 5: Calculate Edge
```typescript
edgeA = teamAWinProb_model - pA_fair
     = 0.62 - 0.5513
     = 0.0687  // +6.87% edge on Team A
```

**Interpretation:**
- `+6.87%`: Model thinks Team A has a 6.87% higher chance of winning than the market's fair probability suggests
- Potential value opportunity on Team A bets
- **Always verify before considering any action**

## Error Handling

### Team Name Mapping Errors

If team names don't match, the system returns 422 with details:
```json
{
  "error": "No valid market events after processing",
  "errors": [
    {
      "market": "rollbit",
      "error": "Cannot map market team 'MI' to match sides..."
    }
  ]
}
```

**Resolution:**
1. Check team name canonicalization rules in `lib/teams/canonicalize.ts`
2. Add remapping if needed
3. Verify match has correct teamA/teamB values

### Stale Predictions

If model prediction is >10s older than odds observation:
- Signal flagged with `isStale: true`
- UI shows yellow background + ⚠️ icon
- Notes field includes staleness duration

**Resolution:**
- Run predictions more frequently
- Use v3-lgbm with real-time state updates

### One-Sided Markets

When only one team's odds are available:
- Uses raw implied probability (no vig removal)
- Notes field includes "one-sided market"
- Fair prob for missing side = 1 - available side

## Testing

### Mock Aggregator Response

Create a mock endpoint for testing:
```typescript
// test-aggregator.ts
export default function handler(req, res) {
  res.json({
    matchId: req.query.matchId,
    timestamp: new Date().toISOString(),
    markets: [
      {
        marketName: "test-market",
        externalEventId: "test-123",
        observedAt: new Date().toISOString(),
        selections: [
          { teamName: "Team A", oddsDecimal: 2.0 },
          { teamName: "Team B", oddsDecimal: 2.0 }
        ]
      }
    ]
  });
}
```

Set `ODDS_AGGREGATOR_URL=http://localhost:3001` and test polling.

## Security

- All endpoints require admin key authentication
- Never expose admin key in client-side code
- Store admin key in localStorage (client-side only)
- Aggregator API key stored server-side in `.env.local`
- No automatic bet placement - manual verification required

## Monitoring

Key metrics to track:
1. **Edge magnitude**: Distribution of edge values
2. **Overround**: Average vig per market
3. **Staleness**: Prediction age vs odds freshness
4. **Mapping failures**: Team name resolution errors
5. **API uptime**: Aggregator availability

## Troubleshooting

### "Cannot connect to odds aggregator"
- Check `ODDS_AGGREGATOR_URL` in `.env.local`
- Verify aggregator service is running
- Test health endpoint: `curl http://localhost:3001/health`

### "No predictions found for match"
- Run predictions first: `npm run predict:match -- <sourceMatchId>`
- Or use realtime polling to generate predictions

### "Team mapping failed"
- Check team names in match record
- Add remapping to `lib/teams/canonicalize.ts`
- Verify aggregator returns correct team names

### "Unauthorized - invalid admin key"
- Set admin key in UI's admin key section
- Verify key matches `ADMIN_KEY` in `.env.local`

## Future Enhancements

- [ ] Real-time odds streaming (WebSocket)
- [ ] Historical edge performance tracking
- [ ] Multi-model ensemble predictions
- [ ] Automated alerts for high-edge opportunities
- [ ] Bankroll management calculator
- [ ] Kelly criterion position sizing
- [ ] Market efficiency analysis
- [ ] Arbitrage opportunity detection

## License & Disclaimer

**For educational and research purposes only.**

This software is provided "as is" without warranty. The authors are not responsible for any financial losses incurred through use of this system. Gambling can be addictive - please gamble responsibly.
