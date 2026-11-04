type Source = "director" | "manual" | "dialogue";

export type FieldValue<T> = { value: T; source: Source } | null;

export interface MergedFields {
  emotion: FieldValue<string>;
  delivery: FieldValue<string>;
  intensity: FieldValue<number>;
  audar_tag: FieldValue<string | null>;
}

const TAG_REGEX = /^(\[(?:laughs|curious|excited|sighs|exhales|mischievously|whispers|sarcastic)\])/i;

export function extractLeadingTag(dialogue: string): string | null {
  const m = dialogue.trim().match(TAG_REGEX);
  return m ? m[1].toLowerCase() : null;
}

export function mergeFields(
  audioInstruction: any,
  manualInstruction: any,
  dialogue: string
): MergedFields {
  const dialogueTag = extractLeadingTag(dialogue);
  const merged: MergedFields = {
    emotion: null,
    delivery: null,
    intensity: null,
    audar_tag: null
  };

  for (const key of ["emotion", "delivery", "intensity"] as const) {
    if (manualInstruction?.fields?.[key]?.source === "manual") {
      merged[key] = { value: manualInstruction.fields[key].value, source: "manual" } as any;
    } else if (audioInstruction?.fields?.[key]) {
      merged[key] = { value: audioInstruction.fields[key].value, source: "director" } as any;
    }
  }

  if (dialogueTag) {
    merged.audar_tag = { value: dialogueTag, source: "dialogue" };
  } else if (manualInstruction?.fields?.audar_tag?.source === "manual") {
    merged.audar_tag = { value: manualInstruction.fields.audar_tag.value ?? null, source: "manual" };
  } else if (audioInstruction?.fields?.audar_tag) {
    merged.audar_tag = { value: audioInstruction.fields.audar_tag.value ?? null, source: "director" };
  }

  return merged;
}

export function buildResolvedText(dialogue: string, merged: MergedFields): string | null {
  if (!merged.emotion && !merged.audar_tag) {
    return null;
  }
  let base = dialogue.trim();
  
  // إزالة أسماء الشخصيات والتوجيهات قبل النقطتين (مثل "صفية تهمس: ")
  base = base.replace(/^[^:\{\[]+:\s*/, "");
  // إزالة الأقواس المعقوفة
  base = base.replace(/[{}]/g, "");
  base = base.trim();

  if (!base) return null;

  const tag = merged.audar_tag?.value;
  if (!tag) {
    return base;
  }
  if (base.toLowerCase().startsWith(tag.toLowerCase())) {
    return base;
  }
  return `${tag} ${base}`;
}
