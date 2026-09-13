import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const tf = require("@tensorflow/tfjs");
const {
  BasicPitch,
  outputToNotesPoly,
  noteFramesToTime,
} = require("@spotify/basic-pitch");
await tf.setBackend("cpu");
await tf.ready();
const json = JSON.parse(readFileSync("public/model/model.json", "utf8"));
const weights = json.weightsManifest.flatMap((g) => g.weights);
const buffers = json.weightsManifest.flatMap((g) =>
  g.paths.map((p) => readFileSync("public/model/" + p)),
);
const data = Buffer.concat(buffers);
const graph = await tf.loadGraphModel(
  tf.io.fromMemory({
    modelTopology: json.modelTopology,
    weightSpecs: weights,
    weightData: data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ),
  }),
);
const bp = new BasicPitch(Promise.resolve(graph));
const samples = new Float32Array(22050 * 3);
const pitches = [60, 64, 67];
for (let i = 0; i < samples.length; i++) {
  const t = i / 22050,
    index = Math.floor(t),
    phase = t - index;
  if (phase < 0.08 || phase > 0.85) continue;
  const f = 440 * 2 ** ((pitches[index] - 69) / 12);
  const env = Math.min(1, (phase - 0.08) * 30, (0.85 - phase) * 30);
  samples[i] =
    env *
    (0.35 * Math.sin(2 * Math.PI * f * t) +
      0.12 * Math.sin(4 * Math.PI * f * t) +
      0.05 * Math.sin(6 * Math.PI * f * t));
}
let frames = [],
  onsets = [];
tf.engine().startScope();
await bp.evaluateModel(
  samples,
  (f, o) => {
    frames.push(...f);
    onsets.push(...o);
  },
  () => {},
);
const notes = noteFramesToTime(
  outputToNotesPoly(frames, onsets, 0.35, 0.25, 8),
);
console.log(
  "Synthetic audio detected pitches:",
  notes.map((n) => n.pitchMidi),
);
for (const pitch of pitches)
  assert.ok(
    notes.some((n) => n.pitchMidi === pitch && n.durationSeconds > 0.3),
    "Missing expected pitch " + pitch,
  );
frames = [];
onsets = [];
await bp.evaluateModel(
  new Float32Array(22050),
  (f, o) => {
    frames.push(...f);
    onsets.push(...o);
  },
  () => {},
);
assert.equal(
  outputToNotesPoly(frames, onsets, 0.35, 0.25, 8).length,
  0,
  "Silence should not create notes",
);
tf.engine().endScope();
graph.dispose();
console.log("PASS: real Basic Pitch inference on synthetic melody and silence");
