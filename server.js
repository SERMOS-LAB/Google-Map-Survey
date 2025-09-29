import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import { nanoid } from 'nanoid';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY || process.env.MAPS_API_KEY || '';
if (!GOOGLE_MAPS_API_KEY) {
  console.warn('[WARN] Google Maps API key not found in .env (expected GOOGLE_MAPS_API_KEY). Map will not load.');
}

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Provide the API key to the client securely (no long-term storage in code)
app.get('/config', (_req, res) => {
  res.json({ googleMapsApiKey: GOOGLE_MAPS_API_KEY });
});

// Ensure data dir exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const submissionsFile = path.join(dataDir, 'submissions.json');
if (!fs.existsSync(submissionsFile)) {
  fs.writeFileSync(submissionsFile, '[]', 'utf-8');
}

app.post('/api/submit', (req, res) => {
  try {
    const { route, metadata } = req.body;

    if (!route || !Array.isArray(route) || route.length < 2) {
      return res.status(400).json({ error: 'Route must be an array of at least two LatLng points.' });
    }

    const submission = {
      id: nanoid(10),
      submittedAt: new Date().toISOString(),
      route, // [{lat, lng}, ...]
      metadata: metadata || {},
      client: {
        ip: req.ip,
        userAgent: req.headers['user-agent'] || ''
      }
    };

    // Ensure data dir/file exist even if deleted while server is running
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    let arr = [];
    try {
      if (fs.existsSync(submissionsFile)) {
        const raw = fs.readFileSync(submissionsFile, 'utf-8');
        arr = JSON.parse(raw);
        if (!Array.isArray(arr)) arr = [];
      } else {
        fs.writeFileSync(submissionsFile, '[]', 'utf-8');
      }
    } catch (e) {
      console.warn('[WARN] submissions.json unreadable, resetting to empty array.');
      arr = [];
    }

    arr.push(submission);
    fs.writeFileSync(submissionsFile, JSON.stringify(arr, null, 2), 'utf-8');

    res.json({ ok: true, id: submission.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save submission' });
  }
});

// Fallback to index.html for root
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
