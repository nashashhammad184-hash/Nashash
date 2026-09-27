export interface SubtitleItem {
  id?: number;
  orderIndex: number;
  startTime: number;
  endTime: number;
  text: string;
  language?: string;
}

export function validateSubtitleTiming(startTime: number, endTime: number): boolean {
  return typeof startTime === "number" && typeof endTime === "number" && startTime >= 0 && endTime > startTime;
}

function pad(num: number, size = 2): string {
  let s = String(Math.floor(num));
  while (s.length < size) s = "0" + s;
  return s;
}

export function formatTimestampSRT(seconds: number): string {
  const safeSec = Math.max(0, seconds);
  const hrs = Math.floor(safeSec / 3600);
  const mins = Math.floor((safeSec % 3600) / 60);
  const secs = Math.floor(safeSec % 60);
  const millis = Math.floor((safeSec % 1) * 1000);
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)},${pad(millis, 3)}`;
}

export function formatTimestampVTT(seconds: number): string {
  const safeSec = Math.max(0, seconds);
  const hrs = Math.floor(safeSec / 3600);
  const mins = Math.floor((safeSec % 3600) / 60);
  const secs = Math.floor(safeSec % 60);
  const millis = Math.floor((safeSec % 1) * 1000);
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}.${pad(millis, 3)}`;
}

export function generateSRT(subtitles: SubtitleItem[]): string {
  const sorted = [...subtitles].sort((a, b) => a.startTime - b.startTime || a.orderIndex - b.orderIndex);
  return sorted
    .filter((sub) => validateSubtitleTiming(sub.startTime, sub.endTime) && sub.text.trim())
    .map((sub, index) => {
      const idx = index + 1;
      const start = formatTimestampSRT(sub.startTime);
      const end = formatTimestampSRT(sub.endTime);
      return `${idx}\n${start} --> ${end}\n${sub.text.trim()}\n`;
    })
    .join("\n");
}

export function generateVTT(subtitles: SubtitleItem[]): string {
  const sorted = [...subtitles].sort((a, b) => a.startTime - b.startTime || a.orderIndex - b.orderIndex);
  const body = sorted
    .filter((sub) => validateSubtitleTiming(sub.startTime, sub.endTime) && sub.text.trim())
    .map((sub, index) => {
      const idx = index + 1;
      const start = formatTimestampVTT(sub.startTime);
      const end = formatTimestampVTT(sub.endTime);
      return `${idx}\n${start} --> ${end}\n${sub.text.trim()}\n`;
    })
    .join("\n");
  return `WEBVTT\n\n${body}`;
}
