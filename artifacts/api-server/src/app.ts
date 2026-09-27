import express from 'express';
import cors from 'cors';
import path from 'path';
import apiRouter from './routes/index';

const app = express();
app.use(cors());
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
