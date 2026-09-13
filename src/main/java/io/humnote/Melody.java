package io.humnote;

import java.util.List;

public record Melody(double bpm, List<Note> notes) {
    public Melody { notes = List.copyOf(notes); }
}
