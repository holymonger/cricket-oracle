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
