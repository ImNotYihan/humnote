import type { Note } from "./core";
let context: AudioContext | undefined;
let active: OscillatorNode[] = [];
export async function audioContext() {
  context ??= new AudioContext();
  await context.resume();
  return context;
}
export function stopAudio() {
  for (const o of active) {
    try {
      o.stop();
    } catch {}
  }
  active = [];
}
export async function playNotes(
  notes: Note[],
  bpm: number,
  voice: string,
): Promise<number> {
  stopAudio();
  const ctx = await audioContext();
  const zero = ctx.currentTime + 0.06;
  const master = ctx.createGain();
  master.gain.value = 0.22;
  master.connect(ctx.destination);
  for (const n of notes) {
    const start = zero + (n.start * 60) / bpm,
      duration = (n.duration * 60) / bpm;
    const osc = ctx.createOscillator(),
      gain = ctx.createGain();
    osc.type =
      voice === "synth" ? "sawtooth" : voice === "bell" ? "sine" : "triangle";
    osc.frequency.value = 440 * 2 ** ((n.pitch - 69) / 12);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(n.velocity, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.02, n.velocity * 0.3),
      start + Math.max(0.02, duration * 0.8),
    );
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration + 0.12);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.15);
    active.push(osc);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
      active = active.filter((x) => x !== osc);
    };
  }
  const end = Math.max(
    0,
    ...notes.map((n) => ((n.start + n.duration) * 60) / bpm),
  );
  setTimeout(() => master.disconnect(), (end + 0.4) * 1000);
  return zero;
}
export async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  if (blob.size > 30 * 1024 * 1024)
    throw new Error("Please use an audio file smaller than 30 MB.");
  const ctx = await audioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new Error("Cannot decode this file. Try WAV, MP3, or M4A.");
  }
  if (decoded.duration > 30.2)
    throw new Error(
      "Recordings must be 30 seconds or shorter. Trim the audio first.",
    );
  if (decoded.duration < 0.3)
    throw new Error("Recording is too short. Hum for at least one second.");
  const off = new OfflineAudioContext(
    1,
    Math.ceil(decoded.duration * 22050),
    22050,
  );
  const source = off.createBufferSource();
  source.buffer = decoded;
  source.connect(off.destination);
  source.start();
  return off.startRendering();
}
export function waveform(buffer: AudioBuffer): number[] {
  const data = buffer.getChannelData(0);
  return Array.from({ length: 100 }, (_, i) => {
    let peak = 0;
    const start = Math.floor((i * data.length) / 100),
      end = Math.floor(((i + 1) * data.length) / 100);
    for (let j = start; j < end; j++) peak = Math.max(peak, Math.abs(data[j]));
    return peak;
  });
}
export async function transcribe(
  buffer: AudioBuffer,
  bpm: number,
  progress: (v: number) => void,
): Promise<Note[]> {
  const { BasicPitch, outputToNotesPoly, noteFramesToTime } =
    await import("@spotify/basic-pitch");
  const tf = await import("@tensorflow/tfjs");
  await tf.ready();
  tf.engine().startScope();
  const model = new BasicPitch("/model/model.json");
  const frames: number[][] = [],
    onsets: number[][] = [];
  try {
    await model.evaluateModel(
      buffer,
      (f, o) => {
        frames.push(...f);
        onsets.push(...o);
      },
      progress,
    );
    const detected = noteFramesToTime(
      outputToNotesPoly(frames, onsets, 0.35, 0.25, 8),
    );
    const candidates = detected
      .filter(
        (n) =>
          n.pitchMidi >= 36 &&
          n.pitchMidi <= 96 &&
          n.durationSeconds >= 0.09 &&
          n.amplitude >= 0.12,
      )
      .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
    if (!candidates.length)
      throw new Error(
        "No clear melody detected. Move closer to the microphone and separate each note with la or da.",
      );
    if (candidates.length > 512)
      throw new Error(
        "Too many notes. Try a shorter recording with less background noise.",
      );
    const offset = candidates[0].startTimeSeconds;
    return candidates.map((n, i) => ({
      id: `rec-${i}`,
      pitch: n.pitchMidi,
      start: Math.max(0, ((n.startTimeSeconds - offset) * bpm) / 60),
      duration: Math.max(0.0625, (n.durationSeconds * bpm) / 60),
      velocity: Math.max(0.15, Math.min(1, n.amplitude)),
    }));
  } finally {
    try {
      (await model.model).dispose();
    } catch {}
    tf.engine().endScope();
  }
}
