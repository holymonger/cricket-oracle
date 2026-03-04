This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

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
