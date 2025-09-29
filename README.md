## Google Map Route Survey

A simple Node/Express web app that serves a client with Google Maps where respondents can draw, drag-adjust, and submit a route as their survey answer. Submissions are stored as JSON on the server.

### Prerequisites
- Node.js 18+
- A Google Maps JavaScript API key (enable: Maps JavaScript API; Geometry library is loaded in JS)
- Billing must be enabled for Directions-based routing

### Setup
1. Clone the repo and install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file (or copy `.env.example`) and set your key:
   ```bash
   cp .env.example .env
   # then edit .env
   GOOGLE_MAPS_API_KEY=YOUR_API_KEY
   PORT=3000
   ```

### Run locally
```bash
npm run dev
```
Open `http://localhost:3000`.

### How to use
There are two modes:

- Freehand mode (default)
  - Click "Start Drawing" and click on the map to add route points. A dashed preview shows the next segment to your cursor.
  - Click "Finish Drawing" to stop adding points.
  - Drag any vertex to adjust the route.

- Driving mode (snap to road)
  - Toggle "Driving mode (snap to road)" in the controls.
  - Click on the map to set start and end (and optional waypoints). The route is generated using Google Directions and snaps to real roads.
  - Drag the route directly to adjust; it will re-route realistically.

Click "Submit Route" to save your answer.

### Data storage
- Submissions are saved to `data/submissions.json` with a unique id and timestamp.
- Each submission includes:
  - `route`: an array of `{ lat, lng }` points
    - In Freehand mode: the polyline you drew
    - In Driving mode: the Directions overview path decoded into coordinates (snap-to-road)
  - `metadata`: `{ title, description, center, zoom, mode }`
    - `mode` is `"freehand"` or `"driving"`

### Deploy
- Set environment variables in your hosting provider:
  - `GOOGLE_MAPS_API_KEY`
  - `PORT` (optional; provider may set it)
- Run `node server.js` or use `npm start`.

### Notes / Troubleshooting
- If the map loads but routing fails, check API key billing and that the Maps JavaScript API is enabled.
- If Driving mode is off, length is computed using the Geometry library on your drawn polyline; in Driving mode, length is summed from route legs returned by Directions.
- Address already in use on port 3000 (EADDRINUSE): stop the previous server or kill it and retry:
  ```bash
  lsof -ti:3000 | xargs -r kill -9
  npm run dev
  ```
- Failed to save submission: the server now recreates `data/submissions.json` automatically if missing or corrupt. If you still see an error, ensure the process has write permission to the `data/` folder or create it manually:
  ```bash
  mkdir -p data
  ```
