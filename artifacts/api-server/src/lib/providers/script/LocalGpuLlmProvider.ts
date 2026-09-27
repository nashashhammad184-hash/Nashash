import type { ScriptProvider, ScriptRequest, ScriptResponse } from "./index";

const RETRY_DELAY_MS = 30_000;
const MAX_RETRIES = 2;
const POLL_INTERVAL_MS = 500;
const POLL_MAX = 7200;

export class LocalGpuLlmProvider implements ScriptProvider {
  name = "LOCAL_GPU";
  private base: string;
  private token: string;

  constructor() {
    this.base = (process.env.KAYAN_LLM_URL || "http://127.0.0.1:8082").replace(/\/+$/, "");
    this.token = process.env.GPU_WORKER_TOKEN || "";
  }

  private buildHeaders(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.token) h["X-API-Key"] = this.token;
    return h;
  }

  private async submitAndWait(req: ScriptRequest): Promise<ScriptResponse> {
    const headers = this.buildHeaders();
    const createRes = await fetch(`${this.base}/jobs/llm`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        task: req.task,
        prompt: req.prompt,
        language: req.language,
        schema_json: req.schemaJson ?? null,
        max_tokens: req.maxTokens ?? 2048,
        temperature: req.temperature ?? 0.7,
      }),
    });
    if (!createRes.ok) {
      throw new Error(`LLM worker rejected job (HTTP ${createRes.status}): ${await createRes.text().catch(() => "")}`);
    }
    const created = await createRes.json() as any;
    const jobId = created?.job_id;
    if (!jobId) throw new Error("LLM worker returned no job_id");

    for (let i = 0; i < POLL_MAX; i++) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      const s = await fetch(`${this.base}/jobs/${jobId}`, { headers });
      if (!s.ok) continue;
      const state = await s.json() as any;
      if (state.status === "completed") {
        return { content: state.result, provider: this.name, model: "Qwen2.5-7B-Instruct-AWQ" };
      }
      if (state.status === "failed") {
        throw new Error(`LLM job failed: ${state.error || "unknown"}`);
      }
    }
    throw new Error(`LLM job timeout (${(POLL_INTERVAL_MS * POLL_MAX) / 1000}s)`);
  }

  async generate(req: ScriptRequest): Promise<ScriptResponse> {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.submitAndWait(req);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isContention = /contention|VRAM|competing/i.test(msg);
        if (!isContention) throw e;
        lastErr = e;
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }
    throw new Error(
      `LLM unavailable: video job in progress after ${MAX_RETRIES} retries (~${(MAX_RETRIES * RETRY_DELAY_MS) / 60000} min). Last: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
    );
  }
}
