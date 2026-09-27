#!/usr/bin/env python3
"""
Kayan face-presence probe. No GPU. Runs on Nashash.
Reads N evenly-spaced frames via ffmpeg pipe, runs OpenCV Haar cascade.
Prints a JSON line to stdout and exits 0 even on "no face".
"""
import sys, os, json, subprocess, tempfile, shutil

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"has_face": False, "reason": "usage: face_detect.py <video> [samples]"}))
        return 0
    vid = sys.argv[1]
    samples = int(sys.argv[2]) if len(sys.argv) > 2 else 10
    if not os.path.isfile(vid):
        print(json.dumps({"has_face": False, "reason": "file_missing"}))
        return 0

    try:
        import cv2
    except Exception as e:
        print(json.dumps({"has_face": False, "reason": f"cv2_import_failed: {e}"}))
        return 0

    try:
        out = subprocess.run(
            ["ffprobe","-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1", vid],
            capture_output=True, text=True, check=True
        )
        dur = float(out.stdout.strip() or "0")
    except Exception:
        dur = 0.0

    if dur <= 0.1:
        print(json.dumps({"has_face": False, "reason": "zero_duration", "sampled_frames": 0, "face_frames": 0}))
        return 0

    tmp = tempfile.mkdtemp(prefix="face_")
    try:
        n = max(3, min(samples, 20))
        step = dur / (n + 1)
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        cascade = cv2.CascadeClassifier(cascade_path)

        face_frames = 0
        sampled = 0
        for i in range(1, n + 1):
            t = step * i
            fp = os.path.join(tmp, f"f_{i}.jpg")
            r = subprocess.run(
                ["ffmpeg","-y","-loglevel","error","-ss",f"{t:.3f}","-i", vid,
                 "-frames:v","1","-q:v","3", fp],
                capture_output=True, text=True
            )
            if not os.path.isfile(fp) or os.path.getsize(fp) == 0:
                continue
            img = cv2.imread(fp)
            if img is None:
                continue
            sampled += 1
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(40,40))
            if len(faces) > 0:
                face_frames += 1

        conf = (face_frames / sampled) if sampled else 0.0
        has_face = sampled >= 3 and conf >= 0.4
        print(json.dumps({
            "has_face": bool(has_face),
            "face_frames": face_frames,
            "sampled_frames": sampled,
            "confidence": round(conf, 3),
            "reason": "ok" if has_face else "insufficient_face_frames",
        }))
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    sys.exit(main())
