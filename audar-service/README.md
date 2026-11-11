# Audar-Flash Voice Cloning (Validated)

## ما يعمل
- ✅ استنساخ صوت من عينة 10-15s
- ✅ لهجة أردنية/شامية (تنتقل من العينة المرجعية)
- ✅ inline tags: [whispers] [laughs] [sad] [excited] [curious] [sarcastic] [mischievously] [neutral]
- ✅ نصوص طويلة (اختُبرت 17 كلمة، لا hallucination)
- ✅ ثبات هوية الصوت عبر مشاهد متعددة

## Randomness (سلوك متوقع)
- كل توليد بنفس النص ينتج نبرة مختلفة (خائف، رعب، إحباط...).
- السبب: temp=0.7 (whispers) / 1.0 (غير whispers) + top_k=40 + top_p=0.9.
- الاستخدام: 3 takes لاختيار الأفضل (Sprint منفصل).

## كيفية عمل Tags
effective_text = f"[{tag}] {text}" — يُحقن كنص داخل <|TARGET_TEXT_START|>...<|TARGET_TEXT_END|>.
هذا مطابق لتوثيق Audar الرسمي (8 inline tags).

## Endpoint
POST /tts
Headers:
  Authorization: Bearer <AUDAR_AUTH_TOKEN>
  Idempotency-Key: <unique>
Body:
{
  "text": "...",
  "tag": "whispers|neutral|laughs|sad|...",
  "voice": "demo_female_1",
  "target_duration_s": 5,
  "audio_prompt_path": "/home/ubuntu/path/to/sample.wav",
  "ref_text": "transcript of sample"
}

## القيود
- العينة يجب أن تكون على Oracle.
- عينة نظيفة: mono، 16kHz، 10-15s.
- ref_text يجب أن يطابق محتوى العينة.
- 12-15x realtime (مقبول لـ Offline Generation).

## الاختبار المُنجز (2026-11-11)
| الاختبار | النتيجة |
|---|---|
| نص 17 كلمة أردنية | ✅ 10.03s (target 10s) |
| همس | ✅ (3 runs) |
| ضحك | ✅ |
| حزن | ✅ |
| ثبات الصوت | ✅ |
| استنساخ | ✅ 90% |
