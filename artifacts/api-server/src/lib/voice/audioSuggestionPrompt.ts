export function buildAudioSuggestionPrompt(
  description: string,
  dialogue: string,
  availableAssets: Array<{ asset_id: string; name: string; asset_type: string; tags: string[] }>
): string {
  const catalog = availableAssets.map(a => 
    `- ${a.asset_id} | ${a.name} | type=${a.asset_type} | tags=${a.tags.join(",")}`
  ).join("\n");

  return `أنت مخرج صوتي سينمائي. اقرأ وصف المشهد والحوار، ثم اختر من المكتبة المتاحة ما يناسب المشهد.

المكتبة المتاحة:
${catalog}

القواعد:
1. اختر فقط من المكتبة أعلاه (استخدم asset_id بالضبط).
2. يمكنك اختيار 0-5 أصول (موسيقى، أجواء، مؤثرات، أصوات حركية).
3. لكل أصل اختر:
   - start_time: وقت البدء بالثواني (0 = بداية المشهد).
   - end_time: وقت الانتهاء.
   - volume: مستوى الصوت (0.0 - 1.0).
   - fade_in, fade_out: التلاشي بالثواني.
4. الموسيقى تكون volume منخفض (0.2-0.4) لعدم حجب الحوار.
5. المؤثرات (SFX) يمكن أن تكون 0.7-1.0.
6. الأجواء (ambience) تكون مستمرة (تغطي المشهد كاملاً) و volume منخفض.

المدخل:
الوصف: ${description}
الحوار: ${dialogue}

أخرج JSON فقط بالشكل:
{ "suggestions": [ { "asset_id": "...", "asset_type": "...", "start_time": 0, "end_time": 5, "volume": 0.3, "fade_in": 0.5, "fade_out": 0.5, "reasoning": "..." } ] }`;
}
