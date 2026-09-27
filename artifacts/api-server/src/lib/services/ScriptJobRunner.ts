import { db, scriptsTable, shotsTable } from '@workspace/db';
import { generateScript } from '../scriptGenerator';

export interface ScriptJobPayload {
  projectId: number;
  idea: string;
  worldId?: number | null;
  actors: any[];
  worldBible: any;
}

export async function runScriptJob(payload: ScriptJobPayload): Promise<object> {
  const generated = await generateScript({
    projectId: payload.projectId,
    idea: payload.idea,
    worldId: payload.worldId != null ? String(payload.worldId) : "default_world",
    actors: payload.actors as any,
    worldBible: payload.worldBible as any,
  });

  const [script] = await db
    .insert(scriptsTable)
    .values({
      projectId: payload.projectId,
      idea: payload.idea,
      worldId: payload.worldId != null ? String(payload.worldId) : "default_world",
      generatedContent: generated.text,
    })
    .returning();

  if (!script) throw new Error('failed to insert script');

  let shotsInserted = 0;
  if (generated.rawStructure && Array.isArray(generated.rawStructure.scenes)) {
    for (const scene of generated.rawStructure.scenes) {
      if (!scene.shots || !Array.isArray(scene.shots)) continue;
      for (const shot of scene.shots) {
        if (!shot.description || !shot.description.trim()) continue;
        await db.insert(shotsTable).values({
          projectId: payload.projectId,
          scriptId: script.id,
          sceneNumber: String(scene.sceneNumber || '1'),
          description: shot.description.trim(),
          cameraMovement: shot.cameraMovement || 'Cinematic slow push-in',
          durationSeconds: shot.durationSeconds > 0 ? Math.round(shot.durationSeconds) : 5,
          dialogue: shot.dialogue || null,
          audioNote: shot.audioNote || null,
          audioStatus: 'QUEUED',
        });
        shotsInserted++;
      }
    }
  }

  return { scriptId: script.id, text: generated.text, shotsInserted };
}
