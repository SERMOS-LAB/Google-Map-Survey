import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { z } from 'zod';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY || process.env.MAPS_API_KEY || '';
if (!GOOGLE_MAPS_API_KEY) {
  console.warn('[WARN] Google Maps API key not found in .env (expected GOOGLE_MAPS_API_KEY). Map will not load.');
}

// Behind a proxy (Render), trust the first proxy to read X-Forwarded-* safely
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // Allow Google Maps assets
      "script-src": ["'self'", "https://maps.googleapis.com", "'unsafe-inline'"],
      "img-src": ["'self'", "data:", "https://maps.gstatic.com", "https://maps.googleapis.com"],
      "style-src": ["'self'", "https:", "'unsafe-inline'"],
      "connect-src": ["'self'", "https://maps.googleapis.com", "https://maps.gstatic.com"],
      "font-src": ["'self'", "https:", "data:"]
    }
  }
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Provide the API key to the client securely (no long-term storage in code)
app.get('/config', (_req, res) => {
  res.json({ googleMapsApiKey: GOOGLE_MAPS_API_KEY });
});

const LatLngSchema = z.object({
  lat: z.number().finite().gte(-90).lte(90),
  lng: z.number().finite().gte(-180).lte(180)
});
const PayloadSchema = z.object({
  route: z.array(LatLngSchema).min(2).max(10000),
  metadata: z.object({
    title: z.string().max(300).optional().nullable(),
    description: z.string().max(2000).optional().nullable(),
    center: z
      .object({ lat: z.number().finite(), lng: z.number().finite() })
      .optional()
      .nullable(),
    zoom: z.number().int().min(0).max(22).optional().nullable(),
    mode: z.enum(['freehand', 'driving']),
    privacy: z.enum(['intersection', 'grid']).optional()
  })
});

function hashIp(ip, salt) {
  if (!ip) return null;
  const toHash = `${ip}|${salt || ''}`;
  return crypto.createHash('sha256').update(toHash).digest('hex');
}

function generateRandomBuffer() {
  // Generate random buffer between 100-200m
  const minBuffer = 100; // meters
  const maxBuffer = 200; // meters
  return Math.random() * (maxBuffer - minBuffer) + minBuffer;
}

function getDistance(point1, point2) {
  // Haversine formula for accurate distance calculation in meters
  const R = 6371000; // Earth's radius in meters
  const dLat = (point2.lat - point1.lat) * Math.PI / 180;
  const dLng = (point2.lng - point1.lng) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(point1.lat * Math.PI / 180) * Math.cos(point2.lat * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function snapToIntersection(lat, lng) {
  // Round to nearest 0.001 degrees (approximately 100m)
  return {
    lat: Math.round(lat * 1000) / 1000,
    lng: Math.round(lng * 1000) / 1000
  };
}

function snapToGrid(lat, lng) {
  // Round to nearest 0.01 degrees (approximately 1km - block group size)
  return {
    lat: Math.round(lat * 100) / 100,
    lng: Math.round(lng * 100) / 100
  };
}

function extractStopsFromRoute(route) {
  if (route.length < 2) return [];
  
  // Extract first and last points as primary stops
  const stops = [route[0], route[route.length - 1]];
  
  // For now, we'll use first and last stops
  // In the future, we could detect intermediate stops by analyzing route patterns
  return stops;
}

function applyRandomBufferPrivacy(route, stops) {
  const bufferRadius = generateRandomBuffer(); // Don't store this!
  
  const filteredRoute = [];
  const processedStops = stops.map(stop => ({
    ...stop,
    // Apply buffer to stop coordinates
    lat: snapToIntersection(stop.lat, stop.lng).lat,
    lng: snapToIntersection(stop.lat, stop.lng).lng
  }));
  
  // Filter route points within buffer zones of any stop
  for (const point of route) {
    const isInAnyBuffer = stops.some(stop => 
      getDistance(point, stop) < bufferRadius
    );
    
    if (!isInAnyBuffer) {
      filteredRoute.push(point);
    } else {
      // Replace with generalized point
      filteredRoute.push(snapToIntersection(point.lat, point.lng));
    }
  }
  
  return { filteredRoute, processedStops };
}

function processRouteForPrivacy(route, privacyMode, stops = []) {
  if (!privacyMode || privacyMode === 'exact') {
    return route; // No processing needed
  }
  
  // Apply random buffer privacy for all modes
  if (stops.length > 0) {
    const { filteredRoute } = applyRandomBufferPrivacy(route, stops);
    return filteredRoute;
  }
  
  // Fallback to original snapping for backward compatibility
  return route.map(point => {
    if (privacyMode === 'intersection') {
      return snapToIntersection(point.lat, point.lng);
    } else if (privacyMode === 'grid') {
      return snapToGrid(point.lat, point.lng);
    }
    return point;
  });
}

app.post('/api/submit', async (req, res) => {
  try {
    const parsed = PayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const { route, metadata } = parsed.data;
    const privacyMode = metadata?.privacy || 'intersection'; // Default to intersection
    
    // Extract stops from route (first, last, and any intermediate stops)
    const stops = extractStopsFromRoute(route);
    
    // Process route for privacy with random buffer zones
    const processedRoute = processRouteForPrivacy(route, privacyMode, stops);
    
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.ip || '';
    const ipHash = process.env.IP_HASH_SALT ? hashIp(ip, process.env.IP_HASH_SALT) : null;
    const userAgent = req.headers['user-agent'] || null;

    const created = await prisma.submission.create({
      data: {
        route: processedRoute,
        metadata: { ...metadata, privacyMode },
        ipHash,
        userAgent
      }
    });

    res.json({ ok: true, id: created.id });
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
