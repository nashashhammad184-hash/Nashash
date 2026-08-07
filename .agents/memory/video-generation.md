---
name: Video generation lifecycle
description: The studio's video generation contract, provider polling boundary, and playback invariant.
---

**Rule:** The frontend must make one `POST /api/video/generate` request per user click and must only mount `<video>` after the response has `status: completed` and a validated video URL. Provider polling belongs on the API server, with request timeouts, terminal failure detection, and a hard attempt limit.

**Why:** The original production player only animated a local timer and never consumed a generated URL, which created an infinite/black rendering experience. Keeping polling server-side prevents duplicated browser loops and lets the API normalize different provider response shapes.

**How to apply:** Configure `VIDEO_ENGINE_API_URL`, optionally `VIDEO_ENGINE_API_KEY` and `VIDEO_ENGINE_STATUS_URL_TEMPLATE` for a real provider. Keep the demo MP4 fallback only as a local smoke-test path; do not turn the frontend back into a timer-based simulator.