import { db, actorsTable, characterReferencesTable, worldProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface PromptInputData {
  sceneDescription?: string;
  shotDescription?: string;
  cameraMovement?: string;
  lighting?: string;
  microExpression?: string;
  dialogue?: string;
  actorId?: number | null;
  projectId?: number | null;
}

export class ProductionPromptBuilder {
  /**
   * دالة مركزية وموحدة لبناء الـ Production Prompt السينمائي الاحترافي الشامل لـ 10 أركان (إصلاح 13)
   */
  static async build(data: PromptInputData): Promise<string> {
    let worldBibleText = "Default Cinematic World";
    let worldRefsText = "None";
    let characterBibleText = "Generic Subject";
    let characterRefsText = "None";

    // 1. جلب بيانات العالم (World Bible & References) إن وجدت للمشروع
    if (data.projectId) {
      const [world] = await db
        .select()
        .from(worldProfilesTable)
        .where(eq(worldProfilesTable.id, data.projectId));
      if (world) {
        worldBibleText = `Geography: ${world.geography || "N/A"}, Architecture: ${world.architecture || "N/A"}, Tech: ${world.technology_level || "N/A"}, Style: ${world.clothing_style || "N/A"}`;
        worldRefsText = `Master Prompt: ${world.masterPrompt || "N/A"}, Palette: ${world.colorPalette || "N/A"}`;
      }
    }

    // 2. جلب بيانات الشخصية (Character Bible & References) إن وجدت
    if (data.actorId) {
      const [actor] = await db
        .select()
        .from(actorsTable)
        .where(eq(actorsTable.id, data.actorId));
      if (actor) {
        characterBibleText = `Name: ${actor.name}, Style: ${actor.style}, Face: ${actor.faceDescription || "N/A"}, Hair: ${actor.hair || "N/A"} (${actor.hairstyle || "N/A"}), Body: ${actor.bodyDescription || "N/A"}, Personality: ${actor.personality || "N/A"}`;
      }

      const refs = await db
        .select()
        .from(characterReferencesTable)
        .where(eq(characterReferencesTable.actorId, data.actorId));
      if (refs && refs.length > 0) {
        const primaryRef = refs.find(r => r.isPrimary) || refs[0];
        characterRefsText = `Primary Asset: ${primaryRef.assetUrl} (Type: ${primaryRef.referenceType})`;
      }
    }

    // 3. صياغة الـ Prompt النهائي المجمع للأركان العشرة بشكل سينمائي فاخر وصارم
    const masterPrompt = `
[CINEMATIC PRODUCTION PROMPT]
1. WORLD BIBLE: ${worldBibleText}
2. WORLD REFERENCES: ${worldRefsText}
3. CHARACTER BIBLE: ${characterBibleText}
4. CHARACTER REFERENCES: ${characterRefsText}
5. SCENE CONTEXT: ${data.sceneDescription || "N/A"}
6. SHOT DETAIL: ${data.shotDescription || "N/A"}
7. CAMERA SETTINGS: ${data.cameraMovement || "Static Cinematic Shot"}
8. LIGHTING SETUP: ${data.lighting || "Cinematic Natural Lighting"}
9. MICRO EXPRESSION: ${data.microExpression || "Neutral Realism"}
10. DIALOGUE AUDIO SYNC: ${data.dialogue ? `"${data.dialogue}"` : "None"}
[/END PROMPT]
`.trim();

    return masterPrompt;
  }
}
