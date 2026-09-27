export interface ScriptRequest {
  task: "script" | "scenes" | "characters" | "world" | "prompt_enhance" | "structured";
  prompt: string;
  language: "ar" | "en";
  schemaJson?: object;
  maxTokens?: number;
  temperature?: number;
}

export interface ScriptResponse {
  content: string;
  provider: string;
  model: string;
}

export interface ScriptProvider {
  name: string;
  generate(req: ScriptRequest): Promise<ScriptResponse>;
}
