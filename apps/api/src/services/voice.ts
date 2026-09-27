import fs from 'fs';
import path from 'path';

export interface VoiceGenerationOptions {
  text: string;
  voice?: string;
  outputPath: string;
}

export class VoiceService {
  private apiKey: string;
  private baseUrl = 'https://deepgram.com';
  private requestTimeout = 15000; // 15 seconds hard timeout for production stability
  private maxTextLength = 5000;   // Safe limit to prevent buffer overflows and massive billing spikes

  constructor() {
    const key = process.env.DEEPGRAM_API_KEY;
    if (!key || key.trim() === '' || key.includes('your_deepgram_api_key_here')) {
      throw new Error('CRITICAL_BLOCKER: DEEPGRAM_API_KEY is missing or invalid in the environment variables.');
    }
    this.apiKey = key.trim();
  }

  async generateVoice(options: VoiceGenerationOptions): Promise<string> {
    const { text, voice = 'aura-asteria-en', outputPath } = options;

    if (!text || text.trim() === '') {
      throw new Error('VoiceGenerationError: Input text cannot be empty.');
    }

    if (text.length > this.maxTextLength) {
      throw new Error(`VoiceGenerationError: Text exceeds maximum permitted length of ${this.maxTextLength} characters.`);
    }

    const targetUrl = `${this.baseUrl}?model=${encodeURIComponent(voice)}`;
    
    // EDGE CASE SOLUTION: Implement strict network connection timeout control
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);

    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: text.trim() }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorBody = '';
        try {
          errorBody = await response.text();
        } catch {
          errorBody = 'Unable to parse remote error response.';
        }
        throw new Error(`DeepgramAPIError: Remote server returned status ${response.status}. Details: ${errorBody}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('audio')) {
        throw new Error(`DeepgramAPIError: Invalid content type received: ${contentType}. Expected audio stream.`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length === 0) {
        throw new Error('DeepgramAPIError: Received an empty audio buffer from the Deepgram endpoint.');
      }

      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(outputPath, buffer);
      
      // Secondary strict verification post-write
      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        throw new Error('FileSystemError: Audio file was not written successfully or is 0 bytes.');
      }

      return outputPath;

    } catch (error: any) {
      clearTimeout(timeoutId);
      console.error('[CRITICAL] VoiceService generation failed completely:', error.message);
      if (error.name === 'AbortError') {
        throw new Error(`VoiceServiceProductionFailure: Network request timed out after ${this.requestTimeout / 1000} seconds.`);
      }
      throw new Error(`VoiceServiceProductionFailure: Refusing fallback mock simulation. Root error: ${error.message}`);
    }
  }
}
