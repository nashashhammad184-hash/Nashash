import os
import hashlib
import requests

def make_idem_key(project_id, shot_id, tag, text, target_duration_s):
    text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
    dur = f"{float(target_duration_s):.3f}"
    raw = f"{project_id}|{shot_id}|{tag}|{text_hash}|{dur}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

def generate_mp3(text, tag, voice, target_duration_s, idem_key, audio_prompt_path=None, ref_text=None):
    import re
    m = re.match(r"^\s*\[(\w+)\]", text)
    real_tag = m.group(1) if m else "neutral"
    audar_url = os.environ.get("AUDAR_URL")
    audar_token = os.environ.get("AUDAR_TOKEN")
    if not audar_url or not audar_token:
        raise RuntimeError("AUDAR_URL or AUDAR_TOKEN missing in environment")
    
    payload = {
        "text": text,
        "tag": real_tag,
        "voice": voice,
        "target_duration_s": float(target_duration_s),
    }
    if audio_prompt_path:
        payload["audio_prompt_path"] = audio_prompt_path
    if ref_text:
        payload["ref_text"] = ref_text

    r = requests.post(
        f"{audar_url}/tts",
        headers={
            "Authorization": f"Bearer {audar_token}",
            "Idempotency-Key": idem_key,
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=200,
    )
    if r.status_code != 200:
        raise RuntimeError(f"Oracle {r.status_code}: {r.text[:200]}")
    if not r.content:
        raise RuntimeError("Oracle returned empty body")
    return r.content
