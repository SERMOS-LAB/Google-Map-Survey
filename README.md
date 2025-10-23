## Google Map Route Survey

An Express + Google Maps app for collecting realistic evacuation routes with comprehensive privacy protection and user-friendly interface. Participants select Starting Location and Ending Location (via autocomplete or by clicking the map). A draggable route is drawn automatically; clicking the map adds intermediate stops between A and B. Submissions are stored in Postgres via Prisma with privacy-compliant data handling.

### Features

**Core Mapping Functionality:**

- Starting Location/Ending Location with Google Places Autocomplete; A/B markers placed automatically
- Auto-route on Ending Location selection; route is draggable and re-routes realistically
- Click on the map to insert intermediate stops between A and B (numbered stop markers shown)
- Reverse geocoding fills inputs when users click the map instead of using autocomplete
- Drag-and-drop stop reordering with real-time route updates

**User Experience:**

- Comprehensive instruction modal with embedded video tutorial
- "Revert to Auto-Route" button to undo changes while keeping start/end points
- Clear resets route, markers, and inputs; Submit persists the response
- Mobile-responsive design with collapsible sidebar
- Submit button always accessible in header

**Privacy & Ethics:**

- Random buffer zones (100-200m) applied with complete route generalization for maximum privacy protection
- Multiple privacy options: nearest major intersection or grid cell storage
- IP hashing for user anonymity
- Route-level privacy filtering removes sensitive GPS points within buffer zones
- No exact coordinates collected; buffer sizes not recorded
- Transparent data handling communication

**Research Integration:**

- Submission ID generation for Qualtrics integration
- Copy-to-clipboard functionality for easy ID sharing
- Support for complex evacuation scenarios (return trips, multiple stops)
- Open-source approach suitable for academic research

**Security:**

- Helmet CSP for Google domains, rate limiting, small JSON body limit
- Secure data transmission and storage
- Trust proxy configuration for deployment platforms

### Stack

- Node.js, Express
- Prisma + Postgres
- Google Maps JavaScript API (Maps, Places, Directions, Geometry, Geocoding)
- Vercel deployment with automatic builds

### Prerequisites

- Node.js 18+
- Google Cloud API key with:
  - Maps JavaScript API enabled
  - Places API enabled
  - Billing enabled
- Restrict the key by HTTP referrers (recommended):
  - `http://localhost:4000/*` (local)
  - `https://google-map-survey.vercel.app/*` (Vercel)
  - Any custom domains you'll use

### Environment

Create `.env` (or copy `.env.example`):

```bash
cp .env.example .env
```

Required variables:

```ini
GOOGLE_MAPS_API_KEY=your_key
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DB?sslmode=require
PORT=3000                  # Vercel sets PORT automatically; use 4000 locally if you prefer
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

1) **Start Mapping:** Click "Instructions" to review tutorial and select privacy options
2) **Set Locations:** Type and select Starting Location, then Ending Location. The route appears automatically.
3) **Add Stops:** Click "Add Stop" to search for places by name, or click directly on the map to add intermediate stops
4) **Adjust Route:** Drag the blue route line to match the actual roads traveled
5) **Reorder Stops:** Drag stops in the list to reorder them (route updates automatically)
6) **Submit:** Click "Submit Route" to save. Copy the submission ID for Qualtrics integration

### Complex Route Handling

For complex evacuation scenarios (e.g., Home → School → Destination → Back Home → Back to Destination):

- Map as **ONE continuous route** with all stops in order
- Use numbered sequence (1, 2, 3...) to show actual path including return trips
- Submit separate routes only for different evacuation events (different days/times)

### API

- `GET /config` → `{ googleMapsApiKey }`
- `POST /api/submit`
  - Body:
    ```json
    {
      "route": [{ "lat": 0, "lng": 0 }, ...],
      "metadata": { 
        "center": {"lat":0, "lng":0}, 
        "zoom": 12, 
        "mode": "driving",
        "privacy": "intersection" // or "grid"
      }
    }
    ```
  - Response: `{ ok: true, id: "..." }`

### Data Model

`prisma/schema.prisma`

```prisma
model Submission {
  id          String   @id @default(cuid())
  submittedAt DateTime @default(now())
  route       Json     // Privacy-processed coordinates
  metadata    Json     // Includes privacy mode, map settings
  ipHash      String?  // Hashed IP for anonymity
  userAgent   String?
}
```

### Privacy & Ethics Compliance

- **Complete Route Generalization:** All GPS points generalized to intersection coordinates for maximum privacy protection
- **Random Buffer Privacy:** 100-200m random buffer zones applied (buffer size not recorded)
- **Location Anonymization:** Coordinates snapped to intersections or grid cells
- **IP Protection:** Client IPs are hashed before storage
- **User Consent:** Clear privacy options presented before data collection
- **Data Minimization:** Only necessary route data is collected
- **Transparency:** Users understand how their data is processed

### Research Applications

- **Evacuation Studies:** Collect realistic evacuation routes with privacy protection
- **Transportation Research:** Understand actual vs. shortest path routing
- **Emergency Planning:** Analyze evacuation patterns and bottlenecks
- **Academic Integration:** Seamless integration with survey platforms like Qualtrics

### Troubleshooting

- **Map not loading:** Check `/config` returns a non-empty key, enable Maps + Places APIs, ensure billing, verify referrer patterns
- **Console shows `refererNotAllowedMapError`:** Add your exact domain pattern in Google Cloud
- **Console shows `ApiNotActivatedMapError`:** Enable Maps JavaScript API
- **Console shows `BillingNotEnabledMapError`:** Enable billing
- **CSP errors:** Broaden CSP directives in `server.js` for required origins

### Contributing

This tool is designed for academic research and can be extended for various evacuation and transportation studies. The codebase is structured to support:

- Additional privacy protection methods
- Different mapping interfaces
- Integration with other survey platforms
- Custom data collection requirements
- DB writes missing: verify `DATABASE_URL`, check Render logs, run `npx prisma db push`.
- Port in use locally: `lsof -ti:4000 | xargs -r kill -9` then `npm run dev`.
