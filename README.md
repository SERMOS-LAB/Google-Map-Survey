## Google Map Route Survey

An Express + Google Maps app for collecting realistic driving routes. Participants select Origin and Destination (via autocomplete or by clicking the map). A draggable route is drawn automatically; clicking the map adds intermediate stops between Origin and Destination. Submissions are stored in Postgres via Prisma.

### Features
- Origin/Destination with Google Places Autocomplete; A/B markers placed automatically
- Auto-route on Destination selection; route is draggable and re-routes realistically
- Click on the map to insert intermediate stops between A and B (stop markers shown)
- Reverse geocoding fills inputs when users click the map instead of using autocomplete
- Clear resets route, markers, and inputs; Submit persists the response
- Security hardening: Helmet CSP for Google domains, rate limiting, small JSON body limit

### Stack
- Node.js, Express
- Prisma + Postgres
- Google Maps JavaScript API (Maps, Places, Directions, Geometry, Geocoding)

### Prerequisites
- Node.js 18+
- Google Cloud API key with:
  - Maps JavaScript API enabled
  - Places API enabled
  - Billing enabled
- Restrict the key by HTTP referrers (recommended):
  - `http://localhost:4000/*` (local)
  - `https://your-service.onrender.com/*` (Render)
  - Any custom domains you’ll use

### Environment
Create `.env` (or copy `.env.example`):
```bash
cp .env.example .env
```
Required variables:
```ini
GOOGLE_MAPS_API_KEY=your_key
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DB?sslmode=require
PORT=3000                  # Render sets PORT automatically; use 4000 locally if you prefer
IP_HASH_SALT=change_me     # optional; hashes client IPs if set
```

### Install & Run Locally
```bash
npm install
npx prisma generate
npx prisma db push   # creates the Submission table if missing

export PORT=4000
export GOOGLE_MAPS_API_KEY=your_key
export DATABASE_URL=postgresql://...
npm run dev
```
Open `http://localhost:4000`.

### User Workflow
1) Type and select Origin, then Destination. The route appears.
2) Click on the map to add stops; drag the route to refine.
3) Clear resets everything; Submit saves the route.

### API
- `GET /config` → `{ googleMapsApiKey }`
- `POST /api/submit`
  - Body:
    ```json
    {
      "route": [{ "lat": 0, "lng": 0 }, ...],
      "metadata": { "title": "...", "description": "...", "center": {"lat":0, "lng":0}, "zoom": 12, "mode": "driving" }
    }
    ```
  - Response: `{ ok: true, id: "..." }`

### Data Model
`prisma/schema.prisma`
```prisma
model Submission {
  id          String   @id @default(cuid())
  submittedAt DateTime @default(now())
  route       Json
  metadata    Json
  ipHash      String?
  userAgent   String?
}
```

### Deploy on Render (Web Service + Postgres)s
1. Create a Render Postgres instance → copy External Connection string to `DATABASE_URL` (ensure `sslmode=require`).
2. Create a Web Service from this repo.
3. Environment Variables:
   - `GOOGLE_MAPS_API_KEY`
   - `DATABASE_URL`
   - `IP_HASH_SALT` (optional)
4. Build & Start:
   - Build Command: `npm run render-build`
   - Start Command: `npm start`
5. Ensure your key referrers include the Render subdomain and any custom domains.

### Security Notes
- Helmet sets a CSP allowing `maps.googleapis.com` and `maps.gstatic.com` for scripts/images/styles/connect. Adjust in `server.js` if you embed other origins.
- express-rate-limit is enabled; `app.set('trust proxy', 1)` supports proxy headers on Render.
- When `IP_HASH_SALT` is set, the server hashes client IPs before storage; otherwise IP is not persisted.

### Troubleshooting
- Map not loading: check `/config` returns a non-empty key, enable Maps + Places APIs, ensure billing, verify referrer patterns.
- Console shows `refererNotAllowedMapError`: add your exact domain pattern in Google Cloud.
- Console shows `ApiNotActivatedMapError`: enable Maps JavaScript API.
- Console shows `BillingNotEnabledMapError`: enable billing.
- CSP errors: broaden CSP directives in `server.js` for required origins.
- DB writes missing: verify `DATABASE_URL`, check Render logs, run `npx prisma db push`.
- Port in use locally: `lsof -ti:4000 | xargs -r kill -9` then `npm run dev`.

