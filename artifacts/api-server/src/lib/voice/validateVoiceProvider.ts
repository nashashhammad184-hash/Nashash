export interface VoiceValidationInput {
  dialogue: string;
  phoneAudioUrl: string | null | undefined;
  ttsProvider: string;
}

export interface VoiceValidationOk {
  ok: true;
}

export interface VoiceValidationErr {
  ok: false;
  code: string;
  message: string;
}

export function validateVoiceProviderForDialogue(
  input: VoiceValidationInput
): VoiceValidationOk | VoiceValidationErr {
  const hasArabic = /[\u0600-\u06FF]/.test(input.dialogue || "");
  if (!hasArabic) return { ok: true };

  const hasPhoneAudio = typeof input.phoneAudioUrl === "string"
    && input.phoneAudioUrl.trim().startsWith("/api/storage/");
  if (hasPhoneAudio) return { ok: true };

  if (input.ttsProvider === "deepgram") {
    return {
      ok: false,
      code: "VOICE_LANGUAGE_UNSUPPORTED_AND_PHONE_OFFLINE",
      message: "Arabic dialogue requires a phone-generated audio file. " +
               "Deepgram does not support Arabic. Start kayan_audio_worker.py, " +
               "wait for shots.audio_url to be set, then retry."
    };
  }
  return { ok: true };
}
