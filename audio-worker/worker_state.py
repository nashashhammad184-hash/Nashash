import os
import json
import time
import tempfile

STATE_FILE = os.path.expanduser("~/.kayan_worker_state.json")

def load():
    if not os.path.exists(STATE_FILE):
        return {}
    try:
        with open(STATE_FILE) as f:
            return json.load(f) or {}
    except Exception:
        return {}

def _atomic_write(data):
    d = os.path.dirname(STATE_FILE) or "."
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".worker_state.")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.chmod(tmp, 0o600)
        os.replace(tmp, STATE_FILE)
    except Exception:
        try:
            os.unlink(tmp)
        except Exception:
            pass
        raise

def set_stage(state, shot_id, stage, **extra):
    key = str(shot_id)
    entry = state.get(key, {})
    entry.update(stage=stage, ts=int(time.time()), **extra)
    state[key] = entry
    _atomic_write(state)

def clear(state, shot_id):
    state.pop(str(shot_id), None)
    _atomic_write(state)

