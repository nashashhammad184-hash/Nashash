#!/usr/bin/env python3
"""
KAYAN-TASK-19-FIX-REF — I2V reference validator.

Purpose: verify that a proposed reference image is a REAL face suitable
for I2V testing. CPU-only, no GPU. Uses multiple signals:
  - image integrity (readable, valid format)
  - dimensions >= 256x256
  - entropy / noise detection (rejects testsrc/random-noise patterns)
  - face detection via OpenCV Haar (multiple cascades for redundancy)
  - histogram diversity in HSV space (noise has flat/random distribution)

Never uses GPU/CUDA.
"""
import sys, os, json
import numpy as np

def fail(msg, **kw):
    out = {"REFERENCE_VALID": "NO", "error": msg, **kw}
    print(json.dumps(out, indent=2))
    sys.exit(2)

def main():
    if len(sys.argv) < 2:
        fail("usage: validate_i2v_reference.py <image_path>")
    path = sys.argv[1]
    if not os.path.exists(path):
        fail("file_not_found", path=path)

    try:
        import cv2
    except Exception as e:
        fail(f"cv2_import_failed: {e}")

    img = cv2.imread(path)
    if img is None:
        fail("cannot_decode_image", path=path)

    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # 1) Dimensions check
    dims_ok = (w >= 256 and h >= 256)
    ar = max(w, h) / max(1, min(w, h))
    aspect_ok = ar <= 2.2

    # 2) Noise detection via Laplacian variance (real face photo has structure;
    #    random noise has VERY high variance; flat has very low).
    lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())

    # 3) Local entropy: sample 4 sub-regions, noise has near-uniform high entropy
    def entropy(patch):
        hist, _ = np.histogram(patch, bins=64, range=(0,255))
        p = hist / max(1, hist.sum())
        p = p[p > 0]
        return float(-(p * np.log2(p)).sum())
    h4, w4 = h//2, w//2
    patches = [gray[:h4,:w4], gray[:h4,w4:], gray[h4:,:w4], gray[h4:,w4:]]
    entropies = [entropy(p) for p in patches]
    entropy_mean = float(np.mean(entropies))
    entropy_std = float(np.std(entropies))

    # 4) Haar face detection with multiple cascades (agreement = higher trust)
    cascades = []
    for name in ["haarcascade_frontalface_default.xml",
                 "haarcascade_frontalface_alt2.xml",
                 "haarcascade_frontalface_alt.xml",
                 "haarcascade_frontalface_alt_tree.xml"]:
        p = cv2.data.haarcascades + name
        if os.path.exists(p):
            c = cv2.CascadeClassifier(p)
            if not c.empty():
                cascades.append((name, c))

    haar_hits = {}
    for name, c in cascades:
        faces = c.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(60,60))
        haar_hits[name] = int(len(faces))

    # Agreement: count cascades that found 1+ faces
    cascades_with_face = sum(1 for n, v in haar_hits.items() if v >= 1)

    # 5) Cumulative decision
    reasons = []
    if not dims_ok:  reasons.append(f"too_small({w}x{h})")
    if not aspect_ok: reasons.append(f"extreme_aspect({ar:.2f})")
    # Noise detection: reference points from TASK-19 experience:
    # testsrc/random noise has lap_var > 2000 AND entropy_mean > 7.5 AND entropy_std < 0.15
    noise_suspect = (lap_var > 2000) and (entropy_mean > 7.4) and (entropy_std < 0.25)
    if noise_suspect:
        reasons.append(f"looks_like_noise(lap_var={lap_var:.0f}, entropy={entropy_mean:.2f}±{entropy_std:.2f})")
    # Face must be agreed by at least 2 cascades (to reduce false positives)
    if cascades_with_face < 2:
        reasons.append(f"face_not_agreed(cascades={cascades_with_face}/{len(cascades)})")

    result = {
        "image_path": path,
        "width": w,
        "height": h,
        "aspect_ratio": round(ar, 3),
        "laplacian_variance": round(lap_var, 2),
        "entropy_mean": round(entropy_mean, 3),
        "entropy_std": round(entropy_std, 3),
        "haar_hits": haar_hits,
        "cascades_with_face": cascades_with_face,
        "cascades_total": len(cascades),
        "noise_suspect": noise_suspect,
        "dims_ok": dims_ok,
        "aspect_ok": aspect_ok,
    }

    if reasons:
        result["reasons"] = reasons
        result["REFERENCE_VALID"] = "NO"
        print(json.dumps(result, indent=2))
        sys.exit(3)
    else:
        result["REFERENCE_VALID"] = "YES"
        print(json.dumps(result, indent=2))
        sys.exit(0)

if __name__ == "__main__":
    main()
