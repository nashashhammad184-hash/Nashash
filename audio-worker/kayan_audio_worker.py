import os
import time
import threading
import requests
import re
from audar_client import generate_mp3, make_idem_key
from worker_state import load as load_state, set_stage, clear as clear_state

KAYAN_URL = "https://nashash-1.onrender.com"
API_TOKEN = os.environ.get("KAYAN_API_TOKEN", "")
WORKER_NAME = "phone-samsung-01"
VOICE = "demo_female_1"

ALLOWED_TAGS = {"laughs", "curious", "excited", "sighs", "exhales", "mischievously", "whispers", "sarcastic"}
                "laughs", "sarcastic", "mischievously", "neutral"}

def parse_tag(text):
    m = re.match(r"^\s*\[(\w+)\]", text or "")
    if m and m.group(1).lower() in ALLOWED_TAGS:
        return m.group(1).lower()
    return "neutral"

def heartbeat_loop():
    print("[Heartbeat] Thread started.", flush=True)
    while True:
        try:
            requests.post(
                f"{KAYAN_URL}/api/workers/heartbeat",
                headers={"Authorization": f"Bearer {API_TOKEN}", "Origin": KAYAN_URL},
                json={"name": WORKER_NAME, "metadata": {"pid": os.getpid()}},
                timeout=15,
            )
        except Exception as e:
            print(f"[Heartbeat] {e}", flush=True)
        time.sleep(30)

def login():
    print("Logging in to KAYAN...", flush=True)
    try:
        session = requests.Session()
        session.headers.update({"Origin": KAYAN_URL})
        res = session.post(f"{KAYAN_URL}/api/auth/login",
                           json={"token": API_TOKEN}, timeout=90)
        if res.status_code == 200:
            print("Login successful.", flush=True)
            return session
        print(f"Login failed: {res.status_code} {res.text[:200]}", flush=True)
        return None
    except Exception as e:
        print(f"Login error: {e}", flush=True)
        return None

def process_shot(session, shot, state):
    shot_id = shot["shotId"]
    project_id = shot["projectId"]
    dialogue_text = (shot.get("dialogue") or "").strip()
    resolved = shot.get("resolvedText")
    if resolved and resolved.strip():
        text = resolved.strip()
        tag = "resolved"
    else:
        text = dialogue_text
        tag = parse_tag(dialogue_text)
    target_duration = float(shot.get("durationSeconds") or 5.0)

    if not text:
        return False

    entry = state.get(str(shot_id), {})
    stage = entry.get("stage")
    if stage == "patched":
        clear_state(state, shot_id)
        return False

    claim_token = entry.get("claim_token")
    if not claim_token:
        print(f"  Claiming shot {shot_id}...", flush=True)
        r = session.post(f"{KAYAN_URL}/api/shots/{shot_id}/claim", json={}, timeout=30)
        if r.status_code != 200:
            print(f"  Claim failed: {r.status_code} {r.text[:100]}", flush=True)
            return False
        claim_token = r.json().get("claimToken")
        set_stage(state, shot_id, stage or "none", claim_token=claim_token)
        entry = state[str(shot_id)]
        stage = entry.get("stage")

    print(f"\n--- Shot {shot_id} (P{project_id}) stage={stage} tag={tag} ---", flush=True)
    idem = entry.get("idem_key") or make_idem_key(project_id, shot_id, tag, text, target_duration)

    mp3_bytes = None
    try:
        if stage != "uploaded":
            print("  Oracle /tts...", flush=True)
            mp3_bytes = generate_mp3(text, tag, VOICE, target_duration, idem)
            print(f"  Oracle OK: {len(mp3_bytes)} bytes", flush=True)
            set_stage(state, shot_id, "generated", idem_key=idem, claim_token=claim_token)
            entry = state[str(shot_id)]

        file_path = entry.get("signed_file_path")
        signed_url = entry.get("signed_url")

        if not file_path:
            if mp3_bytes is None:
                mp3_bytes = generate_mp3(text, tag, VOICE, target_duration, idem)
            payload = {
                "projectId": project_id,
                "shotId": shot_id,
                "mimeType": "audio/mpeg",
                "fileSize": len(mp3_bytes),
            }
            r = session.post(f"{KAYAN_URL}/api/storage/sign-upload",
                             json=payload, timeout=60)
            if r.status_code != 200:
                print(f"  sign-upload {r.status_code}: {r.text[:150]}", flush=True)
                return False
            data = r.json()
            file_path = data["filePath"]
            signed_url = data["signedUrl"]
            set_stage(state, shot_id, "generated",
                      idem_key=idem, signed_file_path=file_path,
                      signed_url=signed_url, size=len(mp3_bytes), claim_token=claim_token)
            entry = state[str(shot_id)]

        if stage != "uploaded":
            if mp3_bytes is None:
                mp3_bytes = generate_mp3(text, tag, VOICE, target_duration, idem)
            print("  PUT to signedUrl...", flush=True)
            r = requests.put(signed_url, data=mp3_bytes,
                             headers={"Content-Type": "audio/mpeg"}, timeout=60)
            if r.status_code not in (200, 201):
                print(f"  PUT {r.status_code}: {r.text[:150]}", flush=True)
                return False
            print("  PUT OK", flush=True)
            set_stage(state, shot_id, "uploaded",
                      idem_key=idem, signed_file_path=file_path,
                      signed_url=signed_url, size=len(mp3_bytes), claim_token=claim_token)

        r = session.head(f"{KAYAN_URL}/api/storage/supabase/{file_path}",
                         allow_redirects=True, timeout=30)
        if r.status_code != 200:
            print(f"  HEAD {r.status_code}: file not verified", flush=True)
            return False

        audio_url = f"/api/storage/supabase/{file_path}"
        r = session.patch(f"{KAYAN_URL}/api/shots/{shot_id}",
                          json={"audioUrl": audio_url,
                                "audioStatus": "PROCESSING",
                                "claimToken": claim_token},
                          timeout=60)
        if r.status_code != 200:
            print(f"  PATCH {r.status_code}: {r.text[:150]}", flush=True)
            if r.status_code == 409:
                print("  Claim mismatch. Clearing state.", flush=True)
                clear_state(state, shot_id)
            return False

        set_stage(state, shot_id, "patched",
                  idem_key=idem, signed_file_path=file_path,
                  audio_url=audio_url, claim_token=claim_token)
        print(f"  ✅ Shot {shot_id} -> PROCESSING (pipeline will consume)", flush=True)
        return True

    except Exception as e:
        print(f"  ❌ Shot {shot_id}: {e}", flush=True)
        try:
            session.patch(f"{KAYAN_URL}/api/shots/{shot_id}",
                          json={"audioStatus": "FAILED"}, timeout=30)
        except Exception:
            pass
        clear_state(state, shot_id)
        return False

def _fetch_shot(session, project_id, shot_id):
    try:
        r = session.get(f"{KAYAN_URL}/api/projects/{project_id}/shots", timeout=60)
        if r.status_code != 200:
            return None
        for s in r.json():
            if s.get("id") == int(shot_id):
                return {
                    "shotId": s["id"],
                    "projectId": s["projectId"],
                    "dialogue": s.get("dialogue"),
                    "durationSeconds": s.get("durationSeconds"),
                }
    except Exception as e:
        print(f"[resume] fetch failed for {shot_id}: {e}", flush=True)
    return None

def main():
    print(f"KAYAN Audio Worker ({WORKER_NAME}) [KAYAN-12C] started...", flush=True)

    hb_thread = threading.Thread(target=heartbeat_loop, daemon=True)
    hb_thread.start()

    state = load_state()
    if state:
        print(f"[State] Resuming {len(state)} shots from disk", flush=True)

    session = login()
    if not session:
        time.sleep(10)
        return

    while True:
        try:
            for shot_id_str in list(state.keys()):
                entry = state.get(shot_id_str, {})
                if entry.get("stage") == "patched":
                    clear_state(state, shot_id_str)
                    continue
                project_id = entry.get("project_id") or entry.get("projectId")
                if not project_id:
                    clear_state(state, shot_id_str)
                    continue
                shot = _fetch_shot(session, project_id, shot_id_str)
                if not shot:
                    print(f"[Resume] shot {shot_id_str} not found, dropping", flush=True)
                    clear_state(state, shot_id_str)
                    continue
                process_shot(session, shot, state)
                time.sleep(2)

            r = session.get(f"{KAYAN_URL}/api/worker/audio-queue?limit=5", timeout=60)
            if r.status_code == 200:
                shots = r.json().get("shots", [])
                if shots:
                    print(f"[Queue] {len(shots)} QUEUED", flush=True)
                    for shot in shots:
                        process_shot(session, shot, state)
                        time.sleep(2)
                else:
                    print("Waiting for QUEUED shots...", flush=True)
            else:
                print(f"[Queue] {r.status_code}", flush=True)

        except Exception as e:
            print(f"[Main] {e}", flush=True)
            session = login()

        time.sleep(30)

if __name__ == "__main__":
    main()
