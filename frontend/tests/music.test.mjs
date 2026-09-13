import test from "node:test";
import assert from "node:assert/strict";
import { quantize, validateMelody, demoNotes } from "../lib/music/core.ts";
test("quantization retains nonzero durations and never mutates original", () => {
  const input = [
    { id: "1", pitch: 60, start: 0.13, duration: 0.08, velocity: 0.5 },
  ];
  const out = quantize(input);
  assert.equal(out[0].start, 0.25);
  assert.equal(out[0].duration, 0.25);
  assert.equal(input[0].start, 0.13);
});
test("untrusted model/project data rejects malformed and oversized results", () => {
  for (const bad of [
    null,
    { bpm: 0, notes: [] },
    { bpm: 100, notes: [{ pitch: 200, start: 0, duration: 1, velocity: 0.5 }] },
    {
      bpm: 100,
      notes: [{ pitch: 60, start: NaN, duration: 1, velocity: 0.5 }],
    },
    { bpm: 100, notes: Array(513).fill(demoNotes[0]) },
  ])
    assert.throws(() => validateMelody(bad));
  assert.equal(validateMelody({ bpm: 100, notes: demoNotes }).notes.length, 8);
});
