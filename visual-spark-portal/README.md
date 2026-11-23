# VSPARK Portal

Registration, participant, and judging portal for **VSPARK — Prompt Engineering Competition (AI Video Generation Challenge)** at **COMSATS University Islamabad, Vehari Campus** (10 December 2025).

Stack: Node.js 20+ + Express, plain HTML/CSS/JS in `/public`. Storage is **MongoDB** when `MONGODB_URI` is set, otherwise a **local JSON + receipts folder** (for `npm start` on a laptop). Designed for **Vercel** (no in-memory state, no server timers, no disk writes in Mongo mode).

Repo: **https://github.com/ZaynabQazi/vspark-portal** · Deploy to Render:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/ZaynabQazi/vspark-portal)

See [DEPLOY.md](DEPLOY.md) for Render/Railway/Vercel steps and the required environment variables.

## Run locally

```bash
npm install
npm start
```

Open:

- Landing: http://localhost:3000
- Register: http://localhost:3000/register
- Participant portal: http://localhost:3000/portal
- Admin: http://localhost:3000/admin

Local admin (only when `NODE_ENV` is not `production`):

- Username: `admin`
- Password: `vspark-admin-2026` (override with `ADMIN_PASSWORD`)

Data is stored in `data/` (registrations, settings, attempts, receipts). Delete `data/` to reset.

```bash
npm test
```

## Routes

| Path | Purpose |
|------|---------|
| `GET /` | Landing page (winners only after publish) |
| `GET /register` | Registration form + receipt upload |
| `GET /portal` | Participant login and competition UI |
| `GET /admin` | Organizer dashboard |
| `GET /api/meta` | Institute, programs, rules |
| `GET /api/stats` | Public registration count |
| `GET /api/winners` | Public podium **only if published** |
| `POST /api/register` | Multipart registration (receipt required) |
| `POST /api/portal/login` | Registration ID + member reg number |
| `GET /api/portal/me` | Team state (server clock) |
| `GET /api/portal/drive-link` | Organizer Drive link (running attempt only) |
| `POST /api/portal/start` | Idempotent start of this team's timer |
| `POST /api/portal/submit` | Team Drive link (until this team's `endsAt`) |
| `POST /api/admin/login` | Returns signed admin token |
| `GET/PATCH/DELETE /api/admin/registrations` | List / accept-reject / delete |
| `GET /api/admin/receipts/:id` | Admin-only receipt stream |
| `GET /api/admin/export.csv` | Registrations CSV |
| `GET/PUT /api/admin/settings` | Drive link, duration, gate, default venue |
| `GET /api/admin/live` | Live monitoring |
| `GET /api/admin/live/export.csv` | Live monitoring CSV |
| `POST /api/admin/attempts/:id/reset` | Reset one team's attempt |
| `POST /api/admin/attempts/:id/extend` | Add minutes to one team's `endsAt` |
| `GET /api/admin/judging` | Submissions, notes, positions |
| `POST /api/admin/results/position` | Assign 1st/2nd/3rd/none |
| `POST /api/admin/reviews` | Private judge notes + reviewed flag |
| `POST /api/admin/results/publish` | Publish (all 3 positions required) |
| `POST /api/admin/results/unpublish` | Hide winners again |
| `GET /api/admin/results/export.csv` | Results CSV (positions, links, notes) |

Automated tests (`npm test`) cover duplicate registration, receipt magic-byte/size checks, accept/reject, idempotent starts, per-team deadlines, late/early submission rejection, gate behaviour, token expiry, ranking rules, publish gating, public visibility and judge-note privacy.

All timestamps are **server `Date.now()`**. Displays use **Asia/Karachi**.

## Environment variables

| Name | Required | Notes |
|------|----------|--------|
| `MONGODB_URI` | Vercel | Atlas / Mongo connection string |
| `MONGODB_DB` | no | Default `vspark` |
| `ADMIN_USER` | production | Admin username |
| `ADMIN_PASSWORD` | production | No default in production |
| `TOKEN_SECRET` | production | HMAC secret for admin + participant tokens (different prefixes/keys) |
| `COMPETITION_MINUTES` | no | Default duration (default 20) |
| `PORT` | no | Default 3000 |
| `NODE_ENV` | production on Vercel | Fail-fast if admin secrets missing |
| `SMTP_HOST` `SMTP_USER` `SMTP_PASS` `MAIL_FROM` | no | Email on accept/reject; skipped if unset |
| `SMTP_PORT` | no | Default 587 |
| `DATA_DIR` | no | Local JSON root (default `./data`) |

## Deploy on Vercel

1. Push this folder (the one that contains `package.json` and `vercel.json`).
2. Vercel project → **Environment Variables** (Production):

```
MONGODB_URI
MONGODB_DB=vspark
ADMIN_USER
ADMIN_PASSWORD
TOKEN_SECRET
NODE_ENV=production
COMPETITION_MINUTES=20
```

Optional: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`.

3. Deploy. Create a MongoDB Atlas database; the app creates indexes on first request.
4. Log in at `/admin`, set **default venue**, organizer **Drive folder** URL, duration, then open the **gate** on competition day.

Receipts live in MongoDB (not public URLs). Request bodies stay under Vercel’s ~4.5 MB limit (receipts max 2 MB).

**Render / Railway:** this folder includes `render.yaml`, `railway.json` and a `Procfile`. Step-by-step instructions, including the MongoDB setup and admin credentials, are in [DEPLOY.md](DEPLOY.md).

## Competition-day checklist

1. Confirm MongoDB is connected and you can log in at `/admin`.
2. **Competition** tab: paste the organizer Drive folder (`https://drive.google.com/...`), duration 20, default venue (e.g. `CS Lab 2, Block B`). Save.
3. Accept pending teams. Override venue per team if you split labs. Students see venue in `/portal` after accept.
4. When everyone is seated, turn the **gate Open**. Students click **Start my 20 minutes** (confirm dialog). Refreshing does **not** restart the clock.
5. **Live** tab: watch Not started / Running / Time over / Submitted. Export CSV if needed. Use **Reset attempt** or **Add minutes** only for technical problems.
6. After the last deadline: **Results** tab — review Drive links, private notes, assign 1st/2nd/3rd (only teams that submitted). Publish when all three are filled. Unpublish to edit again.

## Project layout

```
server.js          Express app (also Vercel entry via api/index.js)
db.js              Mongo or local JSON
options.js         Institute, programs, ID prefix
routes/            public, register, portal, admin
services/          clock, validate, tokens, mail, competition, results
middleware/        auth, upload, security
public/            landing, register, portal, admin
test/              automated checks
```
