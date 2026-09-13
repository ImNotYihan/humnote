package io.humnote;

/** Time values are quarter-note beats, never seconds. */
public record Note(String id, int pitch, double start, double duration, double velocity) {}
