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

app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
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
    mode: z.enum(['freehand', 'driving'])
  })
});

function hashIp(ip, salt) {
  if (!ip) return null;
  const toHash = `${ip}|${salt || ''}`;
  return crypto.createHash('sha256').update(toHash).digest('hex');
}

app.post('/api/submit', async (req, res) => {
  try {
    const parsed = PayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const { route, metadata } = parsed.data;
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.ip || '';
    const ipHash = process.env.IP_HASH_SALT ? hashIp(ip, process.env.IP_HASH_SALT) : null;
    const userAgent = req.headers['user-agent'] || null;

    const created = await prisma.submission.create({
      data: {
        route,
        metadata: metadata || {},
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
