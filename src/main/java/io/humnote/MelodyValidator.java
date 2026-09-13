package io.humnote;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.Comparator;
import org.springframework.stereotype.Component;

@Component
public class MelodyValidator {
    public Melody validate(JsonNode value) {
        if (value == null || !value.isObject()) throw invalid();
        double bpm = number(value, "bpm", 40, 240);
        JsonNode source = value.get("notes");
        if (source == null || !source.isArray() || source.size() > 512) throw invalid();
        var notes = new ArrayList<Note>();
        for (JsonNode n : source) {
            double pitch = number(n, "pitch", 21, 108);
            if (pitch != Math.rint(pitch)) throw invalid();
            double start = number(n, "start", 0, 256);
            double duration = number(n, "duration", 0.0625, 64);
            double velocity = number(n, "velocity", 0.01, 1);
            if (start + duration > 320) throw invalid();
            notes.add(new Note("note-" + notes.size(), (int) pitch, start, duration, velocity));
        }
        notes.sort(Comparator.comparingDouble(Note::start));
        return new Melody(bpm, notes);
    }

    private double number(JsonNode n, String key, double min, double max) {
        JsonNode field = n == null ? null : n.get(key);
        if (field == null || !field.isNumber()) throw invalid();
        double value = field.doubleValue();
        if (!Double.isFinite(value) || value < min || value > max) throw invalid();
        return value;
    }

    private ApiException invalid() {
        return new ApiException(400, "Invalid melody. Check tempo, note count, pitches, timing, and velocity.");
    }
}
