export function buildDirectorPrompt(description: string, dialogue: string, characterInfo?: string): string {
  return `أنت مخرج أداء صوتي سينمائي عربي. مهمتك تحليل وصف المشهد والحوار لاستنتاج الأداء الصوتي المناسب.

القواعد الإلزامية:
1. لا تخترع أحداثاً أو مشاعر غير موجودة في الوصف أو الحوار.
2. إذا كان السياق غامضاً، اختر emotion="neutral" مع confidence منخفضة.
3. فرّق بين مشاعر الشخصية ومعنى الكلمات الحرفي.
4. الوسوم المتاحة لمحرك Audar (8 فقط): [laughs], [curious], [excited], [neutral], [sad], [mischievously], [whispers], [sarcastic].
5. إذا لم تجد وسماً مناسباً للشعور، اجعل audar_tag=null.
6. لا تستخدم أكثر من وسم واحد.

المدخل:
الوصف: ${description}
الحوار: ${dialogue}
${characterInfo ? "الشخصية: " + characterInfo : ""}

أخرج JSON فقط بالمفاتيح: emotion, delivery, intensity, audar_tag, confidence, reasoning.`;
}
