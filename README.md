# Nuvho Automated Proposal System

Automated proposal generation, digital signing, and CRM sync for Nuvho.

---

## Architecture

```
proposals.nuvho.com      →  Next.js 14 (DigitalOcean App Platform)
proposals-api.nuvho.com  →  Cloudflare Worker (V8 runtime)
                              ├── D1 SQLite (proposals DB)
                              ├── R2 Object Storage (covers, PDFs)
                              └── KV (sessions, rate limits)
```

---

## Prerequisites

- Node.js 20+
- Wrangler CLI v3: `npm i -g wrangler`
- DigitalOcean account + `doctl` CLI
- Cloudflare account with Workers & D1 enabled

---

## Local Development

### Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local   # fill in values
npm run dev
# → http://localhost:3000
```

**`.env.local` values:**

```
NEXT_PUBLIC_WORKER_URL=http://localhost:8787
NEXT_PUBLIC_AZURE_CLIENT_ID=f5f35997-177f-4f24-9069-cc1f31113ae7
NEXT_PUBLIC_AZURE_TENANT_ID=15723413-cb5d-453c-bb72-3f481241aeff
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Worker

```bash
cd worker
npm install
wrangler dev           # → http://localhost:8787
```

---

## Deployment

### 1 — Cloudflare Worker

#### Create D1 database

```bash
cd worker
wrangler d1 create nuvho-proposals
# Copy the database_id into wrangler.toml → [[d1_databases]] binding
```

#### Run schema migrations

```bash
wrangler d1 execute nuvho-proposals --file=./schema.sql
```

#### Create R2 bucket

```bash
wrangler r2 bucket create nuvho-proposals
```

#### Create KV namespaces

```bash
wrangler kv:namespace create SESSIONS
wrangler kv:namespace create RATE_LIMIT
# Copy the IDs into wrangler.toml → [[kv_namespaces]]
```

#### Set secrets (NEVER commit these)

```bash
wrangler secret put AZURE_CLIENT_SECRET
wrangler secret put HUBSPOT_API_KEY
wrangler secret put ASANA_PAT
wrangler secret put JWT_SECRET          # openssl rand -base64 48
wrangler secret put RESEND_API_KEY
wrangler secret put XERO_CLIENT_ID
wrangler secret put XERO_CLIENT_SECRET
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put REGISTRY_API_KEY    # Nuvho Master Registry X-Registry-Key (register.nuvho.com)
```

#### Add DNS record

In Cloudflare dashboard: `proposals-api.nuvho.com` → CNAME → your worker.

#### Deploy

```bash
wrangler deploy
```

---

### 2 — Frontend (DigitalOcean App Platform)

#### Create GitHub repo and push

```bash
cd nuvho-proposal-system
git init
git remote add origin git@github.com:nuvho/proposal-system.git
git add .
git commit -m "feat: initial Nuvho Proposal System"
git push -u origin main
```

#### DigitalOcean App Platform setup

1. Go to **DigitalOcean → Apps → Create App**
2. Select the GitHub repo
3. Source directory: `frontend/`
4. Auto-detect: Next.js
5. Set environment variables:

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_WORKER_URL` | `https://proposals-api.nuvho.com` |
| `NEXT_PUBLIC_AZURE_CLIENT_ID` | `f5f35997-177f-4f24-9069-cc1f31113ae7` |
| `NEXT_PUBLIC_AZURE_TENANT_ID` | `15723413-cb5d-453c-bb72-3f481241aeff` |
| `NEXT_PUBLIC_APP_URL` | `https://proposals.nuvho.com` |

6. Add custom domain: `proposals.nuvho.com`
7. Deploy — subsequent pushes to `main` auto-deploy

---

## Azure AD — Required App Registration Settings

In [Azure Portal](https://portal.azure.com) → App Registrations → `f5f35997-177f-4f24-9069-cc1f31113ae7`:

**Redirect URIs (Web):**
- `https://proposals.nuvho.com/auth/callback`
- `http://localhost:3000/auth/callback`

**API Permissions:**
- `openid`, `profile`, `email`, `offline_access`
- `User.Read` (Microsoft Graph)

---

## Environment Variable Reference

### Frontend (`frontend/.env.local`)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_WORKER_URL` | Cloudflare Worker base URL |
| `NEXT_PUBLIC_AZURE_CLIENT_ID` | Azure App client ID |
| `NEXT_PUBLIC_AZURE_TENANT_ID` | Azure tenant ID |
| `NEXT_PUBLIC_APP_URL` | Frontend public URL |

### Worker (wrangler.toml vars + secrets)

| Key | Type | Description |
|-----|------|-------------|
| `FRONTEND_URL` | var | Frontend origin for CORS |
| `AZURE_TENANT_ID` | var | Azure tenant |
| `AZURE_CLIENT_ID` | var | Azure app client ID |
| `ASANA_WORKSPACE_GID` | var | `1143618526084997` |
| `REGISTRY_BASE_URL` | var | Nuvho Master Registry base URL — `https://register.nuvho.com` |
| `AZURE_CLIENT_SECRET` | **secret** | Azure app secret |
| `HUBSPOT_API_KEY` | **secret** | HubSpot private app token |
| `ASANA_PAT` | **secret** | Asana personal access token |
| `JWT_SECRET` | **secret** | 48-byte random base64 |
| `RESEND_API_KEY` | **secret** | Resend API key |
| `XERO_CLIENT_ID` | **secret** | Xero OAuth client ID |
| `XERO_CLIENT_SECRET` | **secret** | Xero OAuth client secret |
| `ANTHROPIC_API_KEY` | **secret** | Claude API key — powers the wizard's "Generate Email Template" step |
| `REGISTRY_API_KEY` | **secret** | Nuvho Master Registry `X-Registry-Key` (register.nuvho.com) — used when creating/updating proposals so each bundled service line gets a canonical `PROP-{GEO}-{YYYY}-{SEQ4}` record |

---

## Project Structure

```
nuvho-proposal-system/
├── frontend/
│   ├── app/
│   │   ├── (auth)/login/         ← Azure AD SSO login page
│   │   ├── (auth)/layout.tsx
│   │   ├── auth/callback/        ← OAuth redirect handler
│   │   ├── (app)/dashboard/      ← Stats + recent proposals
│   │   ├── (app)/proposals/      ← Proposals list + detail
│   │   ├── (app)/proposals/new/  ← 5-step wizard
│   │   ├── p/[id]/               ← Public client signing page
│   │   ├── globals.css           ← Nuvho brand CSS tokens
│   │   └── layout.tsx
│   ├── components/
│   │   ├── layout/AppShell.tsx   ← Collapsible sidebar
│   │   └── ui/NuvhoLogo.tsx      ← Logo SVG component
│   └── lib/
│       ├── auth.ts               ← MSAL config
│       └── types.ts              ← Shared TypeScript types
│
└── worker/
    ├── src/
    │   ├── index.ts              ← Main router + rate limiting
    │   ├── types.ts              ← Env, Session, Row interfaces
    │   ├── lib/
    │   │   ├── auth.ts           ← requireAuth, exchangeCode, createSession
    │   │   ├── response.ts       ← ok(), err() helpers
    │   │   └── ulid.ts           ← V8-compatible ULID + randomToken
    │   └── routes/
    │       ├── auth.ts           ← /auth/* handlers
    │       └── proposals.ts      ← CRUD + public signing
    ├── schema.sql                ← D1 schema + seed data
    └── wrangler.toml             ← Worker config
```

---

## Automations Triggered on Sign

When a client accepts a proposal (`/p/:token/sign`), the following automations fire:

| # | Automation | Implementation |
|---|-----------|----------------|
| A1 | HubSpot deal stage → `closedwon` | `triggerHubspot()` in proposals.ts |
| A2 | Asana onboarding project created | `triggerAsana()` |
| A3 | SharePoint client folder created | `triggerSharePoint()` (stub — needs MS Graph impl) |
| A4 | Xero quote/invoice created | `triggerXero()` (stub — needs Xero OAuth impl) |
| A5 | Teams channel notification | `triggerTeamsNotification()` (stub — needs Graph impl) |

Stubs log to `console.log` until full OAuth flows are wired in.

---

© Nuvho Systems Pty Ltd
