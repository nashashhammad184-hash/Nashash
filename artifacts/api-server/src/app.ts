import express from 'express';
import cors from 'cors';
import path from 'path';
import apiRouter from './routes/index';

const app = express();
// KAYAN-CORS-01: match index.ts strict allow-list. This file is not
// the build entry (build.mjs uses src/index.ts), but kept consistent.
const NODE_ENV_VAL = (process.env.NODE_ENV || "").toLowerCase();
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",").map((o) => o.trim()).filter((o) => o.length > 0);
app.use(cors(
  NODE_ENV_VAL === "production"
    ? {
        origin: (origin, cb) => {
          if (!origin) return cb(null, true);
          if (CORS_ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
          return cb(null, false); // origin not allowed — no CORS headers emitted
        },
      }
    : { origin: true },
));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use('/api', apiRouter);

const studioPublicPath = path.resolve(process.cwd(), 'artifacts/studio/dist/public');
if (fs_existsSync(studioPublicPath)) {
  app.use('/assets', express.static(path.join(studioPublicPath, 'assets')));
  app.use(express.static(studioPublicPath));
}

app.use('/public', express.static(studioPublicPath));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API Route not found' });
  }
  const studioIndex = path.join(studioPublicPath, 'index.html');
  if (fs_existsSync(studioIndex)) {
    return res.sendFile(studioIndex);
  }
  res.status(200).send('Kayan AI Studio is online.');
});

function fs_existsSync(p: string) {
  const fs = require('node:fs');
  return fs.existsSync(p);
}

export default app;
