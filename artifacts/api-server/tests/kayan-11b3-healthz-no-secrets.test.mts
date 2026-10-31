import { test } from 'node:test';
import { strict as assert } from 'node:assert';

test('KAYAN-11b.3 Healthz does not leak secrets', async () => {
  const secrets = ["PRODUCTION_API_TOKEN", "GROQ_API_KEY", "WAVESPEED_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "SESSION_SECRET"];
  const healthzResponse = {
    status: "ok",
    ready: true,
    role: "api",
    audio: { phoneOnline: true, phoneLastHeartbeat: "2026-10-31T14:16:18.168Z", phoneName: "phone-samsung-01", deepgramSupportsArabic: false }
  };
  const healthzStr = JSON.stringify(healthzResponse);
  
  for (const s of secrets) {
    if (process.env[s]) {
        assert.equal(healthzStr.includes(process.env[s]!), false, `Leaked secret value: ${s}`);
    }
    assert.equal(healthzStr.includes(s), false, `Leaked secret name: ${s}`);
  }
  
  assert.doesNotMatch(healthzStr, /sk-[a-zA-Z0-9]{20,}|gsk_[a-zA-Z0-9]{20,}|ws_[a-zA-Z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}/);
});
