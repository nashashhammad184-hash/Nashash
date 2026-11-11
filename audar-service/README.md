# Audar-Flash Voice Cloning (Validated)

## Status: PRODUCTION (2026-11-11)

## What Works
- Voice cloning from 10-15s sample
- Arabic dialects (from reference sample): Jordanian, Shami, Gulf, Egyptian
- Inline tags: [whispers] [laughs] [sad] [excited] [curious] [sarcastic] [mischievously] [neutral]
- Long texts (tested 17 words, no hallucination)
- Voice identity consistent across scenes
- E2E Pipeline: DB -> Samsung Worker -> Audar-Flash -> Supabase -> Render

## Architecture
character_voice_profiles (Supabase)
  - engine: 'audar'
  - ref_wav_path: '/home/ubuntu/tts-test/samples/<name>.wav'
  - ref_text: '<transcript>'
       |
       v LEFT JOIN
worker/audio-queue (Render)
  - refWavPath + refText
       |
       v HTTP
Samsung Worker
  - audio_prompt_path + ref_text
       |
       v POST /tts
Audar-Flash (Oracle:8080)
  - Voice cloning + inline tags

## Randomness (Expected Behavior)
- Same input -> different nuance per run (scared, horror, frustration)
- Reason: temp=0.7 (whispers) / 1.0 (others) + top_k=40 + top_p=0.9
- Usage: 3 takes + choose best (Sprint C)

## Endpoint
POST /tts
Headers: Authorization Bearer TOKEN, Idempotency-Key UNIQUE
Body: text, tag, voice, target_duration_s, audio_prompt_path, ref_text

## Constraints
- Sample must be on Oracle at /home/ubuntu/...
- Clean sample: mono, 16kHz, 10-15s
- ref_text must match sample content
- 12-15x realtime (acceptable for Offline Generation)

## Validation (2026-11-11)

### Sprint B E2E Test (Shot 767)
- Text: شو أخبارك يا زلمة؟ وين كنت مبارح؟ أنا كثير مبسوط بشوفتك
- Sample: user_voice_trimmed.wav (7.24s)
- Result: Jordanian dialect + voice cloning + no hallucination + quality 4-5/5
- Duration: 5.07s (target 5s)

### Previous Direct Tests
- 17-word Jordanian text: 10.03s (target 10s)
- whispers: 3 runs (scared/horror/frustration)
- laughs: works
- sad: works
- Voice consistency: same persona

## Lahgtna - Status: Disabled (2026-11-11)
- Service stopped + disabled
- Files preserved at /home/ubuntu/tts-test/lahgtna_gguf/ (1.4 GB)
- Reason: Audar-Flash superior in 8/9 criteria
- Restore: sudo systemctl enable lahgtna + sudo systemctl start lahgtna
