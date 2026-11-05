import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, RotateCcw, Eye, Play, Square, Check, X, Pencil, Trash2, Music, Plus, Upload } from "lucide-react";
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
  const [freshShot, setFreshShot] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [library, setLibrary] = useState<Record<string, any[]>>({});
  const audioRefs = useRef<HTMLAudioElement[]>([]);
  const urlRefs = useRef<string[]>([]);
  const timerRef = useRef<number|null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentlyPlayingId, setCurrentlyPlayingId] = useState<number|null>(null);
  const singleAudioRef = useRef<HTMLAudioElement|null>(null);

  const s = freshShot || shot;
  const instr = s.audioInstruction;
  const manual = s.manualInstruction;
  const mergedEmotion = manual?.fields?.emotion?.value ?? instr?.fields?.emotion?.value ?? null;
  const mergedTag = manual?.fields?.audar_tag?.value ?? instr?.fields?.audar_tag?.value ?? null;
  const mergedIntensity = manual?.fields?.intensity?.value ?? instr?.fields?.intensity?.value ?? null;
  const resolved = s.resolvedText;
  const confidence = instr?.fields?.emotion?.confidence ?? null;
  const shotDuration = Number(s.duration) || 5;

  const reloadFresh = async () => {
    try {
      const r = await fetch(`/api/shots/${shot.id}`, { credentials:"include" });
      if (!r.ok) return;
      const d = await r.json();
      const obj = d.shot || d;
      if (obj && typeof obj === "object") setFreshShot(obj);
    } catch {}
  };

  const stopAll = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    audioRefs.current.forEach(a => { try { a.pause(); a.currentTime = 0; } catch {} });
    audioRefs.current = [];
    urlRefs.current.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
    urlRefs.current = [];
    setPlaying(false); setPlayProgress(0); setPlayCurrent(0);
  };

  const loadLibrary = async () => {
    try {
      const types = ["music","ambience","foley","sfx"] as const;
      const results = await Promise.all(types.map(async t => {
        const r = await fetch(`/api/audio-library?type=${t}`, { credentials:"include" });
        if (!r.ok) return [t, []] as [string, any[]];
        const d = await r.json();
        return [t, d.assets || d.items || []] as [string, any[]];
      }));
      const map: Record<string, any[]> = {};
      results.forEach(([t, arr]) => { map[t] = arr; });
      setLibrary(map);
    } catch {}
  };

  const handleAssetChange = async (assetId:number, libIdStr:string) => {
    if (!libIdStr) return;
    const libId = Number(libIdStr);
    setAssetBusy(assetId);
    try {
      const r = await fetch(`/api/shot-audio-assets/${assetId}`, { method:"PATCH", credentials:"include", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ library_asset_id: libId }) });
      if (!r.ok) { const d = await r.json().catch(()=>({})); throw new Error(d.error || "فشل التبديل"); }
      const d = await r.json();
      setAssets(p => p.map(a => a.id===assetId ? d.asset : a));
      toast.success("تم تبديل الصوت");
    } catch (e:any) { toast.error(e.message); } finally { setAssetBusy(null); }
  };

  const reloadAssets = async () => {
    try {
      const r = await fetch(`/api/shots/${shot.id}/audio-assets`, { credentials:"include" });
      const d = await r.json();
      setAssets(d.assets || []);
    } catch {}
  };

  useEffect(() => {
    setAssetsLoading(true);
    setFreshShot(null);
    reloadFresh();
    loadLibrary();
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
        if (editFields[k] !== undefined) body[k] = Number(editFields[k]);
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
    if (currentlyPlayingId === id) stopSingle();
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

  const onFilePicked = async (file: File) => {
    if (file.type !== "audio/mpeg" && !file.name.toLowerCase().endsWith(".mp3")) { toast.error("يُقبل MP3 فقط"); return; }
    if (file.size > 10*1024*1024) { toast.error("الحد الأقصى 10MB"); return; }
    setUploading(true);
    try {
      const sr = await fetch("/api/storage/sign-upload", { method:"POST", credentials:"include", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ projectId, shotId: shot.id, mimeType:"audio/mpeg", fileSize: file.size }) });
      if (!sr.ok) { const d = await sr.json().catch(()=>({})); throw new Error(d.error || "فشل الحصول على رابط الرفع"); }
      const { signedUrl, filePath } = await sr.json();
      const pr = await fetch(signedUrl, { method:"PUT", headers:{"Content-Type":"audio/mpeg"}, body: file });
      if (!pr.ok) throw new Error("فشل رفع الملف");
      const audio_url = "/api/storage/supabase/" + filePath;
      const ar = await fetch(`/api/shots/${shot.id}/audio-assets`, { method:"POST", credentials:"include", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ asset_type:"sfx", audio_url, start_time:0, end_time: shotDuration, volume:1.0, fade_in:0, fade_out:0, status:"approved", source:"manual" }) });
      if (!ar.ok) { const d = await ar.json().catch(()=>({})); throw new Error(d.detail || d.error || "فشل إضافة الأصل"); }
      await reloadAssets();
      toast.success("تم رفع الصوت وإضافته");
    } catch (e:any) { toast.error(e.message); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const stopSingle = () => {
    if (singleAudioRef.current) {
      try { singleAudioRef.current.pause(); singleAudioRef.current.currentTime = 0; } catch {}
      singleAudioRef.current = null;
    }
    setCurrentlyPlayingId(null);
  };

  const playOne = async (asset: any) => {
    if (currentlyPlayingId === asset.id) { stopSingle(); return; }
    stopSingle();
    if (playing) stopAll();
    try {
      const el = new Audio(asset.audioUrl);
      el.volume = Math.max(0, Math.min(1, asset.volume ?? 1));
      el.onended = () => { setCurrentlyPlayingId(null); singleAudioRef.current = null; };
      el.onerror = () => { toast.error("فشل تحميل الصوت"); setCurrentlyPlayingId(null); singleAudioRef.current = null; };
      singleAudioRef.current = el;
      setCurrentlyPlayingId(asset.id);
      await el.play();
    } catch {
      toast.error("فشل التشغيل");
      setCurrentlyPlayingId(null);
      singleAudioRef.current = null;
    }
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
    if (s.audioUrl) items.push({ url: s.audioUrl, start: 0, end: 60, volume: 1.0 });
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
      await reloadFresh();
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
      await reloadFresh();
      queryClient.invalidateQueries({ queryKey: getListProjectShotsQueryKey(projectId) });
    } catch (e:any) { toast.error(e.message); } finally { setBusy(null); }
  };

  const restore = async () => {
    setBusy("restore");
    try {
      const r = await fetch(`/api/shots/${shot.id}/restore-director`, { method:"POST" });
      if (!r.ok) throw new Error("فشل الاستعادة");
      toast.success("تمت الاستعادة");
      await reloadFresh();
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

  const sliders = [
    { k:"start_time", label:"البداية", min:0, max:shotDuration, step:0.1, fmt:(v:number)=>`${v.toFixed(1)}s` },
    { k:"end_time",   label:"النهاية", min:0, max:shotDuration, step:0.1, fmt:(v:number)=>`${v.toFixed(1)}s` },
    { k:"volume",     label:"الصوت",   min:0, max:1, step:0.05, fmt:(v:number)=>`${Math.round(v*100)}%` },
    { k:"fade_in",    label:"Fade In",  min:0, max:3, step:0.1, fmt:(v:number)=>`${v.toFixed(1)}s` },
    { k:"fade_out",   label:"Fade Out", min:0, max:3, step:0.1, fmt:(v:number)=>`${v.toFixed(1)}s` },
  ];

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
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-primary">
            <Music className="w-4 h-4" /> أصول صوتية <span className="text-[10px] text-muted-foreground">({assets.length})</span>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading || playing} className="h-7 text-xs gap-1">
              {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} إضافة صوت يدوي</Button>
            <Button size="sm" variant="outline" onClick={suggestAI} disabled={aiBusy || playing} className="h-7 text-xs gap-1">
              {aiBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} اقترح من AI</Button>
          </div>
          <input ref={fileInputRef} type="file" accept="audio/mpeg,.mp3" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFilePicked(f); }} />
        </div>

        {assetsLoading ? <div className="flex justify-center py-2"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
        : assets.length === 0 ? <p className="text-[11px] text-muted-foreground text-center py-2">لا توجد أصول بعد — اضغط "اقترح من AI" أو "إضافة صوت يدوي"</p>
        : Object.entries(grouped).map(([type, list]) => (
          <div key={type}>
            <div className="text-[10px] text-muted-foreground mb-1">{ASSET_TYPE_META[type]?.emoji} {ASSET_TYPE_META[type]?.label} <span className="opacity-50">({list.length})</span></div>
            <div className="space-y-1">
              {list.map((a:any) => {
                const st = STATUS_META[a.status] || STATUS_META.proposed;
                const isEditing = editingId === a.id;
                return (
                  <div key={a.id} className="bg-black/30 border border-white/5 rounded px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${st.cls}`}>{st.emoji} {a.status}</span>
                        <select
                          value={String(a.libraryAssetId ?? "")}
                          onChange={e => handleAssetChange(a.id, e.target.value)}
                          disabled={assetBusy===a.id}
                          className="flex-1 min-w-0 h-7 rounded border border-white/10 bg-zinc-900 px-1 text-[11px] text-white truncate"
                        >
                          <option value="">— اختر من المكتبة —</option>
                          {(library[a.assetType || "sfx"] || []).map((lib:any) => (
                            <option key={lib.id} value={String(lib.id)}>{lib.name || `#${lib.id}`}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => updateStatus(a.id, "approved")} disabled={assetBusy===a.id} title="اعتماد" className="w-9 h-9 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/40 disabled:opacity-30 flex items-center justify-center">
                          {assetBusy===a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}</button>
                        <button onClick={() => updateStatus(a.id, "rejected")} disabled={assetBusy===a.id} title="رفض" className="w-9 h-9 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/40 disabled:opacity-30 flex items-center justify-center"><X className="w-4 h-4" /></button>
                        <button onClick={() => { setEditingId(isEditing ? null : a.id); setEditFields({ start_time: a.startTime ?? 0, end_time: a.endTime ?? shotDuration, volume: a.volume ?? 1, fade_in: a.fadeIn ?? 0, fade_out: a.fadeOut ?? 0 }); }} title="تعديل" className="w-9 h-9 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/40 flex items-center justify-center"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => playOne(a)} title="تشغيل" className="w-9 h-9 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/40 flex items-center justify-center">
                          {currentlyPlayingId === a.id ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}</button>
                        <button onClick={() => deleteAsset(a.id)} disabled={assetBusy===a.id} title="حذف" className="w-9 h-9 rounded-lg bg-zinc-500/20 text-zinc-400 hover:bg-zinc-500/40 disabled:opacity-30 flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-1">#{a.id} · {a.startTime ?? 0}s–{a.endTime ?? "?"}s · vol {Math.round((a.volume ?? 1)*100)}%</div>
                    {isEditing && (
                      <div className="mt-2 pt-2 border-t border-white/10 space-y-2">
                        {sliders.map(({ k, label, min, max, step, fmt }) => {
                          const v = Number(editFields[k] ?? 0);
                          return (
                            <div key={k}>
                              <div className="flex items-center justify-between text-[10px] mb-0.5">
                                <label className="text-muted-foreground">{label}</label>
                                <span className="font-mono text-white">{fmt(v)}</span>
                              </div>
                              <input type="range" min={min} max={max} step={step} value={v}
                                onChange={e => setEditFields({ ...editFields, [k]: Number(e.target.value) })}
                                className="w-full accent-primary" />
                            </div>
                          );
                        })}
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" onClick={() => saveEdit(a.id)} disabled={assetBusy===a.id} className="h-8 text-[11px] flex-1">{assetBusy===a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "حفظ"}</Button>
                          <Button size="sm" variant="outline" onClick={() => setEditingId(null)} className="h-8 text-[11px] flex-1">إلغاء</Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <Button onClick={previewAll} disabled={assets.length === 0 && !s.audioUrl} variant={playing ? "default" : "outline"} size="sm" className="w-full h-9 text-xs gap-1 mt-2">
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
