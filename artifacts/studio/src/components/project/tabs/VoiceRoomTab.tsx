import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Mic, Play, Square, Check, X, Pencil, Trash2, Music, Volume2, Plus, Sparkles, Film, RotateCcw, Settings2, Headphones } from "lucide-react";
import { toast } from "sonner";

const STATUS_COLORS: Record<string, { label: string; cls: string; emoji: string }> = {
  NONE:       { label: "لا صوت",   cls: "bg-zinc-500/20 text-zinc-400",     emoji: "⚪" },
  QUEUED:     { label: "بالطابور", cls: "bg-blue-500/20 text-blue-400",     emoji: "🔵" },
  PROCESSING: { label: "جاري",     cls: "bg-yellow-500/20 text-yellow-400", emoji: "🟡" },
  COMPLETED:  { label: "جاهز",     cls: "bg-green-500/20 text-green-400",   emoji: "🟢" },
  FAILED:     { label: "فشل",      cls: "bg-red-500/20 text-red-400",       emoji: "🔴" },
};

const ENGINE_LABELS: Record<string, string> = {
  audar_flash: "Audar-Flash",
  audar: "Audar (فصحى)",
  lahgtna: "Lahgtna (احتياطي)",
};

// KAYAN Sprint F2: 4 approved emotion tags
const EMOTIONS: { value: string; label: string; tag: string }[] = [
  { value: "neutral", label: "محايد", tag: "neutral" },
  { value: "curious", label: "فضولي", tag: "curious" },
  { value: "excited", label: "متحمس", tag: "excited" },
  { value: "mischievously", label: "ماكر", tag: "mischievously" },
];

interface Project { id: number; title: string; }
interface EditState { id: number; start_time: number; end_time: number; volume: number; fade_in: number; fade_out: number; }

export default function VoiceRoomTab({ project }: { project: Project }) {
  const [shots, setShots] = useState<any[]>([]);
  const [characters, setCharacters] = useState<any[]>([]);
  const [library, setLibrary] = useState<any[]>([]);
  const [selectedShotId, setSelectedShotId] = useState<number | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(null);
  const [selectedEmotion, setSelectedEmotion] = useState<string>("neutral");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [addModal, setAddModal] = useState<"sfx" | "music" | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showSampleFor, setShowSampleFor] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputModeRef = useRef<"sfx" | "music" | null>(null);

  const selectedShot = shots.find(s => s.id === selectedShotId);
  const statusKey = selectedShot?.audioStatus?.toUpperCase() || "NONE";
  const status = STATUS_COLORS[statusKey] || STATUS_COLORS.NONE;
  const selectedCharacter = characters.find(c => c.id === selectedCharacterId);

  const sfxAssets = assets.filter(a => ["sfx", "foley", "ambience"].includes(a.assetType));
  const musicAssets = assets.filter(a => a.assetType === "music");

  // === Loaders ===
  const reloadShots = async () => {
    try {
      const r = await fetch(`/api/projects/${project.id}/shots`, { credentials: "include" });
      const d = await r.json();
      setShots(Array.isArray(d) ? d : d.shots || []);
    } catch {}
  };
  const reloadCharacters = async () => {
    try {
      const r = await fetch(`/api/projects/${project.id}/characters`, { credentials: "include" });
      const d = await r.json();
      setCharacters(d.characters || []);
    } catch {}
  };
  const reloadAssets = async (shotId: number) => {
    setAssetsLoading(true);
    try {
      const r = await fetch(`/api/shots/${shotId}/audio-assets`, { credentials: "include" });
      const d = await r.json();
      setAssets(d.assets || []);
    } catch {}
    setAssetsLoading(false);
  };
  const reloadLibrary = async () => {
    try {
      const r = await fetch(`/api/audio-library`, { credentials: "include" });
      const d = await r.json();
      setLibrary(d.assets || []);
    } catch {}
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([reloadShots(), reloadCharacters(), reloadLibrary()]).finally(() => {
      setLoading(false);
      try {
        const params = new URLSearchParams(window.location.search);
        const shotParam = params.get("shot");
        if (shotParam) {
          const sid = Number(shotParam);
          if (Number.isInteger(sid) && sid > 0) setSelectedShotId(sid);
        }
      } catch {}
    });
  }, [project.id]);

  useEffect(() => {
    if (selectedShotId) {
      reloadAssets(selectedShotId);
      if (selectedShot?.characterId) setSelectedCharacterId(selectedShot.characterId);
    const dbTag = selectedShot?.voiceProfile?.tag;
    if (dbTag && EMOTIONS.some(e => e.value === dbTag)) {
      setSelectedEmotion(dbTag);
    } else {
      setSelectedEmotion("neutral");
    }
    }
  }, [selectedShotId]);

  // === Playback ===
  const stopPlayback = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    setPlayingKey(null);
  };
  const playUrl = (url: string, key: string) => {
    if (playingKey === key) { stopPlayback(); return; }
    stopPlayback();
    const a = new Audio(url);
    audioRef.current = a;
    a.onended = () => setPlayingKey(null);
    a.onerror = () => { toast.error("فشل التحميل"); setPlayingKey(null); };
    a.play().then(() => setPlayingKey(key)).catch(e => toast.error("فشل التشغيل"));
  };

  // === Character ===
  const updateShotCharacter = async (charId: number) => {
    if (!selectedShotId) return;
    setSelectedCharacterId(charId);
    try {
      const r = await fetch(`/api/shots/${selectedShotId}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: charId }),
      });
      if (!r.ok) throw new Error("فشل الحفظ");
      await reloadShots();
      toast.success("تم تعيين الشخصية");
    } catch (e: any) { toast.error(e.message); }
  };
  const playCharacterSample = async (c: any) => {
    if (showSampleFor === c.id && playingKey === `sample-${c.id}`) { stopPlayback(); setShowSampleFor(null); return; }
    // Sample from Lahgtna server (user voice reference) — if engine=lahgtna
    // Fallback: toast info
    toast.info(`عينة ${c.name}: ستُشغّل من Oracle (ميزة قادمة). المحرك: ${c.engine}`);
    setShowSampleFor(c.id);
  };

  // === Dialogue actions ===
  const handleAnalyze = async () => {
    if (!selectedShotId) return;
    setBusy("analyze");
    try {
      const r = await fetch(`/api/shots/${selectedShotId}/analyze`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: false }),
      });
      if (!r.ok) { const d = await r.json().catch(()=>({})); throw new Error(d.error || "فشل التحليل"); }
      await reloadShots();
      toast.success("اقتراح AI جاهز (راجع resolved_text)");
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };
  const handleGenerate = async () => {
    if (!selectedShotId) return;
    const c = selectedCharacter;
    if (!c) { toast.error("اختر شخصية أولاً"); return; }
    setBusy("generate");
    try {
      const voiceProfile = {
        voice: c.dialect === "jordanian" ? "jordanian" : "default",
        tag: selectedEmotion,
      };
      const r = await fetch(`/api/shots/${selectedShotId}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioStatus: "QUEUED",
          audioUrl: null,
          voiceEngine: c.engine,
          voiceProfile,
          characterId: c.id,
        }),
      });
      if (!r.ok) throw new Error("فشل");
      toast.success("أُرسل للـ Worker");
      await reloadShots();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };
  const handleApprove = async () => {
    if (!selectedShotId) return;
    setBusy("approve");
    try {
      const r = await fetch(`/api/shots/${selectedShotId}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioStatus: "COMPLETED" }),
      });
      if (!r.ok) throw new Error("فشل");
      toast.success("تم الاعتماد");
      await reloadShots();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };
  const handleRegenerate = async () => {
    if (!selectedShotId) return;
    await handleGenerate();
  };

  // === Asset actions ===
  const updateAsset = async (id: number, patch: any) => {
    try {
      const r = await fetch(`/api/shot-audio-assets/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error("فشل");
      const d = await r.json();
      setAssets(p => p.map(a => a.id === id ? d.asset : a));
    } catch (e: any) { toast.error(e.message); }
  };
  const deleteAsset = async (id: number) => {
    if (!confirm("حذف؟")) return;
    try {
      const r = await fetch(`/api/shot-audio-assets/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error("فشل");
      setAssets(p => p.filter(a => a.id !== id));
      toast.success("تم الحذف");
    } catch (e: any) { toast.error(e.message); }
  };
  const saveEdit = async () => {
    if (!editing) return;
    await updateAsset(editing.id, {
      start_time: editing.start_time, end_time: editing.end_time,
      volume: editing.volume, fade_in: editing.fade_in, fade_out: editing.fade_out,
    });
    setEditing(null); toast.success("تم التعديل");
  };
  const addAssetFromLibrary = async (lib: any, kind: "sfx" | "music") => {
    if (!selectedShotId) return;
    try {
      const r = await fetch(`/api/shots/${selectedShotId}/audio-assets`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_type: lib.assetType || kind,
          audio_url: lib.audioUrl,
          library_asset_id: lib.id,
          start_time: 0,
          end_time: selectedShot?.durationSeconds || 5,
          volume: 0.7,
          fade_in: 0, fade_out: 0,
          status: "approved",
          source: "manual",
        }),
      });
      if (!r.ok) throw new Error("فشل");
      await reloadAssets(selectedShotId);
      toast.success("تمت الإضافة");
      setAddModal(null);
    } catch (e: any) { toast.error(e.message); }
  };
  const suggestAssetsAI = async () => {
    if (!selectedShotId) return;
    setBusy("suggest");
    try {
      const r = await fetch(`/api/shots/${selectedShotId}/suggest-audio`, { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error("فشل الاقتراح");
      await reloadAssets(selectedShotId);
      toast.success("تم جلب اقتراحات AI");
      setAddModal(null);
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };
  const triggerUpload = (kind: "sfx" | "music") => {
    fileInputModeRef.current = kind;
    fileInputRef.current?.click();
  };
  const onUploadAsset = async (file: File) => {
    const kind = fileInputModeRef.current || "sfx";
    if (!selectedShotId) return;
    setUploading(true);
    try {
      const sr = await fetch("/api/storage/sign-upload", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, shotId: selectedShotId, mimeType: "audio/mpeg", fileSize: file.size }),
      });
      if (!sr.ok) throw new Error("فشل الحصول على رابط الرفع");
      const { signedUrl, filePath } = await sr.json();
      const pr = await fetch(signedUrl, { method: "PUT", headers: { "Content-Type": "audio/mpeg" }, body: file });
      if (!pr.ok) throw new Error("فشل الرفع");
      const ar = await fetch(`/api/shots/${selectedShotId}/audio-assets`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_type: kind,
          audio_url: "/api/storage/supabase/" + filePath,
          start_time: 0, end_time: selectedShot?.durationSeconds || 5,
          volume: 1.0, fade_in: 0, fade_out: 0,
          status: "approved", source: "manual",
        }),
      });
      if (!ar.ok) throw new Error("فشل الإضافة");
      await reloadAssets(selectedShotId);
      toast.success("تم الرفع");
      setAddModal(null);
    } catch (e: any) { toast.error(e.message); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const handleSync = async () => {
    setBusy("sync");
    try {
      const r = await fetch(`/api/projects/${project.id}/timeline/sync`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const d = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(d.error || "فشل");
      toast.success(`تمت المزامنة — Job ${d.jobId?.slice(0,8) || ""}`);
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  // === Renders ===
  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  if (!selectedShotId) {
    const recent = [...shots].sort((a, b) => (b.id || 0) - (a.id || 0)).slice(0, 5);
    return (
      <div className="space-y-4" dir="rtl">
        <div className="text-center py-6">
          <Mic className="w-12 h-12 mx-auto text-primary mb-3" />
          <h2 className="text-2xl font-bold">غرفة الصوت</h2>
          <p className="text-muted-foreground text-sm mt-1">اختر مشهداً للبدء</p>
        </div>
        <div className="grid grid-cols-1 gap-2 max-w-2xl mx-auto">
          {recent.length === 0 ? <p className="text-center text-muted-foreground">لا يوجد مشاهد</p>
          : recent.map(shot => {
            const k = shot.audioStatus?.toUpperCase() || "NONE";
            const st = STATUS_COLORS[k] || STATUS_COLORS.NONE;
            return (
              <button key={shot.id} onClick={() => setSelectedShotId(shot.id)} className="bg-card/50 hover:bg-card/80 border border-white/10 rounded-lg p-3 text-right transition">
                <div className="flex items-center justify-between">
                  <span className={`text-xs px-2 py-0.5 rounded ${st.cls}`}>{st.emoji} {st.label}</span>
                  <span className="text-xs text-muted-foreground font-mono">#{shot.id} · {shot.durationSeconds}s</span>
                </div>
                <p className="text-sm mt-1 line-clamp-2">{(shot.dialogue || "").slice(0, 80)}</p>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      <input ref={fileInputRef} type="file" accept="audio/mpeg,.mp3" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onUploadAsset(f); }} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setSelectedShotId(null); setAssets([]); }}>← رجوع</Button>
          <select value={selectedShotId} onChange={e => setSelectedShotId(Number(e.target.value))} className="h-8 rounded border border-white/10 bg-zinc-900 px-2 text-sm text-white">
            {shots.map(s => <option key={s.id} value={s.id}>مشهد #{s.id} — {(s.dialogue || "").slice(0, 30)}</option>)}
          </select>
        </div>
        <span className={`text-xs px-2 py-1 rounded ${status.cls}`}>{status.emoji} {status.label}</span>
      </div>

      {/* === DIALOGUE === */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-primary"><Mic className="w-4 h-4" /> الحوار</div>

        <div>
          <label className="text-xs text-muted-foreground">الشخصية</label>
          <div className="flex gap-2 mt-1">
            <select value={selectedCharacterId ?? ""} onChange={e => updateShotCharacter(Number(e.target.value))} className="flex-1 h-9 rounded border border-white/10 bg-zinc-900 px-2 text-sm text-white">
              <option value="">— اختر شخصية —</option>
              {characters.map(c => (
                <option key={c.id} value={c.id}>{c.name} — {c.dialect} ({ENGINE_LABELS[c.engine] || c.engine})</option>
              ))}
            </select>
            {selectedCharacter?.engine === "lahgtna" && (
              <Button size="sm" variant="outline" onClick={() => playCharacterSample(selectedCharacter)} className="gap-1">
                {playingKey === `sample-${selectedCharacter.id}` ? <Square className="w-3 h-3" /> : <Headphones className="w-3 h-3" />}
                استماع للعينة
              </Button>
            )}
          </div>
        </div>
              <div>
                <label className="text-xs text-muted-foreground">المشاعر</label>
                <select
                  value={selectedEmotion}
                  onChange={e => setSelectedEmotion(e.target.value)}
                  className="w-full h-9 rounded border border-white/10 bg-zinc-900 px-2 text-sm text-white mt-1"
                >
                  {EMOTIONS.map(em => (
                    <option key={em.value} value={em.value}>{em.label}</option>
                  ))}
                </select>
              </div>


        <div>
          <label className="text-xs text-muted-foreground">النص</label>
          <div className="bg-black/40 p-2 rounded border border-white/5 text-sm text-green-300 mt-1">{selectedShot?.dialogue || "—"}</div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={handleAnalyze} disabled={!!busy} className="gap-1">
            {busy === "analyze" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} اقترح من AI
          </Button>
          <Button size="sm" onClick={handleGenerate} disabled={!!busy || !selectedCharacterId} className="gap-1">
            {busy === "generate" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />} ولّد الصوت
          </Button>
          {selectedShot?.audioUrl && (
            <>
              <Button size="sm" variant="outline" onClick={() => playUrl(selectedShot.audioUrl, "shot")} className="gap-1">
                {playingKey === "shot" ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />} استمع
              </Button>
              <Button size="sm" variant="outline" onClick={handleApprove} disabled={selectedShot?.audioStatus === "COMPLETED"} className="gap-1 text-green-400">
                <Check className="w-4 h-4" /> اعتماد
              </Button>
              <Button size="sm" variant="outline" onClick={handleRegenerate} disabled={!!busy} className="gap-1 text-blue-400">
                <RotateCcw className="w-4 h-4" /> إعادة توليد
              </Button>
            </>
          )}
        </div>

        <div>
          <button onClick={() => setShowAdvanced(v => !v)} className="text-xs text-muted-foreground hover:text-white flex items-center gap-1">
            <Settings2 className="w-3 h-3" /> خيارات متقدمة {showAdvanced ? "▲" : "▼"}
          </button>
          {showAdvanced && (
            <div className="mt-2 p-2 bg-black/40 rounded border border-white/5 text-xs space-y-1">
              <div className="grid grid-cols-3 gap-2">
                <label className="text-muted-foreground">Start (s)</label>
                <input type="number" defaultValue={0} className="col-span-2 h-7 bg-zinc-900 rounded px-2 text-white" />
                <label className="text-muted-foreground">End (s)</label>
                <input type="number" defaultValue={selectedShot?.durationSeconds || 5} className="col-span-2 h-7 bg-zinc-900 rounded px-2 text-white" />
                <label className="text-muted-foreground">Volume</label>
                <input type="range" min="0" max="1" step="0.05" defaultValue="1" className="col-span-2 w-full" />
                <label className="text-muted-foreground">Fade In</label>
                <input type="range" min="0" max="3" step="0.1" defaultValue="0" className="col-span-2 w-full" />
                <label className="text-muted-foreground">Fade Out</label>
                <input type="range" min="0" max="3" step="0.1" defaultValue="0" className="col-span-2 w-full" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* === SFX === */}
      <div className="rounded-lg border border-white/10 bg-card/50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold"><Volume2 className="w-4 h-4" /> المؤثرات الصوتية ({sfxAssets.length})</div>
          <Button size="sm" variant="outline" onClick={() => setAddModal("sfx")} className="gap-1"><Plus className="w-4 h-4" /> إضافة مؤثر</Button>
        </div>
        {assetsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : sfxAssets.length === 0 ? <p className="text-xs text-muted-foreground text-center py-2">لا توجد مؤثرات</p>
        : <div className="space-y-1">{sfxAssets.map(a => (
          <div key={a.id} className="bg-black/30 rounded p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-mono"><span>💥</span>#{a.id} · {a.startTime ?? 0}s–{a.endTime ?? "?"}s · vol {Math.round((a.volume ?? 1)*100)}%</div>
              <div className="flex gap-1">
                <button onClick={() => playUrl(a.audioUrl, `asset-${a.id}`)} className="w-8 h-8 rounded bg-blue-500/20 text-blue-400 flex items-center justify-center">
                  {playingKey === `asset-${a.id}` ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <button onClick={() => setEditing({ id: a.id, start_time: a.startTime ?? 0, end_time: a.endTime ?? 5, volume: a.volume ?? 1, fade_in: a.fadeIn ?? 0, fade_out: a.fadeOut ?? 0 })} className="w-8 h-8 rounded bg-zinc-500/20 text-zinc-300 flex items-center justify-center"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => deleteAsset(a.id)} className="w-8 h-8 rounded bg-red-500/20 text-red-400 flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          </div>
        ))}</div>}
      </div>

      {/* === MUSIC === */}
      <div className="rounded-lg border border-white/10 bg-card/50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold"><Music className="w-4 h-4" /> الموسيقى التصويرية ({musicAssets.length})</div>
          <Button size="sm" variant="outline" onClick={() => setAddModal("music")} className="gap-1"><Plus className="w-4 h-4" /> إضافة موسيقى</Button>
        </div>
        {musicAssets.length === 0 ? <p className="text-xs text-muted-foreground text-center py-2">لا توجد موسيقى</p>
        : <div className="space-y-1">{musicAssets.map(a => (
          <div key={a.id} className="bg-black/30 rounded p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-mono"><span>🎵</span>#{a.id} · {a.startTime ?? 0}s–{a.endTime ?? "?"}s · vol {Math.round((a.volume ?? 1)*100)}%</div>
              <div className="flex gap-1">
                <button onClick={() => playUrl(a.audioUrl, `asset-${a.id}`)} className="w-8 h-8 rounded bg-blue-500/20 text-blue-400 flex items-center justify-center">
                  {playingKey === `asset-${a.id}` ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <button onClick={() => setEditing({ id: a.id, start_time: a.startTime ?? 0, end_time: a.endTime ?? 5, volume: a.volume ?? 1, fade_in: a.fadeIn ?? 0, fade_out: a.fadeOut ?? 0 })} className="w-8 h-8 rounded bg-zinc-500/20 text-zinc-300 flex items-center justify-center"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => deleteAsset(a.id)} className="w-8 h-8 rounded bg-red-500/20 text-red-400 flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          </div>
        ))}</div>}
      </div>

      {/* Sync button */}
      <Button onClick={handleSync} disabled={busy === "sync"} className="w-full h-10 gap-2">
        {busy === "sync" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />} مزامنة ورندرة الفيلم
      </Button>

      {/* Add Modal */}
      {addModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setAddModal(null)}>
          <div className="bg-card rounded-lg p-4 max-w-md w-full space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold">إضافة {addModal === "sfx" ? "مؤثر" : "موسيقى"}</h3>
              <button onClick={() => setAddModal(null)}><X className="w-5 h-5" /></button>
            </div>
            <Button variant="outline" onClick={suggestAssetsAI} disabled={busy === "suggest"} className="w-full gap-2 justify-start">
              {busy === "suggest" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} اقترح من AI
            </Button>
            <Button variant="outline" onClick={() => { setAddModal(null); triggerUpload(addModal); }} className="w-full gap-2 justify-start">
              <Plus className="w-4 h-4" /> رفع من الهاتف
            </Button>
            <div>
              <p className="text-xs text-muted-foreground mb-1">من المكتبة:</p>
              {library.filter(l => addModal === "music" ? l.assetType === "music" : ["sfx","foley","ambience"].includes(l.assetType)).length === 0
                ? <p className="text-xs text-muted-foreground py-2 text-center">المكتبة قيد الإنشاء. استخدم الرفع من الهاتف.</p>
                : <div className="max-h-40 overflow-y-auto space-y-1">{library.filter(l => addModal === "music" ? l.assetType === "music" : ["sfx","foley","ambience"].includes(l.assetType)).map(l => (
                  <button key={l.id} onClick={() => addAssetFromLibrary(l, addModal)} className="w-full text-right text-xs bg-black/30 hover:bg-black/50 rounded p-2 flex items-center justify-between">
                    <span>{l.name}</span>
                    <span className="text-muted-foreground text-[10px]">{l.assetType} · {Math.round(l.duration || 0)}s</span>
                  </button>
                ))}</div>
              }
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-card rounded-lg p-4 max-w-md w-full space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold">تعديل #{editing.id}</h3>
              <button onClick={() => setEditing(null)}><X className="w-5 h-5" /></button>
            </div>
            {[
              { k: "start_time", label: "البداية (s)", min: 0, max: selectedShot?.durationSeconds || 10, step: 0.1 },
              { k: "end_time", label: "النهاية (s)", min: 0, max: selectedShot?.durationSeconds || 10, step: 0.1 },
              { k: "volume", label: "الصوت", min: 0, max: 1, step: 0.05 },
              { k: "fade_in", label: "Fade In (s)", min: 0, max: 3, step: 0.1 },
              { k: "fade_out", label: "Fade Out (s)", min: 0, max: 3, step: 0.1 },
            ].map(({ k, label, min, max, step }) => (
              <div key={k}>
                <div className="flex justify-between text-xs mb-1"><span className="text-muted-foreground">{label}</span><span className="font-mono">{(editing as any)[k]}</span></div>
                <input type="range" min={min} max={max} step={step} value={(editing as any)[k]} onChange={e => setEditing({ ...editing, [k]: Number(e.target.value) })} className="w-full" />
              </div>
            ))}
            <div className="flex gap-2">
              <Button onClick={saveEdit} className="flex-1">حفظ</Button>
              <Button variant="outline" onClick={() => setEditing(null)} className="flex-1">إلغاء</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
