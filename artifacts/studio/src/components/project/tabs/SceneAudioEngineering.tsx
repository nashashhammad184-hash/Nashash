import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, RotateCcw, Eye, Play, Square, Check, X, Pencil, Trash2, Music } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { getListProjectShotsQueryKey } from "@workspace/api-client-react";

const EMOTIONS = ["neutral","joy","sadness","anger","fear","surprise","disgust","romantic","anxious","confident"];
const AUDAR_TAGS = ["[laughs]","[curious]","[excited]","[neutral]","[sad]","[mischievously]","[whispers]","[sarcastic]"];
const EMOTION_LABELS: Record<string,string> = { neutral:"محايد",joy:"فرح",sadness:"حزن",anger:"غضب",fear:"خوف",surprise:"مفاجأة",disgust:"اشمئزاز",romantic:"رومانسي",anxious:"قلق",confident:"ثقة" };
const TAG_LABELS: Record<string,string> = { "[laughs]":"ضحك","[curious]":"فضول","[excited]":"حماس","[neutral]":"محايد","[sad]":"حزن","[mischievously]":"مكر","[whispers]":"همس","[sarcastic]":"سخرية" };
const ASSET_TYPE_META: Record<string,{emoji:string;label:string}> = {
  music:{emoji:"🎼",label:"موسيقى"}, ambience:{emoji:"🌧️",label:"أجواء"}, foley:{emoji:"👣",label:"فولي"}, sfx:{emoji:"💥",label:"مؤثرات"}
};
const STATUS_META: Record<string,{emoji:string;cls:string}> = {
  proposed:{emoji:"🟡",cls:"bg-yellow-500/20 text-yellow-400"},
  approved:{emoji:"✅",cls:"bg-green-500/20 text-green-400"},
  rejected:{emoji:"⚫",cls:"bg-zinc-500/20 text-zinc-400"}
};
const fmt = (s:number) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;

export default function SceneAudioEngineering({ shot, projectId }: { shot:any; projectId:number }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"analyze"|"preview"|"restore"|null>(null);
  const [previewUrl, setPreviewUrl] = useState<string|null>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [aiBusy, setAiBusy] = useState(false);
  const [assetBusy, setAssetBusy] = useState<number|null>(null);
  const [editingId, setEditingId] = useState<number|null>(null);
  const [editFields, setEditFields] = useState<any>({});
  const [playing, setPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);
  const [playCurrent, setPlayCurrent] = useState(0);
  const [playDuration, setPlayDuration] = useState(0);
  const audioRefs = useRef<HTMLAudioElement[]>([]);
  const urlRefs = useRef<string[]>([]);
  const timerRef = useRef<number|null>(null);

  const instr = shot.audioInstruction;
  const manual = shot.manualInstruction;
  const mergedEmotion = manual?.fields?.emotion?.value ?? instr?.fields?.emotion?.value ?? null;
  const mergedTag = manual?.fields?.audar_tag?.value ?? instr?.fields?.audar_tag?.value ?? null;
  const mergedIntensity = manual?.fields?.intensity?.value ?? instr?.fields?.intensity?.value ?? null;
  const resolved = shot.resolvedText;
  const confidence = instr?.fields?.emotion?.confidence ?? null;

  const stopAll = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    audioRefs.current.forEach(a => { try { a.pause(); a.currentTime = 0; } catch {} });
    audioRefs.current = [];
    urlRefs.current.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
    urlRefs.current = [];
    setPlaying(false); setPlayProgress(0); setPlayCurrent(0);
  };

  const reloadAssets = async () => {
    try {
      const r = await fetch(`/api/shots/${shot.id}/audio-assets`, { credentials: "include" });
      const d = await r.json();
      setAssets(d.assets || []);
    } catch {}
  };

  useEffect(() => {
    setAssetsLoading(true);
    reloadAssets().finally(() => setAssetsLoading(false));
    return () => stopAll();
  }, [shot.id]);

  const updateStatus = async (id:number, status:string) => {
    setAssetBusy(id);
    try {
      const r = await fetch(`/api/shot-audio-assets/${id}`, { method:"PATCH", credentials:"include", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ status }) });
      if (!r.ok) throw new Error("فشل التحديث");
      setAssets(p => p.map(a => a.id===id ? { ...a, status } : a));
    } catch (e:any) { toast.error(e.message); } finally { setAssetBusy(null); }
  };

  const saveEdit = async (id:number) => {
    setAssetBusy(id);
    try {
      const body:any = {};
      for (const k of ["start_time","end_time","volume","fade_in","fade_out"] as const) {
        if (editFields[k] !== undefined) body[k] = parseFloat(editFields[k]);
      }
      const r = await fetch(`/api/shot-audio-assets/${id}`, { method:"PATCH", credentials:"include", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
      if (!r.ok) throw new Error("فشل الحفظ");
      const d = await r.json();
      setAssets(p => p.map(a => a.id===id ? d.asset : a));
      setEditingId(null); toast.success("تم الحفظ");
    } catch (e:any) { toast.error(e.message); } finally { setAssetBusy(null); }
  };

  const deleteAsset = async (id:number) => {
    if (!confirm("حذف هذا الأصل؟")) return;
    setAssetBusy(id);
    try {
      const r = await fetch(`/api/shot-audio-assets/${id}`, { method:"DELETE", credentials:"include" });
      if (!r.ok) throw new Error("فشل الحذف");
      setAssets(p => p.filter(a => a.id !== id)); toast.success("تم الحذف");
    } catch (e:any) { toast.error(e.message); } finally { setAssetBusy(null); }
  };

  const suggestAI = async () => {
    setAiBusy(true);
    try {
      const r = await fetch(`/api/shots/${shot.id}/suggest-audio`, { method:"POST", credentials:"include" });
      if (!r.ok) { const d = await r.json().catch(()=>({})); throw new Error(d.detail || d.error || "فشل الاقتراح"); }
      await reloadAssets(); toast.success("تم جلب اقتراحات AI");
    } catch (e:any) { toast.error(e.message); } finally { setAiBusy(false); }
  };

  const fetchAsUrl = async (url:string): Promise<string|null> => {
    try {
      const r = await fetch(url, { credentials:"include" });
      if (!r.ok) return null;
      const b = await r.blob();
      const u = URL.createObjectURL(b);
      urlRefs.current.push(u);
      return u;
    } catch { return null; }
  };

  const previewAll = async () => {
    if (playing) { stopAll(); return; }
    stopAll();
    const approved = assets.filter(a => a.status === "approved");
    const items: {url:string; start:number; end:number; volume:number}[] = [];
    if (shot.audioUrl) items.push({ url: shot.audioUrl, start: 0, end: 30, volume: 1.0 });
    approved.forEach(a => items.push({ url: a.audioUrl, start: a.startTime ?? 0, end: a.endTime ?? 10, volume: a.volume ?? 0.7 }));
    if (items.length === 0) { toast.error("لا يوجد صوت للتشغيل"); return; }
    toast.loading("تحميل...", { id: "load" });
    const loaded: {el:HTMLAudioElement; start:number; end:number}[] = [];
    for (const it of items) {
      const u = await fetchAsUrl(it.url);
      if (!u) continue;
      const el = new Audio(u);
      el.preload = "auto";
      el.volume = Math.max(0, Math.min(1, it.volume));
      await new Promise<void>(res => {
        if (el.readyState >= 1) return res();
        el.addEventListener("loadedmetadata", () => res(), { once: true });
        el.addEventListener("error", () => res(), { once: true });
        setTimeout(res, 3000);
      });
      loaded.push({ el, start: it.start, end: it.end });
    }
    toast.dismiss("load");
    if (loaded.length === 0) { toast.error("فشل تحميل الصوت"); return; }
    audioRefs.current = loaded.map(l => l.el);
    const t0 = Date.now();
    loaded.forEach(({ el, start, end }) => {
      setTimeout(() => { el.play().catch(()=>{}); }, start * 1000);
      if (end < 60) setTimeout(() => { el.pause(); el.currentTime = 0; }, end * 1000);
    });
    const maxDur = Math.max(...loaded.map(l => l.end), 5);
    setPlayDuration(maxDur); setPlaying(true);
    timerRef.current = window.setInterval(() => {
      const el2 = (Date.now() - t0) / 1000;
      setPlayCurrent(Math.min(el2, maxDur));
      setPlayProgress(Math.min(1, el2 / maxDur));
      if (el2 >= maxDur) stopAll();
    }, 100);
  };

  const analyze = async (force = false) => {
    setBusy("analyze");
    try {
      const r = await fetch(`/api/shots/${shot.id}/analyze`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ force }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "فشل التحليل");
      toast.success("تم تحليل المشهد");
      queryClient.invalidateQueries({ queryKey: getListProjectShotsQueryKey(projectId) });
    } catch (e:any) { toast.error(e.message); } finally { setBusy(null); }
  };

  const patchManual = async (fields:any) => {
    setBusy("analyze");
    try {
      const r = await fetch(`/api/shots/${shot.id}/manual-instruction`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ fields }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "فشل الحفظ");
      toast.success("تم الحفظ");
      queryClient.invalidateQueries({ queryKey: getListProjectShotsQueryKey(projectId) });
    } catch (e:any) { toast.error(e.message); } finally { setBusy(null); }
  };

  const restore = async () => {
    setBusy("restore");
    try {
      const r = await fetch(`/api/shots/${shot.id}/restore-director`, { method:"POST" });
      if (!r.ok) throw new Error("فشل الاستعادة");
      toast.success("تمت الاستعادة");
      queryClient.invalidateQueries({ queryKey: getListProjectShotsQueryKey(projectId) });
    } catch (e:any) { toast.error(e.message); } finally { setBusy(null); }
  };

  const preview = async () => {
    setBusy("preview"); setPreviewUrl(null);
    try {
      const r = await fetch(`/api/shots/${shot.id}/preview-audio`, { method:"POST" });
      if (!r.ok) { const d = await r.json().catch(()=>({})); throw new Error(d.detail ? `فشل: ${d.detail}` : (d.error || "فشل التوليد")); }
      const blob = await r.blob();
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (e:any) { toast.error(e.message); } finally { setBusy(null); }
  };

  const grouped = assets.reduce<Record<string,any[]>>((acc, a) => {
    const k = a.assetType || "sfx";
    (acc[k] ||= []).push(a);
    return acc;
  }, {});

  return (
    <div className="mt-3 p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-3" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-bold text-primary"><Sparkles className="w-4 h-4" /> الهندسة الصوتية</div>
        <div className="flex items-center gap-1">
          {manual && <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded font-mono">يدوي</span>}
          {confidence !== null && confidence < 0.6 && <span className="text-[10px] bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded font-mono">ثقة منخفضة</span>}
          {instr?.fields?.audar_tag?.source === "dialogue" && <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded font-mono">حوار يدوي</span>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div><label className="text-[10px] text-muted-foreground">Emotion</label>
          <select value={mergedEmotion ?? ""} onChange={e => patchManual({ emotion: e.target.value || null })} className="w-full h-8 rounded border border-white/10 bg-zinc-900 px-2 text-xs text-white">
            <option value="">—</option>{EMOTIONS.map(x => <option key={x} value={x}>{EMOTION_LABELS[x]}</option>)}
          </select></div>
        <div><label className="text-[10px] text-muted-foreground">Audar Tag</label>
          <select value={mergedTag ?? ""} onChange={e => patchManual({ audar_tag: e.target.value || null })} className="w-full h-8 rounded border border-white/10 bg-zinc-900 px-2 text-xs text-white">
            <option value="">—</option>{AUDAR_TAGS.map(x => <option key={x} value={x}>{TAG_LABELS[x]}</option>)}
          </select></div>
        <div><label className="text-[10px] text-muted-foreground">Intensity: {mergedIntensity ?? "—"}</label>
          <input type="range" min="0" max="1" step="0.1" value={mergedIntensity ?? 0.5} onChange={e => patchManual({ intensity: parseFloat(e.target.value) })} className="w-full" /></div>
      </div>

      {resolved && <div className="text-[11px] font-mono bg-black/40 p-2 rounded border border-white/5 text-green-300 break-all">Resolved: {resolved}</div>}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => analyze()} disabled={busy !== null} className="h-7 text-xs gap-1">
          {busy === "analyze" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} تحليل</Button>
        <Button size="sm" variant="outline" onClick={preview} disabled={busy !== null || !resolved} className="h-7 text-xs gap-1">
          {busy === "preview" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />} معاينة</Button>
        {manual && (
          <Button size="sm" variant="outline" onClick={restore} disabled={busy !== null} className="h-7 text-xs gap-1 text-yellow-400">
            {busy === "restore" ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />} استعادة</Button>
        )}
      </div>
      {previewUrl && <audio src={previewUrl} controls className="w-full h-8 mt-2" />}

      <div className="border-t border-white/10 pt-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold text-primary">
            <Music className="w-4 h-4" /> أصول صوتية <span className="text-[10px] text-muted-foreground">({assets.length})</span>
          </div>
          <Button size="sm" variant="outline" onClick={suggestAI} disabled={aiBusy || playing} className="h-7 text-xs gap-1">
            {aiBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} اقترح من AI</Button>
        </div>

        {assetsLoading ? <div className="flex justify-center py-2"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
        : assets.length === 0 ? <p className="text-[11px] text-muted-foreground text-center py-2">لا توجد أصول بعد — اضغط "اقترح من AI"</p>
        : Object.entries(grouped).map(([type, list]) => (
          <div key={type}>
            <div className="text-[10px] text-muted-foreground mb-1">{ASSET_TYPE_META[type]?.emoji} {ASSET_TYPE_META[type]?.label} <span className="opacity-50">({list.length})</span></div>
            <div className="space-y-1">
              {list.map((a:any) => {
                const st = STATUS_META[a.status] || STATUS_META.proposed;
                const isEditing = editingId === a.id;
                return (
                  <div key={a.id} className="bg-black/30 border border-white/5 rounded px-2 py-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded ${st.cls}`}>{st.emoji} {a.status}</span>
                        <span className="text-[11px] font-mono truncate">#{a.id} · {a.startTime ?? 0}s–{a.endTime ?? "?"}s · vol {a.volume ?? 1}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => updateStatus(a.id, "approved")} disabled={assetBusy===a.id} title="اعتماد" className="w-6 h-6 rounded bg-green-500/20 text-green-400 hover:bg-green-500/40 disabled:opacity-30 flex items-center justify-center">
                          {assetBusy===a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}</button>
                        <button onClick={() => updateStatus(a.id, "rejected")} disabled={assetBusy===a.id} title="رفض" className="w-6 h-6 rounded bg-red-500/20 text-red-400 hover:bg-red-500/40 disabled:opacity-30 flex items-center justify-center"><X className="w-3 h-3" /></button>
                        <button onClick={() => { setEditingId(isEditing ? null : a.id); setEditFields({ start_time: a.startTime ?? 0, end_time: a.endTime ?? 5, volume: a.volume ?? 1, fade_in: a.fadeIn ?? 0, fade_out: a.fadeOut ?? 0 }); }} title="تعديل" className="w-6 h-6 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/40 flex items-center justify-center"><Pencil className="w-3 h-3" /></button>
                        <button onClick={() => deleteAsset(a.id)} disabled={assetBusy===a.id} title="حذف" className="w-6 h-6 rounded bg-zinc-500/20 text-zinc-400 hover:bg-zinc-500/40 disabled:opacity-30 flex items-center justify-center"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                    {isEditing && (
                      <div className="mt-1 pt-1 border-t border-white/5 grid grid-cols-5 gap-1 text-[10px]">
                        {(["start_time","end_time","volume","fade_in","fade_out"] as const).map(k => (
                          <div key={k}><label className="text-muted-foreground">{k.replace("_"," ")}</label>
                            <input type="number" step="0.1" min="0" value={editFields[k] ?? 0} onChange={e => setEditFields({ ...editFields, [k]: e.target.value })} className="w-full h-6 rounded border border-white/10 bg-zinc-900 px-1 text-[10px] text-white" /></div>
                        ))}
                        <div className="col-span-5 flex gap-1 mt-1">
                          <Button size="sm" onClick={() => saveEdit(a.id)} disabled={assetBusy===a.id} className="h-6 text-[10px] flex-1">{assetBusy===a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "حفظ"}</Button>
                          <Button size="sm" variant="outline" onClick={() => setEditingId(null)} className="h-6 text-[10px] flex-1">إلغاء</Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <Button onClick={previewAll} disabled={assets.length === 0 && !shot.audioUrl} variant={playing ? "default" : "outline"} size="sm" className="w-full h-8 text-xs gap-1 mt-2">
          {playing ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />} {playing ? "⏸️ إيقاف" : "▶️ معاينة الكل"}
        </Button>
        {playing && (
          <div className="space-y-1">
            <div className="w-full bg-white/10 rounded h-1.5 overflow-hidden">
              <div className="bg-primary h-1.5 transition-all" style={{ width: `${playProgress * 100}%` }} />
            </div>
            <div className="text-[10px] text-muted-foreground text-center font-mono">{fmt(playCurrent)} / {fmt(playDuration)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
