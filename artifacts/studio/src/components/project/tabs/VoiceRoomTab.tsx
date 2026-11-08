import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Mic, Play, Square, Check, X, Pencil, Trash2, Music, Volume2, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";

const STATUS_COLORS: Record<string, { label: string; cls: string; emoji: string }> = {
  NONE:        { label: "لا صوت",   cls: "bg-zinc-500/20 text-zinc-400",  emoji: "⚪" },
  QUEUED:      { label: "بالطابور", cls: "bg-blue-500/20 text-blue-400",  emoji: "🔵" },
  PROCESSING:  { label: "جاري",     cls: "bg-yellow-500/20 text-yellow-400", emoji: "🟡" },
  COMPLETED:   { label: "جاهز",     cls: "bg-green-500/20 text-green-400", emoji: "🟢" },
  FAILED:      { label: "فشل",      cls: "bg-red-500/20 text-red-400",    emoji: "🔴" },
};

const ASSET_META: Record<string, { emoji: string; label: string }> = {
  music: { emoji: "🎵", label: "الموسيقى" },
  ambience: { emoji: "🌧️", label: "الأجواء" },
  foley: { emoji: "👣", label: "الفولي" },
  sfx: { emoji: "💥", label: "المؤثرات" },
};

interface Project { id: number; title: string; }

export default function VoiceRoomTab({ project }: { project: Project }) {
  const [shots, setShots] = useState<any[]>([]);
  const [characters, setCharacters] = useState<any[]>([]);
  const [selectedShotId, setSelectedShotId] = useState<number | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [assets, setAssets] = useState<any[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedShot = shots.find(s => s.id === selectedShotId);
  const statusKey = selectedShot?.audioStatus?.toUpperCase() || "NONE";
  const status = STATUS_COLORS[statusKey] || STATUS_COLORS.NONE;

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

  useEffect(() => {
    setLoading(true);
    Promise.all([reloadShots(), reloadCharacters()]).finally(() => setLoading(false));
  }, [project.id]);

  useEffect(() => {
    if (selectedShotId) {
      reloadAssets(selectedShotId);
      if (selectedShot?.characterId) setSelectedCharacterId(selectedShot.characterId);
    }
  }, [selectedShotId]);

  const updateShotCharacter = async (charId: number) => {
    if (!selectedShotId) return;
    setSelectedCharacterId(charId);
    try {
      const r = await fetch(`/api/shots/${selectedShotId}/set-character`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: charId }),
      });
      if (!r.ok) throw new Error("فشل الحفظ");
      await reloadShots();
      toast.success("تم تعيين الشخصية");
    } catch (e: any) { toast.error(e.message); }
  };

  const handleGenerate = async () => {
    if (!selectedShotId) return;
    const character = characters.find(c => c.id === selectedCharacterId);
    if (!character) { toast.error("اختر شخصية أولاً"); return; }
    setGenerating(true);
    try {
      const voiceProfile = { voice: character.dialect === "jordanian" ? "jordanian" : "default" };
      const r = await fetch(`/api/shots/${selectedShotId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioStatus: "QUEUED",
          audioUrl: null,
          voiceEngine: character.engine,
          voiceProfile,
          characterId: character.id,
        }),
      });
      if (!r.ok) throw new Error("فشل الطلب");
      toast.success("تم إرسال المشهد للـ Worker");
      await reloadShots();
    } catch (e: any) { toast.error(e.message); }
    finally { setGenerating(false); }
  };

  const handlePlay = () => {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    if (!selectedShot?.audioUrl) return;
    const url = selectedShot.audioUrl.startsWith("http") ? selectedShot.audioUrl : selectedShot.audioUrl;
    const a = new Audio(url);
    audioRef.current = a;
    a.onended = () => setPlaying(false);
    a.onerror = () => { toast.error("فشل التحميل"); setPlaying(false); };
    a.play().then(() => setPlaying(true)).catch((e) => toast.error("فشل التشغيل: " + e.message));
  };

  const handleApprove = async () => {
    if (!selectedShotId) return;
    try {
      const r = await fetch(`/api/shots/${selectedShotId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioStatus: "COMPLETED" }),
      });
      if (!r.ok) throw new Error("فشل الاعتماد");
      toast.success("تم الاعتماد");
      await reloadShots();
    } catch (e: any) { toast.error(e.message); }
  };

  const onUploadAsset = async (file: File) => {
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
        body: JSON.stringify({ asset_type: "sfx", audio_url: "/api/storage/supabase/" + filePath, start_time: 0, end_time: 10, volume: 1.0, status: "approved", source: "manual" }),
      });
      if (!ar.ok) throw new Error("فشل الإضافة");
      toast.success("تم الرفع");
      await reloadAssets(selectedShotId);
    } catch (e: any) { toast.error(e.message); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const handleDeleteAsset = async (assetId: number) => {
    if (!selectedShotId || !confirm("حذف؟")) return;
    try {
      await fetch(`/api/shot-audio-assets/${assetId}`, { method: "DELETE", credentials: "include" });
      await reloadAssets(selectedShotId);
    } catch (e: any) { toast.error(e.message); }
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  // No shot selected: selector
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
          {recent.length === 0 ? (
            <p className="text-center text-muted-foreground">لا يوجد مشاهد في هذا المشروع</p>
          ) : recent.map(shot => {
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

  // Shot selected: voice room
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setSelectedShotId(null); setAssets([]); }}>← رجوع</Button>
          <select
            value={selectedShotId}
            onChange={e => setSelectedShotId(Number(e.target.value))}
            className="h-8 rounded border border-white/10 bg-zinc-900 px-2 text-sm text-white"
          >
            {shots.map(s => <option key={s.id} value={s.id}>مشهد #{s.id} — {(s.dialogue || "").slice(0, 30)}</option>)}
          </select>
        </div>
        <span className={`text-xs px-2 py-1 rounded ${status.cls}`}>{status.emoji} {status.label}</span>
      </div>

      {/* Dialogue Section */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-primary">
          <Mic className="w-4 h-4" /> الحوار
        </div>

        <div>
          <label className="text-xs text-muted-foreground">الشخصية</label>
          <select
            value={selectedCharacterId ?? ""}
            onChange={e => updateShotCharacter(Number(e.target.value))}
            className="w-full h-9 rounded border border-white/10 bg-zinc-900 px-2 text-sm text-white mt-1"
          >
            <option value="">— اختر شخصية —</option>
            {characters.map(c => (
              <option key={c.id} value={c.id}>{c.name} — {c.dialect} ({c.engine})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">النص</label>
          <div className="bg-black/40 p-2 rounded border border-white/5 text-sm text-green-300 mt-1">
            {selectedShot?.dialogue || "—"}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={handleGenerate} disabled={generating || !selectedCharacterId} className="gap-1">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {generating ? "جاري الإرسال..." : "🎬 ولّد الصوت"}
          </Button>

          {selectedShot?.audioUrl && (
            <>
              <Button size="sm" variant="outline" onClick={handlePlay} className="gap-1">
                {playing ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {playing ? "إيقاف" : "استمع"}
              </Button>
              <Button size="sm" variant="outline" onClick={handleApprove} disabled={selectedShot?.audioStatus === "COMPLETED"} className="gap-1 text-green-400">
                <Check className="w-4 h-4" /> اعتماد
              </Button>
            </>
          )}
        </div>
      </div>

      {/* SFX/Music Section */}
      <div className="rounded-lg border border-white/10 bg-card/50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Volume2 className="w-4 h-4" /> المؤثرات والموسيقى ({assets.length})
          </div>
          <div className="flex gap-2">
            <input ref={fileInputRef} type="file" accept="audio/mpeg,.mp3" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onUploadAsset(f); }} />
            <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="gap-1">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              رفع من الهاتف
            </Button>
          </div>
        </div>

        {assetsLoading ? <div className="flex justify-center py-2"><Loader2 className="w-4 h-4 animate-spin" /></div>
        : assets.length === 0 ? <p className="text-center text-xs text-muted-foreground py-2">لا توجد مؤثرات بعد</p>
        : <div className="space-y-1">
            {assets.map(a => (
              <div key={a.id} className="bg-black/30 rounded p-2 flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span>{ASSET_META[a.assetType]?.emoji || "🔊"}</span>
                  <span className="font-mono text-xs">#{a.id} · {a.startTime ?? 0}s–{a.endTime ?? "?"}s</span>
                </div>
                <button onClick={() => handleDeleteAsset(a.id)} className="text-red-400 hover:text-red-300"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        }
      </div>
    </div>
  );
}
