export type Note = {
  id: string;
  pitch: number;
  start: number;
  duration: number;
  velocity: number;
};
export type Melody = { notes: Note[]; bpm: number };
export const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));
export const pitchName = (p: number) =>
  ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][p % 12] +
  (Math.floor(p / 12) - 1);
export const demoNotes: Note[] = [60, 64, 67, 69, 67, 64, 62, 60].map(
  (pitch, i) => ({
    id: `demo-${i}`,
    pitch,
    start: i < 4 ? i * 0.75 : 3 + (i - 4),
    duration: i === 7 ? 1.75 : 0.65,
    velocity: 0.75,
  }),
);
export function validateMelody(value: unknown): Melody {
  const v = value as Melody;
  if (
    !v ||
    !Number.isFinite(v.bpm) ||
    v.bpm < 40 ||
    v.bpm > 240 ||
    !Array.isArray(v.notes) ||
    v.notes.length > 512
  )
    throw new Error("Invalid melody format.");
  const notes = v.notes.map((n, i) => {
    if (
      !n ||
      !Number.isInteger(n.pitch) ||
      n.pitch < 21 ||
      n.pitch > 108 ||
      !Number.isFinite(n.start) ||
      n.start < 0 ||
      n.start > 256 ||
      !Number.isFinite(n.duration) ||
      n.duration < 0.0625 ||
      n.duration > 64 ||
      n.start + n.duration > 320 ||
      !Number.isFinite(n.velocity) ||
      n.velocity < 0.01 ||
      n.velocity > 1
    )
      throw new Error("Note data is outside the editable range.");
    return {
      id: `note-${i}`,
      pitch: n.pitch,
      start: n.start,
      duration: n.duration,
      velocity: n.velocity,
    };
  });
  return { bpm: v.bpm, notes: notes.sort((a, b) => a.start - b.start) };
}
export function quantize(notes: Note[], step = 0.25): Note[] {
  return notes.map((n) => ({
    ...n,
    start: Math.round(n.start / step) * step,
    duration: Math.max(step, Math.round(n.duration / step) * step),
  }));
}
