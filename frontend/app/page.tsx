"use client";
import { useState, useRef, useEffect } from "react";
import {
  Mic,
  Upload,
  Play,
  Square,
  Download,
  Undo2,
  Redo2,
  Settings2,
  AudioLines,
  Sparkles,
  Plus,
  Trash2,
  LoaderCircle,
  Music2,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Note,
  Melody,
  demoNotes,
  pitchName,
  clamp,
  quantize,
  validateMelody,
} from "@/lib/music/core";
import {
  audioContext,
  playNotes,
  stopAudio,
  decodeAudio,
  waveform,
  transcribe,
} from "@/lib/music/audio";
const PX = 72,
  ROW = 24;
function Choice({
  value,
  onChange,
  items,
  label,
}: {
  value: string;
  onChange: (s: string) => void;
  items: [string, string][];
  label: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="selectwide">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map(([v, t]) => (
          <SelectItem key={v} value={v}>
            {t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export default function Home() {
  const [melody, setMelody] = useState<Melody>({ notes: [], bpm: 100 });
  const { notes, bpm } = melody;
  const [past, setPast] = useState<Melody[]>([]),
    [future, setFuture] = useState<Melody[]>([]);
  const [selected, setSelected] = useState<string | null>(null),
    [voice, setVoice] = useState("keys"),
    [grid, setGrid] = useState("0.25");
  const [status, setStatus] = useState(
      "Ready. Record a melody or try the demo.",
    ),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0);
  const [recording, setRecording] = useState(false),
    [seconds, setSeconds] = useState(0),
    [sourceName, setSourceName] = useState("No recording yet"),
    [url, setUrl] = useState(""),
    [wave, setWave] = useState<number[]>([]);
  const [playing, setPlaying] = useState(false),
    [position, setPosition] = useState(0),
    [isDemo, setIsDemo] = useState(false);
  const [settings, setSettings] = useState(false),
    [provider, setProvider] = useState("openai"),
    [model, setModel] = useState(""),
    [apiKey, setApiKey] = useState("");
  const [instruction, setInstruction] = useState(""),
    [aiBusy, setAiBusy] = useState(false),
    [proposal, setProposal] = useState<
      (Melody & { explanation: string }) | null
    >(null);
  const fileRef = useRef<HTMLInputElement>(null),
    jsonRef = useRef<HTMLInputElement>(null),
    recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    recTimer = useRef<ReturnType<typeof setInterval> | null>(null),
    playTimer = useRef<ReturnType<typeof setInterval> | null>(null),
    audioRef = useRef<HTMLAudioElement>(null);
  const drag = useRef<{
      id: string;
      x: number;
      y: number;
      note: Note;
      before: Melody;
      resize: boolean;
    } | null>(null),
    current = useRef(melody);
  current.current = melody;
  const selectedNote = notes.find((n) => n.id === selected),
    step = Number(grid);
  const top = Math.max(76, ...notes.map((n) => n.pitch + 2)),
    bottom = Math.min(48, ...notes.map((n) => n.pitch - 2));
  const beats = Math.max(
      16,
      Math.ceil(Math.max(0, ...notes.map((n) => n.start + n.duration)) / 4) *
        4 +
        4,
    ),
    width = 56 + beats * PX;
  const locked = busy || recording || aiBusy;
  function message(text: string, err = false) {
    setStatus(text);
    setError(err);
  }
  function stop() {
    stopAudio();
    if (playTimer.current) clearInterval(playTimer.current);
    setPlaying(false);
    setPosition(0);
  }
  function commit(next: Melody) {
    stop();
    setPast((p) => [...p.slice(-39), current.current]);
    setFuture([]);
    setMelody(next);
    setProposal(null);
  }
  function changeNotes(next: Note[]) {
    if (next.length > 512) {
      message(
        "The editor supports up to 512 notes. Remove some notes first.",
        true,
      );
      return;
    }
    commit({ ...melody, notes: next });
  }
  function undo() {
    if (!past.length) return;
    stop();
    setFuture((f) => [current.current, ...f]);
    setMelody(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setProposal(null);
  }
  function redo() {
    if (!future.length) return;
    stop();
    setPast((p) => [...p, current.current]);
    setMelody(future[0]);
    setFuture((f) => f.slice(1));
    setProposal(null);
  }
  function updateNote(field: keyof Note, value: number) {
    if (!selectedNote || !Number.isFinite(value)) return;
    let n = { ...selectedNote, [field]: value };
    n = {
      ...n,
      pitch: clamp(Math.round(n.pitch), 21, 108),
      start: clamp(n.start, 0, 256),
      duration: clamp(n.duration, 0.0625, 64),
      velocity: clamp(n.velocity, 0.01, 1),
    };
    changeNotes(notes.map((x) => (x.id === n.id ? n : x)));
  }
  async function play(target = melody) {
    if (playing) {
      stop();
      return;
    }
    audioRef.current?.pause();
    try {
      const zero = await playNotes(target.notes, target.bpm, voice),
        ctx = await audioContext();
      setPlaying(true);
      const end = Math.max(0, ...target.notes.map((n) => n.start + n.duration));
      playTimer.current = setInterval(() => {
        const pos = ((ctx.currentTime - zero) * target.bpm) / 60;
        setPosition(Math.max(0, pos));
        if (pos > end + 0.4) stop();
      }, 30);
    } catch {
      message(
        "Unable to play audio. Check your browser sound permissions.",
        true,
      );
    }
  }
  async function processAudio(blob: Blob, name: string) {
    stop();
    setBusy(true);
    setProgress(0);
    setProposal(null);
    message("Reading audio...");
    try {
      const buffer = await decodeAudio(blob);
      setWave(waveform(buffer));
      setSourceName(name);
      setIsDemo(false);
      setUrl(URL.createObjectURL(blob));
      message(
        "Transcribing your melody. The first model load may take a moment...",
      );
      const found = await transcribe(buffer, current.current.bpm, setProgress);
      commit({ notes: found, bpm: current.current.bpm });
      setSelected(null);
      message(
        `Detected ${found.length} notes. Listen, then drag notes to make corrections.`,
      );
    } catch (e) {
      message(
        e instanceof Error
          ? e.message
          : "Transcription failed. Please try again.",
        true,
      );
    } finally {
      setBusy(false);
    }
  }
  async function startRecording() {
    stop();
    audioRef.current?.pause();
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      message(
        "This browser does not support recording. Upload an audio file instead.",
        true,
      );
      return;
    }
    setBusy(true);
    message("Please allow microphone access...");
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      stream.current = media;
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(
        (t) => MediaRecorder.isTypeSupported(t),
      );
      const rec = new MediaRecorder(
        media,
        mime ? { mimeType: mime } : undefined,
      );
      recorder.current = rec;
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = () => {
        media.getTracks().forEach((t) => t.stop());
        stream.current = null;
        if (recTimer.current) clearInterval(recTimer.current);
        setRecording(false);
        void processAudio(
          new Blob(chunks, { type: rec.mimeType }),
          "My humming",
        );
      };
      rec.onerror = () => {
        media.getTracks().forEach((t) => t.stop());
        if (recTimer.current) clearInterval(recTimer.current);
        setRecording(false);
        message("Recording was interrupted. Try again or upload audio.", true);
      };
      rec.start();
      setSeconds(0);
      setRecording(true);
      message("Recording. Click Stop when finished. Maximum 30 seconds.");
      const begin = Date.now();
      recTimer.current = setInterval(() => {
        const s = Math.floor((Date.now() - begin) / 1000);
        setSeconds(s);
        if (s >= 30 && rec.state === "recording") rec.stop();
      }, 200);
    } catch {
      stream.current?.getTracks().forEach((t) => t.stop());
      message(
        "Cannot access the microphone. Allow recording permission or upload audio.",
        true,
      );
    } finally {
      setBusy(false);
    }
  }
  function demo() {
    commit({ bpm: 100, notes: demoNotes.map((n) => ({ ...n })) });
    setIsDemo(true);
    setSourceName("Demo melody - 8 notes");
    setWave([]);
    setUrl("");
    setSelected(null);
    message(
      "This is a preset MIDI demo for playback and editing, not a transcription.",
    );
  }
  function download(data: Blob, name: string) {
    const link = document.createElement("a"),
      href = URL.createObjectURL(data);
    link.href = href;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  async function exportMidi() {
    setBusy(true);
    try {
      const response = await fetch("/api/midi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          melody,
          program: voice === "bell" ? 10 : voice === "synth" ? 80 : 0,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "MIDI export failed.");
      }
      download(await response.blob(), "humnote.mid");
      message(
        "MIDI exported. Open it in GarageBand, Logic, or another music app.",
      );
    } catch (e) {
      message(e instanceof Error ? e.message : "MIDI export failed.", true);
    } finally {
      setBusy(false);
    }
  }

  async function askAI() {
    if (!apiKey || !model.trim()) {
      setSettings(true);
      message(
        "Enter a model name and API key to edit your melody with natural language.",
      );
      return;
    }
    setAiBusy(true);
    setProposal(null);
    stop();
    message("AI is editing the melody based on your request...");
    try {
      const res = await fetch("/api/arrange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ melody, instruction, provider, model, apiKey }),
        signal: AbortSignal.timeout(65000),
      });
      const result = (await res.json()) as {
        error?: string;
        explanation?: string;
      };
      if (!res.ok) throw new Error(result.error || "AI editing failed.");
      const valid = validateMelody(result);
      setProposal({
        ...valid,
        explanation:
          result.explanation ?? "Changes are ready. Preview them first.",
      });
      message(
        "Your proposal is ready. Preview it and apply it when you are happy.",
      );
    } catch (e) {
      message(
        e instanceof Error
          ? e.message
          : "The AI service is temporarily unavailable.",
        true,
      );
    } finally {
      setAiBusy(false);
    }
  }
  useEffect(
    () => () => {
      stopAudio();
      if (playTimer.current) clearInterval(playTimer.current);
      if (recTimer.current) clearInterval(recTimer.current);
      if (recorder.current) {
        recorder.current.onstop = null;
        if (recorder.current.state === "recording") recorder.current.stop();
      }
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  function pointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = Math.round((e.clientX - d.x) / PX / step) * step,
      dy = Math.round((e.clientY - d.y) / ROW);
    setMelody({
      ...d.before,
      notes: d.before.notes.map((n) =>
        n.id !== d.id
          ? n
          : d.resize
            ? { ...n, duration: clamp(d.note.duration + dx, 0.0625, 64) }
            : {
                ...n,
                start: clamp(d.note.start + dx, 0, 256),
                pitch: clamp(d.note.pitch - dy, 21, 108),
              },
      ),
    });
  }
  function pointerEnd(cancel = false) {
    const d = drag.current;
    if (!d) return;
    if (cancel) setMelody(d.before);
    else if (JSON.stringify(current.current) !== JSON.stringify(d.before)) {
      setPast((p) => [...p.slice(-39), d.before]);
      setFuture([]);
      setProposal(null);
    }
    drag.current = null;
  }
  function keyboard(e: React.KeyboardEvent) {
    if (locked || /INPUT|TEXTAREA/.test((e.target as HTMLElement).tagName))
      return;
    if ((e.metaKey || e.ctrlKey) && e.key === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      if (notes.length) void play();
    }
    if (!selectedNote) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      changeNotes(notes.filter((n) => n.id !== selected));
      setSelected(null);
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      updateNote("pitch", selectedNote.pitch + (e.key === "ArrowUp" ? 1 : -1));
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      updateNote(
        e.shiftKey ? "duration" : "start",
        selectedNote[e.shiftKey ? "duration" : "start"] +
          (e.key === "ArrowRight" ? step : -step),
      );
    }
  }
  return (
    <main className="app" onKeyDown={keyboard}>
      <header className="topbar">
        <div className="brand">
          <div className="brandmark">
            <AudioLines />
          </div>
          <div>
            <b>Humnote</b>
            <span>MELODY WORKSPACE</span>
          </div>
        </div>
        <div className="row">
          <span className="muted">Capture the melody in your head</span>
          <Button variant="outline" onClick={() => setSettings(true)}>
            <Settings2 />
            Model settings
          </Button>
        </div>
      </header>
      <div className="titlebar">
        <div>
          <div className="eyebrow">FROM VOICE TO NOTES</div>
          <h1>My melody workspace</h1>
        </div>
        <span className="pill">Audio stays on your device</span>
      </div>
      <div className="workspace">
        <section style={{ minWidth: 0 }}>
          <div className="panel source">
            <div>
              <h2>
                {recording ? (
                  <span className="recording">
                    Recording - {seconds.toString().padStart(2, "0")} / 30 sec
                  </span>
                ) : (
                  "Hum it first. Fine-tune it here."
                )}
              </h2>
              <p>
                Record 5-30 seconds, one note at a time, without accompaniment.
              </p>
            </div>
            <div className="source-actions">
              <Button
                className="control-button"
                disabled={busy || aiBusy}
                onClick={() =>
                  recording ? recorder.current?.stop() : void startRecording()
                }
              >
                {recording ? <Square /> : <Mic />}
                {recording ? "Stop and transcribe" : "Start humming"}
              </Button>
              <Button
                className="control-button"
                variant="outline"
                disabled={locked}
                onClick={() => fileRef.current?.click()}
              >
                <Upload />
                Upload audio
              </Button>
            </div>
            <input
              hidden
              ref={fileRef}
              type="file"
              accept="audio/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void processAudio(f, f.name);
              }}
            />
            {wave.length > 0 && (
              <div className="wave" aria-label="Original recording waveform">
                {wave.map((v, i) => (
                  <i key={i} style={{ height: Math.max(2, v * 52) }} />
                ))}
              </div>
            )}
            {url && (
              <audio
                controls
                ref={audioRef}
                src={url}
                onPlay={stop}
                aria-label="Play original recording"
              />
            )}
            {busy && (
              <div style={{ gridColumn: "1/-1" }}>
                <progress max={1} value={progress} />
              </div>
            )}
          </div>
          <div className="panel">
            <div className="panelhead">
              <div className="row">
                <Music2 />
                <h2>Melody editor</h2>
                {isDemo && <span className="pill">Demo</span>}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="demo"
                disabled={locked}
                onClick={demo}
              >
                Try demo
              </Button>
            </div>
            <div className="toolbar">
              <div className="row">
                <Button
                  disabled={!notes.length || locked}
                  size="icon"
                  aria-label={playing ? "Stop playback" : "Play melody"}
                  onClick={() => void play()}
                >
                  {playing ? <Square /> : <Play />}
                </Button>
                <Choice
                  label="Preview sound"
                  value={voice}
                  onChange={(v) => {
                    stop();
                    setVoice(v);
                  }}
                  items={[
                    ["keys", "Soft keys"],
                    ["bell", "Clear bell"],
                    ["synth", "Synth"],
                  ]}
                />
                <label className="tempo">
                  <input
                    aria-label="Tempo BPM"
                    type="number"
                    min="40"
                    max="240"
                    key={`bpm-${bpm}`}
                    defaultValue={bpm}
                    disabled={locked}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      if (n >= 40 && n <= 240) commit({ ...melody, bpm: n });
                      else e.target.value = String(bpm);
                    }}
                  />
                  BPM
                </label>
              </div>
              <div className="row">
                <Button
                  aria-label="Undo"
                  variant="ghost"
                  size="icon"
                  disabled={!past.length || locked}
                  onClick={undo}
                >
                  <Undo2 />
                </Button>
                <Button
                  aria-label="Redo"
                  variant="ghost"
                  size="icon"
                  disabled={!future.length || locked}
                  onClick={redo}
                >
                  <Redo2 />
                </Button>
                <Button
                  variant="outline"
                  disabled={!notes.length || locked}
                  onClick={exportMidi}
                >
                  <Download />
                  Export MIDI
                </Button>
              </div>
            </div>
            <div
              className="rollscroll"
              tabIndex={0}
              aria-label="Piano roll. Double-click empty space to add a note. Arrow keys move the selected note. Shift and left or right adjust its duration."
            >
              <div
                className="roll"
                style={{ width, height: 30 + (top - bottom + 1) * ROW }}
                onPointerMove={pointerMove}
                onPointerUp={() => pointerEnd()}
                onPointerCancel={() => pointerEnd(true)}
                onDoubleClick={(e) => {
                  if (
                    locked ||
                    (e.target as HTMLElement).closest(".note,.pianokey,.ruler")
                  )
                    return;
                  const r = e.currentTarget.getBoundingClientRect(),
                    x = e.clientX - r.left - 56,
                    y = e.clientY - r.top - 30;
                  if (x < 0 || y < 0) return;
                  const id = crypto.randomUUID();
                  changeNotes([
                    ...notes,
                    {
                      id,
                      pitch: clamp(top - Math.floor(y / ROW), 21, 108),
                      start: clamp(Math.round(x / PX / step) * step, 0, 256),
                      duration: 1,
                      velocity: 0.75,
                    },
                  ]);
                  setSelected(id);
                }}
              >
                <div className="ruler">
                  {Array.from({ length: Math.ceil(beats / 4) }, (_, i) => (
                    <span key={i} style={{ left: i * 4 * PX + 8 }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  ))}
                </div>
                {Array.from({ length: top - bottom + 1 }, (_, i) => {
                  const pitch = top - i;
                  return (
                    <div
                      key={pitch}
                      className={`pitchrow ${[1, 3, 6, 8, 10].includes(pitch % 12) ? "black" : ""}`}
                    >
                      <div className="pianokey">{pitchName(pitch)}</div>
                    </div>
                  );
                })}
                <div className="gridlines" />
                {notes.map((n) => (
                  <div
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${pitchName(n.pitch)}, beat ${n.start.toFixed(2)}, duration ${n.duration.toFixed(2)} beats`}
                    className={`note ${selected === n.id ? "selected" : ""}`}
                    style={{
                      left: 56 + n.start * PX,
                      top: 30 + (top - n.pitch) * ROW + 2,
                      width: Math.max(7, n.duration * PX - 2),
                    }}
                    onFocus={() => setSelected(n.id)}
                    onPointerDown={(e) => {
                      if (locked) return;
                      e.preventDefault();
                      e.stopPropagation();
                      stop();
                      setSelected(n.id);
                      e.currentTarget.focus();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      drag.current = {
                        id: n.id,
                        x: e.clientX,
                        y: e.clientY,
                        note: { ...n },
                        before: melody,
                        resize: (e.target as HTMLElement).classList.contains(
                          "resize",
                        ),
                      };
                    }}
                  >
                    {n.duration > 0.3 ? pitchName(n.pitch) : ""}
                    <span className="resize" />
                  </div>
                ))}
                {playing && (
                  <div
                    className="playhead"
                    style={{ left: 56 + position * PX }}
                  />
                )}
                {!notes.length && (
                  <div className="emptyroll">
                    <Music2
                      style={{
                        width: 28,
                        height: 28,
                        margin: "0 auto 12px",
                        color: "#d5f96c",
                      }}
                    />
                    <p>Your melody will appear here</p>
                    <p style={{ fontSize: 14, marginTop: 8 }}>
                      Record your voice, upload audio, or click Try demo
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div className="rollfooter">
              <span>
                Drag to move - Drag the right edge to resize - Double-click to
                add
              </span>
              <span>{notes.length} notes - 4/4 grid</span>
            </div>
          </div>
          <div
            className={`status ${error ? "error" : ""}`}
            role="status"
            aria-live="polite"
          >
            {(busy || aiBusy) && (
              <LoaderCircle
                className="animate-spin"
                style={{ display: "inline", marginRight: 8 }}
              />
            )}
            {status}
          </div>
        </section>
        <aside className="side">
          <div className="panel">
            <div className="panelhead">
              <h2>Note inspector</h2>
              <span className="muted">
                {selectedNote ? pitchName(selectedNote.pitch) : "No selection"}
              </span>
            </div>
            <div className="sidecontent">
              <div className="fields">
                <label>
                  Pitch - MIDI
                  <input
                    type="number"
                    min="21"
                    max="108"
                    disabled={!selectedNote || locked}
                    key={`pitch-${selected}-${selectedNote?.pitch}`}
                    defaultValue={selectedNote?.pitch ?? ""}
                    placeholder="Select a note"
                    onBlur={(e) => updateNote("pitch", Number(e.target.value))}
                  />
                </label>
                <label>
                  Velocity - 1-100
                  <input
                    type="number"
                    min="1"
                    max="100"
                    disabled={!selectedNote || locked}
                    key={`velocity-${selected}-${selectedNote?.velocity}`}
                    defaultValue={
                      selectedNote
                        ? Math.round(selectedNote.velocity * 100)
                        : ""
                    }
                    placeholder="—"
                    onBlur={(e) =>
                      updateNote("velocity", Number(e.target.value) / 100)
                    }
                  />
                </label>
                <label>
                  Start - beats
                  <input
                    type="number"
                    min="0"
                    max="256"
                    step={step}
                    disabled={!selectedNote || locked}
                    key={`start-${selected}-${selectedNote?.start}`}
                    defaultValue={
                      selectedNote ? Number(selectedNote.start.toFixed(3)) : ""
                    }
                    placeholder="—"
                    onBlur={(e) => updateNote("start", Number(e.target.value))}
                  />
                </label>
                <label>
                  Duration - beats
                  <input
                    type="number"
                    min="0.0625"
                    max="64"
                    step={step}
                    disabled={!selectedNote || locked}
                    key={`duration-${selected}-${selectedNote?.duration}`}
                    defaultValue={
                      selectedNote
                        ? Number(selectedNote.duration.toFixed(3))
                        : ""
                    }
                    placeholder="—"
                    onBlur={(e) =>
                      updateNote("duration", Number(e.target.value))
                    }
                  />
                </label>
              </div>
              <div className="row" style={{ marginTop: 16 }}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={locked}
                  onClick={() => {
                    const id = crypto.randomUUID();
                    changeNotes([
                      ...notes,
                      {
                        id,
                        pitch: 60,
                        start: Math.min(
                          256,
                          Math.ceil(
                            Math.max(
                              0,
                              ...notes.map((n) => n.start + n.duration),
                            ),
                          ),
                        ),
                        duration: 1,
                        velocity: 0.75,
                      },
                    ]);
                    setSelected(id);
                  }}
                >
                  <Plus />
                  Add
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!selectedNote || locked}
                  onClick={() => {
                    changeNotes(notes.filter((n) => n.id !== selected));
                    setSelected(null);
                  }}
                >
                  <Trash2 />
                  Delete
                </Button>
              </div>
              <div
                style={{ height: 1, background: "#34393e", margin: "20px 0" }}
              />
              <label>
                Snap to grid
                <Choice
                  label="Grid resolution"
                  value={grid}
                  onChange={setGrid}
                  items={[
                    ["0.25", "Sixteenth note"],
                    ["0.5", "Eighth note"],
                    ["1", "Quarter note"],
                  ]}
                />
              </label>
              <Button
                variant="outline"
                className="full"
                style={{ marginTop: 12 }}
                disabled={!notes.length || locked}
                onClick={() => {
                  changeNotes(quantize(notes, step));
                  message(
                    "Notes aligned to the grid. You can undo this change.",
                  );
                }}
              >
                Quantize to grid
              </Button>
            </div>
          </div>
          <div className="panel">
            <div className="panelhead">
              <div className="row">
                <Sparkles style={{ color: "#d5f96c" }} />
                <h2>AI melody assistant</h2>
              </div>
            </div>
            <div className="sidecontent">
              <p>
                Describe your changes, preview the result, then decide whether
                to keep it.
              </p>
              <div className="chips">
                {[
                  "Tighten the rhythm",
                  "Transpose up two semitones",
                  "Keep the melody, soften the ending",
                ].map((s) => (
                  <button key={s} onClick={() => setInstruction(s)}>
                    {s}
                  </button>
                ))}
              </div>
              <textarea
                aria-label="AI editing instructions"
                placeholder="For example: keep the pitches, but make the rhythm more syncopated..."
                value={instruction}
                maxLength={1000}
                onChange={(e) => setInstruction(e.target.value)}
              />
              <Button
                className="full"
                disabled={!notes.length || !instruction.trim() || locked}
                onClick={() => void askAI()}
              >
                {aiBusy ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Sparkles />
                )}
                {aiBusy ? "Editing..." : "Generate proposal"}
              </Button>
              <p className="importnote">
                {apiKey && model
                  ? "Only notes and instructions are sent, never your recording."
                  : "Connect your own model to enable AI editing. Transcription needs no key."}
              </p>
              {proposal && (
                <div className="proposal">
                  <p>{proposal.explanation}</p>
                  <div className="row">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void play(proposal)}
                    >
                      <Play />
                      Preview
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        commit({ notes: proposal.notes, bpm: proposal.bpm });
                        setSelected(null);
                        message("AI changes applied. You can undo them.");
                      }}
                    >
                      <Check />
                      Apply
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        stop();
                        setProposal(null);
                      }}
                    >
                      Discard
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
      <footer className="bottomline">
        <span>
          {sourceName} ·{" "}
          {notes.length
            ? `${((Math.max(...notes.map((n) => n.start + n.duration)) * 60) / bpm).toFixed(1)} sec`
            : "Waiting for a melody"}
        </span>
        <div className="row">
          <button
            disabled={!notes.length || locked}
            onClick={() =>
              download(
                new Blob([JSON.stringify(melody, null, 2)], {
                  type: "application/json",
                }),
                "humnote-project.json",
              )
            }
          >
            Save project
          </button>
          <span>·</span>
          <button disabled={locked} onClick={() => jsonRef.current?.click()}>
            Open project
          </button>
          <span>· Save before refreshing</span>
        </div>
        <input
          hidden
          ref={jsonRef}
          type="file"
          accept=".json,application/json"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              if (f.size > 1000000)
                throw new Error("Project file is too large.");
              const data = validateMelody(JSON.parse(await f.text()));
              commit(data);
              setSelected(null);
              setIsDemo(false);
              setWave([]);
              setUrl("");
              setSourceName(f.name);
              message("Project opened.");
            } catch {
              message(
                "Invalid project. Choose a JSON file saved by this application.",
                true,
              );
            }
          }}
        />
      </footer>
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect an AI model</DialogTitle>
            <DialogDescription>
              Your key stays in page memory until refresh. Requests pass through
              this server to the selected provider. Keys are never included in
              project files.
            </DialogDescription>
          </DialogHeader>
          <div className="settings-fields">
            <label>
              Provider
              <Choice
                label="Model provider"
                value={provider}
                onChange={(v) => {
                  setProvider(v);
                  setModel("");
                }}
                items={[
                  ["openai", "OpenAI"],
                  ["deepseek", "DeepSeek"],
                ]}
              />
            </label>
            <label>
              Model name
              <input
                placeholder="Enter a model ID available to your account"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label>
              API Key
              <input
                type="password"
                placeholder="Paste your provider API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
              />
            </label>
            <p className="muted">
              Use a model that supports Chat Completions and JSON output. Basic
              Pitch transcribes audio; the AI model handles editing
              instructions.
            </p>
            <Button
              onClick={() => {
                setSettings(false);
                message(
                  apiKey && model
                    ? "Model settings saved for this session. The connection will be checked when generating a proposal."
                    : "No model connected. Recording, editing, and MIDI export are still available.",
                );
              }}
            >
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
