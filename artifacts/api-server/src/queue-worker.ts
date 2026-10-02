import './loadEnv';
import { runScriptJob } from './lib/services/ScriptJobRunner';
import { GpuQueueService, JobRow } from './lib/services/GpuQueueService';
import { runExternalVideoJob } from './lib/providers/video/externalVideoProvider';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const pExec = promisify(execFile);
const POLL_MS = 2000;
const HEARTBEAT_MS = 60_000;
const JOB_POLL_MS = 3000;
const WATCHDOG_MS = 60_000;
const STALE_THRESHOLD_MS = 5 * 60_000;

const VIDEO_URL = process.env.VIDEO_WORKER_URL || 'http://127.0.0.1:8080';
const LLM_URL   = process.env.LLM_WORKER_URL   || 'http://127.0.0.1:8082';

let stopping = false;

async function httpJson(method, url, body, timeoutMs = 60_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: (() => {
        const h = {};
        if (body) h['Content-Type'] = 'application/json';
        const k = process.env.GPU_WORKER_TOKEN;
        if (k) h['X-API-Key'] = k;
        return h;
      })(),
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { status: res.status, json };
  } finally { clearTimeout(t); }
}

async function pollWorkerJob(base, jid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (stopping) throw new Error('worker stopping');
    let json;
    try {
      ({ json } = await httpJson('GET', `${base}/jobs/${jid}`, undefined, 30_000));
    } catch (e) {
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
    const st = json?.status;
    if (st === 'completed' || st === 'done' || st === 'succeeded') return json;
    if (st === 'failed' || st === 'error' || st === 'cancelled') {
      throw new Error(`worker job ${jid} ${st}: ${json?.error || ''}`);
    }
    await new Promise(r => setTimeout(r, JOB_POLL_MS));
  }
  throw new Error(`worker job ${jid} timed out`);
}

const GPU_SSH_KEY = process.env.GPU_SSH_KEY
  || path.join(process.env.HOME || '/home/ubuntu', '.ssh/kayan_gpu');
const GPU_SSH_TARGET = process.env.GPU_SSH_TARGET || 'ubuntu@127.0.0.1';
const NASHASH_VIDEO_DIR = process.env.NASHASH_VIDEO_DIR
  || path.resolve(process.cwd(), 'uploads', 'videos');

function scpFromGpu(remotePath, localPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('scp', [
      '-i', GPU_SSH_KEY,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'ConnectTimeout=15',
      `${GPU_SSH_TARGET}:${remotePath}`,
      localPath,
    ]);
    let err = '';
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', e => reject(new Error(`scp spawn failed: ${e.message}`)));
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`scp exited ${code}: ${err.slice(0, 400)}`));
    });
  });
}

const VIDEO_PROVIDER = (process.env.VIDEO_PROVIDER || 'kayangpu').toLowerCase();
async function runVideoJob(job) {
  if (VIDEO_PROVIDER === 'external') {
    return await runExternalVideoJob(job);
  }
  const p = job.payload || {};
  const { status, json } = await httpJson('POST', `${VIDEO_URL}/jobs/video`, p, 180_000);
  if (status !== 200 && status !== 202) throw new Error(`video submit HTTP ${status}: ${JSON.stringify(json)}`);
  const jid = json?.job_id || json?.id;
  if (!jid) throw new Error(`video: no job_id: ${JSON.stringify(json)}`);

  // KAYAN-TASK-19-FIX-B+ — I2V cold-load + sampling on A10G exceeds 1h; use 3h for VIDEO_JOB only.
  const done = await pollWorkerJob(VIDEO_URL, jid, 10_800_000);
  const remoteMp4 = done?.output_path || done?.result?.output_path
    || done?.result?.mp4_path || done?.result?.path;
  if (!remoteMp4) throw new Error(`video: no remote mp4 path: ${JSON.stringify(done).slice(0,500)}`);

  // scp from GPU to Nashash
  fs.mkdirSync(NASHASH_VIDEO_DIR, { recursive: true });
  const fileName = `gpu_${jid}.mp4`;
  const localPath = path.join(NASHASH_VIDEO_DIR, fileName);
  await scpFromGpu(remoteMp4, localPath);
  if (!fs.existsSync(localPath) || fs.statSync(localPath).size === 0) {
    throw new Error(`video: scp produced missing/empty file at ${localPath}`);
  }

  // Real verification (spec 24/25) — on LOCAL file
  const { stdout } = await pExec('ffprobe', [
    '-v','error','-show_entries','format=duration','-show_entries','stream=codec_type','-of','json',
    localPath,
  ]);
  const probe = JSON.parse(stdout);
  const dur = Number(probe?.format?.duration ?? 0);
  const hasVideo = (probe?.streams || []).some(s => s.codec_type === 'video');
  if (!(dur > 0) || !hasVideo) throw new Error(`video: ffprobe failed (dur=${dur}, hasVideo=${hasVideo})`);

  return { mp4_path: localPath, remote_path: remoteMp4, duration: dur, worker_jid: jid, probe };
}

async function runLlmJob(job) {
  const p = job.payload || {};

  // Case 1: full script job (from /api/scripts/generate) — has script_payload
  if (p.script_payload) {
    const out = await runScriptJob(p.script_payload);
    return { kind: 'script', ...out };
  }

  // Case 2: raw LLM job — direct call to 8082
  const { status, json } = await httpJson('POST', `${LLM_URL}/jobs/llm`, p, 30_000);
  if (status !== 200 && status !== 202) throw new Error(`llm submit HTTP ${status}: ${JSON.stringify(json)}`);
  const jid = json?.job_id || json?.id;
  if (!jid) throw new Error(`llm: no job_id: ${JSON.stringify(json)}`);

  const done = await pollWorkerJob(LLM_URL, jid, 900_000);
  const result = done?.result;
  if (result === null || result === undefined || (typeof result === 'string' && !result.trim())) {
    throw new Error(`llm: empty result: ${JSON.stringify(done).slice(0,500)}`);
  }
  return { result, worker_jid: jid };
}


const LIPSYNC_ENABLED = (process.env.LIPSYNC_ENABLED || 'false').toLowerCase() === 'true';
const LIPSYNC_URL_EXPLICIT = process.env.LIPSYNC_WORKER_URL || '';
async function runLipSyncJob(job) {
  // KAYAN-B3-FIX: LipSync requires a GPU worker. When disabled, do not
  // attempt any GPU call, do not enqueue a GPU job, and do not fail the
  // pipeline. Mark as skipped with an explicit reason.
  if (!LIPSYNC_ENABLED) {
    return {
      skipped: true,
      reason: 'LIPSYNC_DISABLED_NO_GPU',
      syncedVideoPath: job.payload?.video_path || null,
      syncedVideoUrl: null,
      worker_jid: null,
      note: 'LIPSYNC_ENABLED=false — no GPU worker configured',
    };
  }
  // Enabled: require an explicit worker URL. No silent fallback to localhost.
  if (!LIPSYNC_URL_EXPLICIT) {
    const err: any = new Error(
      'lipsync MISCONFIGURATION: LIPSYNC_ENABLED=true but LIPSYNC_WORKER_URL is not set',
    );
    err.category = 'PERMANENT';
    throw err;
  }
  const LIPSYNC_URL = LIPSYNC_URL_EXPLICIT;
  const p = job.payload || {};
  const video_path = p.video_path;
  const audio_path = p.audio_path;
  if (!video_path || !audio_path) {
    throw new Error(`lipsync: missing video_path/audio_path in payload`);
  }
  const { status, json } = await httpJson('POST', `${LIPSYNC_URL}/jobs/lipsync`, { video_path, audio_path }, 60_000);
  if (status !== 200 && status !== 202) throw new Error(`lipsync submit HTTP ${status}: ${JSON.stringify(json)}`);
  const jid = json?.job_id || json?.id;
  if (!jid) throw new Error(`lipsync: no job_id: ${JSON.stringify(json)}`);
  const done = await pollWorkerJob(LIPSYNC_URL, jid, 3_600_000);
  if (done?.skipped && done?.reason === 'no_face_in_video') {
    const outPath = done?.output_path || video_path;
    return {
      skipped: true,
      reason: 'no_face_in_video',
      syncedVideoPath: outPath,
      syncedVideoUrl: `/uploads/videos/${path.basename(outPath)}`,
      worker_jid: jid,
      note: done?.note || 'lipsync skipped: video contains no human face',
    };
  }
  const remoteMp4 = done?.output_path || done?.result?.output_path
    || done?.result?.mp4_path || done?.result?.path;
  if (!remoteMp4) throw new Error(`lipsync: no remote mp4 path: ${JSON.stringify(done).slice(0,500)}`);
  fs.mkdirSync(NASHASH_VIDEO_DIR, { recursive: true });
  const fileName = `lipsync_${jid}.mp4`;
  const localPath = path.join(NASHASH_VIDEO_DIR, fileName);
  await scpFromGpu(remoteMp4, localPath);
  if (!fs.existsSync(localPath) || fs.statSync(localPath).size === 0) {
    throw new Error(`lipsync: scp produced missing/empty file at ${localPath}`);
  }
  const { stdout } = await pExec('ffprobe', [
    '-v','error','-show_entries','format=duration','-show_entries','stream=codec_type','-of','json',
    localPath,
  ]);
  const probe = JSON.parse(stdout);
  const dur = Number(probe?.format?.duration ?? 0);
  const hasVideo = (probe?.streams || []).some(s => s.codec_type === 'video');
  if (!(dur > 0) || !hasVideo) throw new Error(`lipsync: ffprobe failed (dur=${dur}, hasVideo=${hasVideo})`);
  return { mp4_path: localPath, remote_path: remoteMp4, duration: dur, worker_jid: jid, probe };
}

async function processOne() {
  const next = await GpuQueueService.nextQueued();
  if (!next) return false;
  const acquired = await GpuQueueService.tryAcquireLock(next.id, next.kind);
  if (!acquired) return false;
  await GpuQueueService.markRunning(next.id);
  const hb = setInterval(() => GpuQueueService.heartbeat(next.id).catch(()=>{}), HEARTBEAT_MS);
  try {
    let result: any;
    switch (next.kind) {
      case 'VIDEO_JOB':
        result = await runVideoJob(next);
        break;
      case 'LLM_JOB':
        result = await runLlmJob(next);
        break;
      case 'LIP_SYNC_JOB':
        result = await runLipSyncJob(next);
        break;
      default:
        throw new Error(`Unsupported GPU job kind: ${next.kind}`);
    }
    await GpuQueueService.markCompleted(next.id, result);
    console.log(`[queue] COMPLETED ${next.id} (${next.kind})`);
  } catch (err: any) {
    const category = GpuQueueService.classifyError(err);
    const attempts = Number(next.attempts ?? 0);
    const maxAttempts = 3;
    if (GpuQueueService.isRetryable(category) && attempts < maxAttempts) {
      const reason = `retry [${category}] attempt ${attempts + 1}/${maxAttempts}: ${err?.message || String(err)}`;
      await GpuQueueService.requeue(next.id, reason);
      console.warn(`[queue] RETRY ${next.id} (${next.kind}) category=${category}:`, err?.message || err);
    } else {
      const finalMsg = `[${category}] ${err?.message || String(err)}`;
      await GpuQueueService.markFailed(next.id, finalMsg);
      console.error(`[queue] FAILED ${next.id} (${next.kind}) category=${category}:`, err?.message || err);
    }
  } finally {
    clearInterval(hb);
    await GpuQueueService.releaseLock(next.id);
  }
  return true;
}

async function watchdog() {
  try {
    const r = await GpuQueueService.watchdogStaleRunning(STALE_THRESHOLD_MS);
    if (r.failedJobs > 0 || r.lockFreed) {
      console.warn(`[watchdog] stale RUNNING -> FAILED: ${r.failedJobs}, lock freed: ${r.lockFreed}`);
    }
  } catch (e) {
    console.error('[watchdog] error', e);
  }
}

async function boot() {
  const rec = await GpuQueueService.recoverStale();
  console.log('[queue] boot recovery', rec);
}

async function loop() {
  await boot();
  setInterval(watchdog, WATCHDOG_MS);
  await watchdog();
  while (!stopping) {
    try {
      const didWork = await processOne();
      if (!didWork) await new Promise(r => setTimeout(r, POLL_MS));
    } catch (e) {
      console.error('[queue] loop error', e);
      await new Promise(r => setTimeout(r, POLL_MS));
    }
  }
}

process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT',  () => { stopping = true; });

loop().catch(e => { console.error(e); process.exit(1); });
