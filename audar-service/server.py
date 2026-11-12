import os, time, gc, ctypes, re, uuid, asyncio, hashlib, json, io, subprocess, tempfile, logging
from collections import OrderedDict
from typing import Optional

import torch
import librosa
import soundfile as sf
from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse, Response as RawResponse
from pydantic import BaseModel, Field
from llama_cpp import Llama
from neucodec import NeuCodec

LOG = logging.getLogger("audar")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

APP_VERSION = "1.0.0"
START_TS = time.time()
AUDAR_DIR = "/home/ubuntu/audar"
GGUF_Q4 = f"{AUDAR_DIR}/Audar-TTS-V1-Flash-Q4_K_M.gguf"
GGUF_Q8 = f"{AUDAR_DIR}/Audar-TTS-V1-Flash-Q8_0.gguf"
REFS = {
    "demo_female_1": f"{AUDAR_DIR}/samples/ref_5s_16k.wav",
    "demo_female_2": f"{AUDAR_DIR}/samples/ref_5s_16k.wav",
    "demo_female_3": f"{AUDAR_DIR}/samples/ref_5s_16k.wav",
    "demo_male_1":   f"{AUDAR_DIR}/samples/ref_5s_16k.wav",
    "demo_male_2":   f"{AUDAR_DIR}/samples/ref_5s_16k.wav",
    "demo_male_3":   f"{AUDAR_DIR}/samples/ref_5s_16k.wav",
}
REF_TEXT = "هل تعرف أن الفلافل لم تخترع في الشام؟ وإنما يرجع أصلها إلى مصر؟"
ALLOWED_TAGS = {"whispers","excited","curious","laughs","sarcastic","mischievously","sighs","exhales","neutral"}
AUTH_TOKEN = os.environ.get("AUDAR_AUTH_TOKEN", "").strip()
TTL_SEC = 600

def ram_mb(): return int(0)
import psutil
def ram_mb(): return psutil.Process().memory_info().rss // (1024*1024)
def trim():
    gc.collect()
    try: ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception: pass

_lock: Optional[asyncio.Lock] = None
_current_model: Optional[str] = None  # "Q4_K_M" | "Q8_0"
_llm: Optional[Llama] = None
_ttl_last_ts = 0.0
_peak_rss_mb = 0
_requests_ok = 0
_requests_fail = 0

_idem_inflight: dict[str, asyncio.Event] = {}
_idem_cache: "OrderedDict[str, dict]" = OrderedDict()
_IDEM_MAX = 20
_IDEM_TTL = 300

class TTSBody(BaseModel):
    text: str
    tag: str = "neutral"
    voice: str = "demo_female_1"
    target_duration_s: float = Field(gt=0, le=15.0)
    audio_prompt_path: Optional[str] = None
    ref_text: Optional[str] = None

def _auth(authorization: Optional[str]):
    if not AUTH_TOKEN:
        raise HTTPException(500, {"error":"SERVER_NOT_CONFIGURED"})
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, {"error":"UNAUTHORIZED"})
    if authorization[7:] != AUTH_TOKEN:
        raise HTTPException(401, {"error":"UNAUTHORIZED"})

def _validate(b: TTSBody):
    if not (5 <= len(b.text) <= 2000):
        raise HTTPException(400, {"error":"INVALID_TEXT","hint":"5-2000 chars"})
    if b.tag not in ALLOWED_TAGS:
        raise HTTPException(400, {"error":"INVALID_TAG","hint":sorted(ALLOWED_TAGS)})
    if b.voice not in REFS:
        raise HTTPException(400, {"error":"INVALID_VOICE","hint":list(REFS.keys())})

def _sha(b: TTSBody) -> str:
    raw = json.dumps({"text":b.text,"tag":b.tag,"voice":b.voice,"target_duration_s":b.target_duration_s}, sort_keys=True).encode()
    return hashlib.sha256(raw).hexdigest()

def _update_peak():
    global _peak_rss_mb
    m = ram_mb()
    if m > _peak_rss_mb: _peak_rss_mb = m

def _free_codec():
    trim()

def _free_llama():
    global _llm, _current_model
    if _llm is not None:
        try: _llm.close()
        except Exception: pass
        _llm = None
    _current_model = None
    trim()

def _load_llama(desired: str):
    global _llm, _current_model, _ttl_last_ts
    path = GGUF_Q8 if desired == "Q8_0" else GGUF_Q4
    LOG.info(f"llama_loading model={desired} path={path}")
    _llm = Llama(model_path=path, n_ctx=1024, n_gpu_layers=0, verbose=False, n_threads=2)
    _current_model = desired
    _ttl_last_ts = time.time()
    _update_peak()
    LOG.info(f"llama_loaded model={desired} rss_mb={ram_mb()}")

def _gen_codes(text: str, tag: str, desired: str, custom_ref: Optional[str] = None, custom_ref_text: Optional[str] = None) -> list[int]:
    # phased: encode -> free -> llama -> free -> return codes
    ref_wav = custom_ref if custom_ref else REFS["demo_female_1"]
    codec = NeuCodec.from_pretrained("eugenehp/neucodec").eval()
    w, _ = librosa.load(ref_wav, sr=16000, mono=True)
    with torch.no_grad():
        ref = codec.encode_code(torch.from_numpy(w).float()[None,None,:])
    ref_codes = ref.squeeze().tolist()
    _update_peak()
    del codec, ref, w
    trim()

    if _current_model != desired:
        _free_llama()
        _load_llama(desired)

    ref_str = "".join(f"<|speech_{c}|>" for c in ref_codes)
    effective_text = f"[{tag}] {text}" if tag and tag != "neutral" else text
    prompt = (f"user: Convert the text to speech:"
                  f"<|REF_TEXT_START|>{custom_ref_text if custom_ref_text else REF_TEXT}<|REF_TEXT_END|>"
                  f"<|REF_SPEECH_START|>{ref_str}<|REF_SPEECH_END|>"
                  f"<|TARGET_TEXT_START|>{effective_text}<|TARGET_TEXT_END|>"
                  f"\nassistant:<|TARGET_CODES_START|>")
    tce = _llm.tokenize(b"<|TARGET_CODES_END|>", add_bos=False, special=True)[0]
    toks = _llm.tokenize(prompt.encode(), add_bos=False, special=True)
    temp = 1.0
    out = []
    for tid in _llm.generate(toks, temp=temp, top_k=40, top_p=0.9, repeat_penalty=1.1):
        if tid == tce or len(out) >= 800: break
        t = _llm.detokenize([tid], special=True).decode("utf-8","ignore")
        m = re.search(r"<\|speech_(\d+)\|>", t)
        if m: out.append(int(m.group(1)))
    _update_peak()
    return out

def _codes_to_mp3(codes: list[int], target_duration: float) -> bytes:
    import uuid
    codec = NeuCodec.from_pretrained("eugenehp/neucodec").eval()
    with torch.no_grad():
        wav = codec.decode_code(torch.tensor(codes)[None,None,:]).detach().cpu().numpy()[0,0,:]
    _update_peak()
    del codec
    trim()
    tts_dur = len(wav)/24000.0
    ratio = tts_dur / target_duration
    if ratio > 1.6:
        raise HTTPException(422, {"error":"SHOT_TOO_SHORT_FOR_AUDIO","tts_duration_s":round(tts_dur,3),"target_s":target_duration,"ratio":round(ratio,3)})

    wav_in = f"/tmp/in_{uuid.uuid4().hex}.wav"
    mp3_out = f"/tmp/out_{uuid.uuid4().hex}.mp3"
    sf.write(wav_in, wav, 24000)
    extra_args = []
    if ratio > 1.0:
        af = f"atempo={min(ratio,1.6):.4f}"
    else:
        af = "apad"
        extra_args = ["-t", f"{target_duration:.3f}"]

    try:
        subprocess.run(["/usr/bin/ffmpeg","-y","-i",wav_in,"-af",af,*extra_args,"-c:a","libmp3lame","-b:a","128k","-ar","44100",mp3_out], check=True, capture_output=True, timeout=60)
        dur = float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",mp3_out]).decode().strip())
        if abs(dur - target_duration) > 0.10:
            raise HTTPException(500, {"error":"DURATION_MISMATCH","got":dur,"want":target_duration})
        
        data = open(mp3_out,"rb").read()
        if len(data) == 0:
            raise HTTPException(500, {"error":"EMPTY_OUTPUT","detail":"ffmpeg produced 0 bytes"})
        return data
    finally:
        if os.path.exists(wav_in): os.remove(wav_in)
        if os.path.exists(mp3_out): os.remove(mp3_out)


app = FastAPI(title="Audar TTS Service")

@app.on_event("startup")
async def _startup():
    global _lock
    _lock = asyncio.Lock()

@app.get("/health")
async def health():
    return {"status":"ok","version":APP_VERSION}

@app.get("/health/detail")
async def health_detail(authorization: Optional[str] = Header(None)):
    _auth(authorization)
    now = time.time()
    return {
        "status":"ok","version":APP_VERSION,
        "model_loaded":_current_model,
        "rss_mb":ram_mb(),"peak_rss_mb":_peak_rss_mb,
        "requests_ok":_requests_ok,"requests_failed":_requests_fail,
        "ttl_last_activity_sec_ago": int(now-_ttl_last_ts) if _ttl_last_ts else None,
        "ttl_will_swap_in_sec": int(max(0, _TTL_SEC if False else TTL_SEC-(now-_ttl_last_ts))) if _ttl_last_ts else None,
        "uptime_sec": int(now-START_TS),
    }

async def _run_tts(job_id: str, body: TTSBody, body_hash: str):
    global _requests_ok, _requests_fail, _ttl_last_ts
    async with _lock:
        try:
            desired = "Q8_0"  # always Q8 for quality
            codes = await asyncio.to_thread(_gen_codes, body.text, body.tag, desired, body.audio_prompt_path, body.ref_text)
            mp3 = await asyncio.to_thread(_codes_to_mp3, codes, body.target_duration_s)
            _idem_cache[job_id] = {"body_hash":body_hash,"bytes":mp3,"ts":time.time()}
            while len(_idem_cache) > _IDEM_MAX:
                _idem_cache.popitem(last=False)
            _requests_ok += 1
            return mp3
        except HTTPException:
            _requests_fail += 1
            raise
        except Exception as e:
            _requests_fail += 1
            LOG.exception("tts_failed")
            raise HTTPException(500, {"error":"INTERNAL"})
        finally:
            _ttl_last_ts = time.time()
            ev = _idem_inflight.pop(job_id, None)
            if ev: ev.set()

@app.post("/tts")
async def tts(body: TTSBody, request: Request, authorization: Optional[str] = Header(None), idempotency_key: Optional[str] = Header(None)):
    _auth(authorization)
    _validate(body)
    if not idempotency_key:
        raise HTTPException(400, {"error":"MISSING_IDEMPOTENCY_KEY"})
    bh = _sha(body)

    if idempotency_key in _idem_inflight:
        try:
            await asyncio.wait_for(_idem_inflight[idempotency_key].wait(), timeout=220)
        except asyncio.TimeoutError:
            raise HTTPException(504, {"error":"IDEMPOTENCY_WAIT_TIMEOUT"})
    if idempotency_key in _idem_cache:
        c = _idem_cache[idempotency_key]
        if c["body_hash"] != bh:
            raise HTTPException(409, {"error":"IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY"})
        if time.time() - c["ts"] <= _IDEM_TTL:
            _idem_cache.move_to_end(idempotency_key)
            return RawResponse(content=c["bytes"], media_type="audio/mpeg", headers={"X-Idempotency-Hit":"true","X-Audar-Model":_current_model or "unknown"})
        del _idem_cache[idempotency_key]

    ev = asyncio.Event()
    _idem_inflight[idempotency_key] = ev
    task = asyncio.create_task(_run_tts(idempotency_key, body, bh))
    try:
        mp3 = await asyncio.shield(task)
    except asyncio.CancelledError:
        LOG.warning("client_disconnect_task_continues")
        raise
    return RawResponse(content=mp3, media_type="audio/mpeg", headers={"X-Idempotency-Hit":"false","X-Audar-Model":_current_model or "unknown","X-Audar-Tag":body.tag})

@app.get("/test_tts")
def test_tts():
    codes = [1, 2, 3, 4, 5] * 20
    try:
        mp3 = _codes_to_mp3(codes, 5.0)
        return {"len": len(mp3)}
    except Exception as e:
        return {"error": str(e)}