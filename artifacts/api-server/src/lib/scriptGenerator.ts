/**
 * Arabic Cinematic Script Generation Engine
 * Generates structured, formatted cinematic scripts in Arabic
 * optimized for AI video generation (5-second clips, close-up shots)
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
  audioMusic: string;
}

const WORLD_SETTINGS: Record<string, { atmosphere: string; musicStyle: string; colorGrade: string; era: string }> = {
  noir: {
    atmosphere: "جو مظلم كثيف، أضواء خافتة تتخللها أشعة القمر وضوء النيون المبلل بالمطر",
    musicStyle: "موسيقى جاز بطيئة وكئيبة، كمان منفرد، صوت المطر في الخلفية",
    colorGrade: "ألوان باردة، تباين عالٍ، ظلال عميقة، نغمة فضية-رمادية",
    era: "حقبة الأربعينيات والخمسينيات، مدن كبرى ليلية",
  },
  scifi: {
    atmosphere: "بيئة مستقبلية تقنية، هولوغرافيات عائمة، إضاءة زرقاء-بنفسجية باردة",
    musicStyle: "موسيقى إلكترونية محيطية، نبضات رقمية، أصوات تقنية في الخلفية",
    colorGrade: "تدرجات زرقاء-بنفسجية، بريق معدني، تأثيرات ضوئية ليزرية",
    era: "المستقبل البعيد 2150-2500",
  },
  history: {
    atmosphere: "مشاهد تاريخية أصيلة، حجارة قديمة، مشاعل ونيران، ملابس تراثية",
    musicStyle: "موسيقى أوركسترالية ملحمية، آلات وترية تقليدية، طبول حرب",
    colorGrade: "نغمات دافئة ذهبية-بنية، إضاءة شمعية، لون جلدي دافئ",
    era: "حضارات قديمة، الإمبراطوريات التاريخية",
  },
  fantasy: {
    atmosphere: "عوالم سحرية خيالية، كائنات أسطورية، مناظر طبيعية خارقة وبرية",
    musicStyle: "موسيقى فانتازيا ملحمية، هارب، مقاطع كورالية، أصوات سحرية",
    colorGrade: "ألوان حيوية وساحرة، توهجات سحرية، تدرجات أرجوانية-خضراء",
    era: "عصور خيالية، عوالم موازية",
  },
  drama: {
    atmosphere: "بيئات واقعية معاصرة، إضاءة طبيعية، فضاءات حياتية يومية أصيلة",
    musicStyle: "موسيقى عاطفية هادئة، بيانو منفرد، أغانٍ عربية معاصرة",
    colorGrade: "ألوان دافئة وطبيعية، ضوء ذهبي الساعة الأخيرة، تباين لطيف",
    era: "العصر الحديث المعاصر",
  },
};

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

function buildActorLine(actors?: string[]): string {
  if (!actors || actors.length === 0) return "شخصيات القصة";
  if (actors.length === 1) return actors[0];
  return actors.slice(0, -1).join("، ") + " و" + actors[actors.length - 1];
}

function getWorldLabel(worldId: string): string {
  const labels: Record<string, string> = {
    noir: "عالم الغموض والتحقيق",
    scifi: "العالم المستقبلي",
    history: "العالم التاريخي",
    fantasy: "عالم الفانتازيا",
    drama: "الدراما الواقعية",
  };
  return labels[worldId] || worldId;
}

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

  let sceneTitle = "";
  let sceneDescription = "";
  let dialogue = "";
  let audio = "";

  const purposes: Record<string, { title: string; desc: string; dialogue: string; audio: string }> = {
    opening: {
      title: "المشهد الافتتاحي",
      desc: `تبدأ القصة من ${settings.era}. ${settings.atmosphere}. نرى ${actorLine} لأول مرة في عالم مليء بـ${idea}. الكاميرا تكشف البيئة ببطء ودراما.`,
      dialogue: `"كل شيء بدأ في تلك اللحظة... لم نكن نعرف أن العالم لن يكون كما كان أبداً."`,
      audio: `${settings.musicStyle} — مقدمة هادئة تبني الغموض والتوتر`,
    },
    confrontation: {
      title: "مشهد المواجهة",
      desc: `التوتر يبلغ ذروته. ${actorLine} يواجهون تحدياً مباشراً يجسد جوهر ${idea}. ${settings.atmosphere}. لحظة حاسمة تغير مسار الأحداث.`,
      dialogue: `"أعتقدت أنني أعرفك... لكن ما أراه الآن يجعلني أتساءل: من أنت حقاً؟"`,
      audio: `${settings.musicStyle} — تصاعد درامي، إيقاع قلب متسارع، صمت مشحون قبل الاتفاق`,
    },
    revelation: {
      title: "مشهد الكشف",
      desc: `سر عميق ينكشف يغير كل شيء. ${actorLine} يكتشفون حقيقة مرتبطة بـ${idea} كانت مخفية. ${settings.atmosphere} يعكس ثقل اللحظة.`,
      dialogue: `"كل ما بُنيَ على الأكاذيب سيسقط يوماً... واليوم هو ذلك اليوم."`,
      audio: `${settings.musicStyle} — موسيقى صادمة ثم صمت ثقيل، أصوات الطبيعة تتوقف`,
    },
    climax: {
      title: "ذروة الأحداث",
      desc: `أعلى نقطة توتر في القصة. ${actorLine} يصلون إلى لحظة الحسم حول ${idea}. كل شيء على المحك. ${settings.atmosphere} في أقصى تجلياته.`,
      dialogue: `"لن أتراجع. لأجل كل من أحبهم، لأجل الحقيقة، لأجل المستقبل — أقف هنا."`,
      audio: `${settings.musicStyle} — أوركسترا كاملة في ذروتها، طبول متصاعدة، كل الآلات`,
    },
    resolution: {
      title: "مشهد الخاتمة",
      desc: `نهاية القصة. ${actorLine} يجدون خاتمتهم مع ${idea}. ${settings.atmosphere} يلطف ويتحول إلى شيء جديد. رسالة تبقى في القلب.`,
      dialogue: `"بعض الجروح لا تُشفى... لكنها تُعلمنا كيف نحيا من جديد."`,
      audio: `${settings.musicStyle} — موسيقى تأملية تذوب ببطء، نهاية هادئة ومؤثرة`,
    },
  };

  const purposeData = purposes[scenePurpose] || purposes["revelation"];
  sceneTitle = purposeData.title;
  sceneDescription = purposeData.desc;
  dialogue = purposeData.dialogue;
  audio = purposeData.audio;

  return {
    sceneNumber,
    sceneTitle,
    sceneDescription,
    cameraMovement,
    duration: "5 ثوانٍ لكل لقطة (مُحسَّن لتوليد الذكاء الاصطناعي)",
    characterDialogue: dialogue,
    audioMusic: audio,
  };
}

export function generateCinematicScript(options: ScriptGenerationOptions): string {
  const { idea, worldId, actors } = options;
  const settings = WORLD_SETTINGS[worldId] || WORLD_SETTINGS["drama"];
  const worldLabel = getWorldLabel(worldId);
  const actorLine = buildActorLine(actors);

  const scenes = [
    generateScene(1, "opening", idea, worldId, actors, true),
    generateScene(2, "confrontation", idea, worldId, actors, false),
    generateScene(3, "revelation", idea, worldId, actors, true),
    generateScene(4, "climax", idea, worldId, actors, false),
    generateScene(5, "resolution", idea, worldId, actors, true),
  ];

  const header = `
═══════════════════════════════════════════════════
          ستوديو الإنتاج السينمائي بالذكاء الاصطناعي
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

  const scenesText = scenes
    .map((scene) => {
      return `

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

───────────────────────────────────────────────────`;
    })
    .join("\n");

  const footer = `

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
              نهاية السيناريو
═══════════════════════════════════════════════════
`;

  return header + scenesText + footer;
}
