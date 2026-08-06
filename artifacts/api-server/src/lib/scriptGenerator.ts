/**
 * Arabic Cinematic Script Generation Engine
 * Kayan AI Productions — Commercial Edition
 *
 * Features:
 * - 5-scene structure (opening, confrontation, revelation, climax, resolution)
 * - World-specific atmospheres, music, color grades
 * - Backing Score prompts (Udio/Suno style) per scene
 * - Ambient Environmental SFX per world
 * - English subtitle synchronisation block
 * - "Produced by Kayan AI Productions" credit
 */

interface ScriptGenerationOptions {
  idea: string;
  worldId: string;
  actors?: string[];
}

interface SceneBlock {
  sceneNumber: number;
  sceneTitle: string;
  sceneDescription: string;
  cameraMovement: string;
  duration: string;
  characterDialogue: string;
  characterDialogueEn: string;   // English subtitle
  audioMusic: string;
  backingScorePrompt: string;    // Udio / Suno prompt
  ambientSfx: string;           // Environmental SFX
}

// ── World Settings ───────────────────────────────────────────────────────────
const WORLD_SETTINGS: Record<string, {
  atmosphere: string; musicStyle: string; colorGrade: string; era: string;
  backingScore: string; ambientSfx: string;
}> = {
  noir: {
    atmosphere:   "جو مظلم كثيف، أضواء خافتة تتخللها أشعة القمر وضوء النيون المبلل بالمطر",
    musicStyle:   "موسيقى جاز بطيئة وكئيبة، كمان منفرد، صوت المطر في الخلفية",
    colorGrade:   "ألوان باردة، تباين عالٍ، ظلال عميقة، نغمة فضية-رمادية",
    era:          "حقبة الأربعينيات والخمسينيات، مدن كبرى ليلية",
    backingScore: "cinematic noir jazz, slow trumpet, melancholic saxophone, rainy night ambience, 1940s film score, moody and tense, minor key, smoky atmosphere, 80 BPM",
    ambientSfx:   "صوت المطر الغزير على الزجاج · خطوات بطيئة على الرصيف المبلل · صفير قطار بعيد · ضجيج نيون وميض · أصوات سيارات قديمة",
  },
  scifi: {
    atmosphere:   "بيئة مستقبلية تقنية، هولوغرافيات عائمة، إضاءة زرقاء-بنفسجية باردة",
    musicStyle:   "موسيقى إلكترونية محيطية، نبضات رقمية، أصوات تقنية في الخلفية",
    colorGrade:   "تدرجات زرقاء-بنفسجية، بريق معدني، تأثيرات ضوئية ليزرية",
    era:          "المستقبل البعيد 2150-2500",
    backingScore: "sci-fi ambient electronic, pulsing synth bass, holographic tones, zero-gravity soundscape, cinematic futuristic, Hans Zimmer inspired, cold and vast, 110 BPM",
    ambientSfx:   "صوت محركات مركبات فضائية من بعيد · نبضات هولوغرافية إلكترونية · صوت تهوية محطة فضائية · طنين مفاعل نووي خافت · صوت باب صاروخي يفتح",
  },
  history: {
    atmosphere:   "مشاهد تاريخية أصيلة، حجارة قديمة، مشاعل ونيران، ملابس تراثية",
    musicStyle:   "موسيقى أوركسترالية ملحمية، آلات وترية تقليدية، طبول حرب",
    colorGrade:   "نغمات دافئة ذهبية-بنية، إضاءة شمعية، لون جلدي دافئ",
    era:          "حضارات قديمة، الإمبراطوريات التاريخية",
    backingScore: "epic orchestral historical, war drums, Arabic oud melody, ancient empire grandeur, strings and brass, cinematic battle score, Ramin Djawadi style, 95 BPM",
    ambientSfx:   "صوت الخيول وحوافرها · طبول حرب تقليدية من بعيد · أصوات الريح في الصحراء · أصوات المعارك المعدنية · صيحات الجند وهتافات الجموع",
  },
  fantasy: {
    atmosphere:   "عوالم سحرية خيالية، كائنات أسطورية، مناظر طبيعية خارقة وبرية",
    musicStyle:   "موسيقى فانتازيا ملحمية، هارب، مقاطع كورالية، أصوات سحرية",
    colorGrade:   "ألوان حيوية وساحرة، توهجات سحرية، تدرجات أرجوانية-خضراء",
    era:          "عصور خيالية، عوالم موازية",
    backingScore: "epic fantasy orchestral, magical harp glissando, ethereal choir vocals, mystical forest ambience, Howard Shore / John Williams style, wonder and peril, 105 BPM",
    ambientSfx:   "أصوات مخلوقات أسطورية خافتة · ريح سحرية تمر بين الأشجار العملاقة · أصوات رنين كريستال سحري · طيران كائنات أسطورية في السماء · تدفق نهر سحري متلألئ",
  },
  drama: {
    atmosphere:   "بيئات واقعية معاصرة، إضاءة طبيعية، فضاءات حياتية يومية أصيلة",
    musicStyle:   "موسيقى عاطفية هادئة، بيانو منفرد، أغانٍ عربية معاصرة",
    colorGrade:   "ألوان دافئة وطبيعية، ضوء ذهبي الساعة الأخيرة، تباين لطيف",
    era:          "العصر الحديث المعاصر",
    backingScore: "emotional Arabic drama, solo piano, contemporary oud, intimate and raw, slow build, heartfelt strings, silence and breath, Gabriel Yared style, 70 BPM",
    ambientSfx:   "أصوات المدينة الخافتة من النافذة المفتوحة · موسيقى مقهى من بعيد · صوت مطر خفيف على الشبابيك · خطوات هادئة على أرض خشبية · صوت شاي يُسكب في فنجان",
  },
};

// ── Camera Movements ─────────────────────────────────────────────────────────
const CAMERA_MOVEMENTS_ROMANCE_DRAMA = [
  "كلوز أب شديد على العيون — تصوير 5 ثوانٍ",
  "كلوز أب على الشفتين والتعبير — تصوير 5 ثوانٍ",
  "شوت أمامي ثابت على الوجه بأكمله — تصوير 5 ثوانٍ",
  "كلوز أب جانبي على ملامح الوجه — تصوير 5 ثوانٍ",
  "زووم إن بطيء جداً على العيون — تصوير 5 ثوانٍ",
  "كلوز أب على يدين تتشابكان — تصوير 5 ثوانٍ",
  "شوت أمامي منخفض بزاوية درامية — تصوير 5 ثوانٍ",
];

const CAMERA_MOVEMENTS_ACTION_WIDE = [
  "شوت عريض يكشف المشهد كاملاً — تصوير 5 ثوانٍ",
  "شوت علوي من زاوية الطائرة — تصوير 5 ثوانٍ",
  "تراكينغ شوت جانبي يتبع الحركة — تصوير 5 ثوانٍ",
  "شوت ميديوم أمامي ثابت — تصوير 5 ثوانٍ",
  "أوفر شولدر شوت — تصوير 5 ثوانٍ",
  "شوت فوق منخفض يكشف البيئة — تصوير 5 ثوانٍ",
  "دولي شوت يتقدم نحو الشخصية — تصوير 5 ثوانٍ",
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function buildActorLine(actors?: string[]): string {
  if (!actors || actors.length === 0) return "شخصيات القصة";
  if (actors.length === 1) return actors[0];
  return actors.slice(0, -1).join("، ") + " و" + actors[actors.length - 1];
}

function getWorldLabel(worldId: string): string {
  const labels: Record<string, string> = {
    noir:    "عالم الغموض والتحقيق",
    scifi:   "العالم المستقبلي",
    history: "العالم التاريخي",
    fantasy: "عالم الفانتازيا",
    drama:   "الدراما الواقعية",
  };
  return labels[worldId] || worldId;
}

// ── Scene Builder ────────────────────────────────────────────────────────────
function generateScene(
  sceneNumber: number,
  scenePurpose: string,
  idea: string,
  worldId: string,
  actors?: string[],
  isEmotional = false
): SceneBlock {
  const settings = WORLD_SETTINGS[worldId] || WORLD_SETTINGS["drama"];
  const actorLine = buildActorLine(actors);
  const movements = isEmotional ? CAMERA_MOVEMENTS_ROMANCE_DRAMA : CAMERA_MOVEMENTS_ACTION_WIDE;
  const cameraMovement = movements[sceneNumber % movements.length];

  const purposes: Record<string, {
    title: string; desc: string; dialogue: string; dialogueEn: string; audio: string;
  }> = {
    opening: {
      title:      "المشهد الافتتاحي",
      desc:       `تبدأ القصة من ${settings.era}. ${settings.atmosphere}. نرى ${actorLine} لأول مرة في عالم مليء بـ${idea}. الكاميرا تكشف البيئة ببطء ودراما.`,
      dialogue:   `"كل شيء بدأ في تلك اللحظة... لم نكن نعرف أن العالم لن يكون كما كان أبداً."`,
      dialogueEn: `"Everything began in that moment… We never knew the world would never be the same again."`,
      audio:      `${settings.musicStyle} — مقدمة هادئة تبني الغموض والتوتر`,
    },
    confrontation: {
      title:      "مشهد المواجهة",
      desc:       `التوتر يبلغ ذروته. ${actorLine} يواجهون تحدياً مباشراً يجسد جوهر ${idea}. ${settings.atmosphere}. لحظة حاسمة تغير مسار الأحداث.`,
      dialogue:   `"أعتقدت أنني أعرفك... لكن ما أراه الآن يجعلني أتساءل: من أنت حقاً؟"`,
      dialogueEn: `"I thought I knew you… but what I see now makes me wonder: who are you really?"`,
      audio:      `${settings.musicStyle} — تصاعد درامي، إيقاع قلب متسارع، صمت مشحون قبل الاتفاق`,
    },
    revelation: {
      title:      "مشهد الكشف",
      desc:       `سر عميق ينكشف يغير كل شيء. ${actorLine} يكتشفون حقيقة مرتبطة بـ${idea} كانت مخفية. ${settings.atmosphere} يعكس ثقل اللحظة.`,
      dialogue:   `"كل ما بُنيَ على الأكاذيب سيسقط يوماً... واليوم هو ذلك اليوم."`,
      dialogueEn: `"Everything built on lies will fall one day… and today is that day."`,
      audio:      `${settings.musicStyle} — موسيقى صادمة ثم صمت ثقيل، أصوات الطبيعة تتوقف`,
    },
    climax: {
      title:      "ذروة الأحداث",
      desc:       `أعلى نقطة توتر في القصة. ${actorLine} يصلون إلى لحظة الحسم حول ${idea}. كل شيء على المحك. ${settings.atmosphere} في أقصى تجلياته.`,
      dialogue:   `"لن أتراجع. لأجل كل من أحبهم، لأجل الحقيقة، لأجل المستقبل — أقف هنا."`,
      dialogueEn: `"I will not retreat. For everyone I love, for truth, for the future — I stand here."`,
      audio:      `${settings.musicStyle} — أوركسترا كاملة في ذروتها، طبول متصاعدة، كل الآلات`,
    },
    resolution: {
      title:      "مشهد الخاتمة",
      desc:       `نهاية القصة. ${actorLine} يجدون خاتمتهم مع ${idea}. ${settings.atmosphere} يلطف ويتحول إلى شيء جديد. رسالة تبقى في القلب.`,
      dialogue:   `"بعض الجروح لا تُشفى... لكنها تُعلمنا كيف نحيا من جديد."`,
      dialogueEn: `"Some wounds never heal… but they teach us how to live again."`,
      audio:      `${settings.musicStyle} — موسيقى تأملية تذوب ببطء، نهاية هادئة ومؤثرة`,
    },
  };

  const p = purposes[scenePurpose] || purposes["revelation"];

  return {
    sceneNumber,
    sceneTitle:            p.title,
    sceneDescription:      p.desc,
    cameraMovement,
    duration:              "5 ثوانٍ لكل لقطة (مُحسَّن لتوليد الذكاء الاصطناعي)",
    characterDialogue:     p.dialogue,
    characterDialogueEn:   p.dialogueEn,
    audioMusic:            p.audio,
    backingScorePrompt:    settings.backingScore,
    ambientSfx:            settings.ambientSfx,
  };
}

// ── Main Generator ───────────────────────────────────────────────────────────
export function generateCinematicScript(options: ScriptGenerationOptions): string {
  const { idea, worldId, actors } = options;
  const settings = WORLD_SETTINGS[worldId] || WORLD_SETTINGS["drama"];
  const worldLabel = getWorldLabel(worldId);
  const actorLine = buildActorLine(actors);

  const scenes = [
    generateScene(1, "opening",       idea, worldId, actors, true),
    generateScene(2, "confrontation", idea, worldId, actors, false),
    generateScene(3, "revelation",    idea, worldId, actors, true),
    generateScene(4, "climax",        idea, worldId, actors, false),
    generateScene(5, "resolution",    idea, worldId, actors, true),
  ];

  // ── Arabic Script Block ──────────────────────────────────────────────────
  const arabicHeader = `
═══════════════════════════════════════════════════
     استوديو كيان للإنتاج السينمائي بالذكاء الاصطناعي
         Kayan AI Productions — Official Script
═══════════════════════════════════════════════════

العنوان: ${idea}
العالم: ${worldLabel}
الممثلون: ${actorLine}
الأجواء: ${settings.atmosphere}
درجة الألوان: ${settings.colorGrade}

───────────────────────────────────────────────────
ملاحظة للمخرج: جميع اللقطات مُحسَّنة لمدة 5 ثوانٍ
لتوليد الذكاء الاصطناعي مع تجنب مشاكل الدمج
───────────────────────────────────────────────────
`;

  const arabicScenes = scenes
    .map((scene) => `

╔═══════════════════════════════════════════════════╗
  المشهد ${scene.sceneNumber} — ${scene.sceneTitle}
╚═══════════════════════════════════════════════════╝

📍 وصف المشهد:
${scene.sceneDescription}

🎬 حركة الكاميرا:
${scene.cameraMovement}

⏱ المدة:
${scene.duration}

💬 حوار الشخصية:
${scene.characterDialogue}

🎵 الموسيقى والصوت:
${scene.audioMusic}

🎼 Backing Score Prompt (Udio/Suno):
${scene.backingScorePrompt}

🔊 المؤثرات الصوتية المحيطية (Ambient SFX):
${scene.ambientSfx}

───────────────────────────────────────────────────`)
    .join("\n");

  const arabicFooter = `

╔═══════════════════════════════════════════════════╗
        توجيهات الإنتاج للذكاء الاصطناعي
╚═══════════════════════════════════════════════════╝

• كل لقطة = 5 ثوانٍ مستقلة للتوليد المنفصل
• اللقطات العاطفية: كلوز أب مقرَّب على الوجه والعيون
• لقطات الحركة: شوت عريض يُظهر البيئة والشخصية
• تجنب الدمج: احرص على توليد كل مشهد بشكل مستقل
• لون المشهد: ${settings.colorGrade}
• الموسيقى: ${settings.musicStyle}

═══════════════════════════════════════════════════
         Produced by Kayan AI Productions ©
═══════════════════════════════════════════════════
`;

  // ── English Subtitle Block ───────────────────────────────────────────────
  const englishSubtitles = `
═══════════════════════════════════════════════════
   KAYAN AI PRODUCTIONS — English Subtitle Track
         Synchronized · ${idea}
═══════════════════════════════════════════════════

World: ${worldLabel}  |  Era: ${settings.era}
Actors: ${actorLine}

` + scenes.map((scene) => `
[SCENE ${scene.sceneNumber}] — ${scene.sceneTitle.replace(/\s/g, " ")}
─────────────────────────────────────────────
SUBTITLE: ${scene.characterDialogueEn}

BACKING SCORE: ${scene.backingScorePrompt}

AUDIO NOTES: ${scene.audioMusic}
`).join("\n") + `

═══════════════════════════════════════════════════
  © Kayan AI Productions — All Rights Reserved
═══════════════════════════════════════════════════
`;

  return arabicHeader + arabicScenes + arabicFooter + "\n---ENGLISH_SUBTITLES---\n" + englishSubtitles;
}
