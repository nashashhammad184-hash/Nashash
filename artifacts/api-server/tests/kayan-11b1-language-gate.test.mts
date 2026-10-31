import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateVoiceProviderForDialogue } from '../src/lib/voice/validateVoiceProvider';

test('KAYAN-11b.1 Language Gate', async (t) => {
  await t.test('Arabic + no phoneAudio + deepgram -> fail', () => {
    const res = validateVoiceProviderForDialogue({ dialogue: "مرحبا", phoneAudioUrl: null, ttsProvider: "deepgram" });
    assert.equal(res.ok, false);
    assert.equal(res.code, "VOICE_LANGUAGE_UNSUPPORTED_AND_PHONE_OFFLINE");
  });

  await t.test('Arabic + phoneAudio (supabase) + deepgram -> ok', () => {
    const res = validateVoiceProviderForDialogue({ dialogue: "مرحبا", phoneAudioUrl: "/api/storage/supabase/audio/x.mp3", ttsProvider: "deepgram" });
    assert.equal(res.ok, true);
  });

  await t.test('Arabic + phoneAudio (/uploads/) + deepgram -> fail', () => {
    const res = validateVoiceProviderForDialogue({ dialogue: "مرحبا", phoneAudioUrl: "/uploads/audio/x.mp3", ttsProvider: "deepgram" });
    assert.equal(res.ok, false);
  });

  await t.test('English + no phoneAudio + deepgram -> ok', () => {
    const res = validateVoiceProviderForDialogue({ dialogue: "Hello", phoneAudioUrl: null, ttsProvider: "deepgram" });
    assert.equal(res.ok, true);
  });

  await t.test('Mixed (Arabic+English) + no phoneAudio + deepgram -> fail', () => {
    const res = validateVoiceProviderForDialogue({ dialogue: "Hello مرحبا", phoneAudioUrl: null, ttsProvider: "deepgram" });
    assert.equal(res.ok, false);
  });

  await t.test('Arabic + phoneAudio=empty string + deepgram -> fail', () => {
    const res = validateVoiceProviderForDialogue({ dialogue: "مرحبا", phoneAudioUrl: "", ttsProvider: "deepgram" });
    assert.equal(res.ok, false);
  });

  await t.test('Arabic + phoneAudio (r2) + deepgram -> ok', () => {
    const res = validateVoiceProviderForDialogue({ dialogue: "مرحبا", phoneAudioUrl: "/api/storage/r2/x.mp3", ttsProvider: "deepgram" });
    assert.equal(res.ok, true);
  });

  await t.test('Arabic + munsit provider -> ok (no gate)', () => {
    const res = validateVoiceProviderForDialogue({ dialogue: "مرحبا", phoneAudioUrl: null, ttsProvider: "munsit" });
    assert.equal(res.ok, true);
  });
});
