# Deploy guide — VSPARK Portal

The app is a plain Node.js/Express server. It needs **one** of:

- **Render** (web service, free plan) + a MongoDB database (Atlas free tier)
- **Railway** (web service + MongoDB plugin)
- **Vercel** (serverless) + MongoDB Atlas — see the README

Receipts are stored in MongoDB, so a database is required on every host.

## Admin login

The organizer signs in at `/admin` with **exactly** the credentials you configure:

| Where | Username | Password |
| --- | --- | --- |
| Local `npm start` (no env set) | `admin` | `vspark-admin-2026` |
| Render / Railway / Vercel | `ADMIN_USER` value | `ADMIN_PASSWORD` value |

There is **no default password in production**. If `ADMIN_USER`, `ADMIN_PASSWORD` or `TOKEN_SECRET` are missing while `NODE_ENV=production`, the server refuses to start.

## Environment variables

| Key | Required | Example / note |
| --- | --- | --- |
| `MONGODB_URI` | yes | `mongodb+srv://USER:PASS@cluster.mongodb.net/vspark` |
| `MONGODB_DB` | no | `vspark` |
| `ADMIN_USER` | yes | `organizer` |
| `ADMIN_PASSWORD` | yes | a strong password you choose |
| `TOKEN_SECRET` | yes | long random string (40+ chars) |
| `NODE_ENV` | yes | `production` |
| `COMPETITION_MINUTES` | no | `20` |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `MAIL_FROM` | no | email on accept/reject; skipped when absent |

## Option A — Render

1. Create a free MongoDB Atlas cluster, add a database user, allow `0.0.0.0/0`, copy the URI.
2. Push this folder to GitHub (Render deploys from a repo), or use the Render CLI.
3. Render Dashboard → **New** → **Blueprint** → pick the repo. `render.yaml` is detected.
4. When prompted, fill `MONGODB_URI`, `ADMIN_USER`, `ADMIN_PASSWORD`. `TOKEN_SECRET` is generated automatically.
5. Deploy, open `https://<service>.onrender.com/admin`, sign in.

Manual alternative: **New → Web Service**, build `npm ci`, start `npm start`, add the same env vars.

Notes: the free instance sleeps after ~15 minutes of inactivity and wakes on the next request (first load may take ~30–60 s).

## Option B — Railway

```bash
npm i -g @railway/cli
railway login
railway init
railway add --database mongodb
railway variables --set "MONGODB_URI=\${{MongoDB.MONGO_URL}}" \
  --set "MONGODB_DB=vspark" \
  --set "NODE_ENV=production" \
  --set "ADMIN_USER=organizer" \
  --set "ADMIN_PASSWORD=YourStrongPassword" \
  --set "TOKEN_SECRET=$(openssl rand -hex 32)" \
  --set "COMPETITION_MINUTES=20"
railway up
railway domain
```

`railway.json` and the `Procfile` are already included, so the start command and health check are automatic.

## Option C — Vercel

`vercel.json` and `api/index.js` are included. Import the repo in Vercel and add the same environment variables, then deploy. Use MongoDB Atlas; Vercel has no local disk.

## After deploying

1. Open `/admin` and sign in with your `ADMIN_USER` / `ADMIN_PASSWORD`.
2. **Competition** tab: organizer Drive link, duration `20`, default venue → **Save settings**.
3. Accept teams in **Registrations**.
4. On competition day: gate **Open**, monitor **Live**, then rank and **Publish** in **Results**.

## Local run

```bash
npm install
npm start
npm test
```

Local data goes to `data/` (gitignored). Delete that folder to reset.
