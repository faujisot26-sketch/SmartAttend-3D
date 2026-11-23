# SmartAttend 3D

Spatial classroom attendance web application with dynamic HMAC-signed expiring QR codes, Three.js 3D classroom geofence validation, simulated 3D liveness verification, role-based access control, course attendance breakdown, bulk CSV student import, and privacy/audit governance.

## Requirements

- **Node.js 22+** (runs `server.ts` natively with `node server.ts` in production)

## Local Development

```bash
npm install
npm run dev
```

The app runs on `http://localhost:3000`.

## Production Build & Start

```bash
npm run build
NODE_ENV=production npm run start
```

## Environment Variables (Recommended for Public Deployment)

Copy `.env.example` or set these variables in your hosting provider's Secrets / Environment panel:

- `PROFESSOR_PASSCODE` — Locks the Professor Console behind a server-verified passcode.
- `SESSION_SECRET` — Secret used to sign `Authorization: Bearer` session tokens.
- `QR_SIGNING_SECRET` — Secret used to sign dynamic expiring QR tokens (`SA3D.*`).
- `PORT` — HTTP port (defaults to `3000`).

## Push to GitHub

```bash
git init
git add .
git commit -m "Initial SmartAttend 3D full-stack app"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

## Public Hosting (Full-Stack Node.js)

Deploy the GitHub repository to **Render**, **Railway**, or **Google Cloud Run** (note: GitHub Pages only hosts static sites and will not run the Express `/api/*` backend):

- **Build Command**: `npm install && npm run build`
- **Start Command**: `NODE_ENV=production npm run start`
- **Health Check Path**: `/api/health`
