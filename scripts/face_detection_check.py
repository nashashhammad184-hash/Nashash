#!/usr/bin/env python3
"""
KAYAN-TASK-19-PRE — Standalone face detection checker.

PURPOSE:
    Diagnostic-only tool. Reads an image, runs OpenCV Haar Cascade face
    detection, and reports the face count. Does NOT modify DB, does NOT
    register canonical faces, does NOT touch production pipeline.

USAGE:
    python3 scripts/face_detection_check.py <image_path>
"""
import sys
import os
import json

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: face_detection_check.py <image_path>"}))
        sys.exit(1)

    img_path = sys.argv[1]
    result = {
        "image_path": img_path,
        "exists": os.path.exists(img_path),
        "width": None,
        "height": None,
        "face_count": 0,
        "detection_success": False,
        "error": None,
    }

    if not result["exists"]:
        result["error"] = "file_not_found"
        print(json.dumps(result, indent=2))
        sys.exit(2)

    try:
        import cv2
    except Exception as e:
        result["error"] = f"cv2_import_failed: {e}"
        print(json.dumps(result, indent=2))
        sys.exit(3)

    try:
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        if not os.path.exists(cascade_path):
            result["error"] = f"cascade_missing: {cascade_path}"
            print(json.dumps(result, indent=2))
            sys.exit(4)
        cc = cv2.CascadeClassifier(cascade_path)
        if cc.empty():
            result["error"] = "cascade_load_failed"
            print(json.dumps(result, indent=2))
            sys.exit(5)
    except Exception as e:
        result["error"] = f"cascade_init_error: {e}"
        print(json.dumps(result, indent=2))
        sys.exit(6)

    try:
        img = cv2.imread(img_path)
        if img is None:
            result["error"] = "image_read_failed (not a valid image or unsupported format)"
            print(json.dumps(result, indent=2))
            sys.exit(7)
    except Exception as e:
        result["error"] = f"image_read_error: {e}"
        print(json.dumps(result, indent=2))
        sys.exit(8)

    result["width"] = int(img.shape[1])
    result["height"] = int(img.shape[0])

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)

    faces = cc.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(30, 30),
        flags=cv2.CASCADE_SCALE_IMAGE,
    )

    result["face_count"] = int(len(faces))
    result["detection_success"] = True
    result["cv2_version"] = cv2.__version__
    result["cascade_path"] = cascade_path

    # Include bounding boxes (x, y, w, h) as evidence, no image writing
    result["faces"] = [{"x": int(x), "y": int(y), "w": int(w), "h": int(h)} for (x, y, w, h) in faces]

    print(json.dumps(result, indent=2))
    sys.exit(0 if result["face_count"] > 0 else 10)


if __name__ == "__main__":
    main()
