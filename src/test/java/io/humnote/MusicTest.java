package io.humnote;

import com.fasterxml.jackson.databind.*;
import java.io.ByteArrayInputStream;
import java.util.*;
import javax.sound.midi.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import static org.junit.jupiter.api.Assertions.*;

class MusicTest {
    private final ObjectMapper json = new ObjectMapper();
    private final MelodyValidator validator = new MelodyValidator();
    static final String MELODY = """
            {"bpm":100,"notes":[{"pitch":60,"start":0,"duration":1,"velocity":0.75},
            {"pitch":60,"start":1,"duration":1.5,"velocity":0.5}]}
            """;

    @Test void midiPreservesTempoTimingVelocityAndProgram() throws Exception {
        byte[] bytes = new MidiService().export(validator.validate(json.readTree(MELODY)), 10);
        var input = new ByteArrayInputStream(bytes);
        assertEquals(0, MidiSystem.getMidiFileFormat(input).getType());
        Sequence sequence = MidiSystem.getSequence(new ByteArrayInputStream(bytes));
        assertEquals(480, sequence.getResolution());
        assertEquals(1, sequence.getTracks().length);
        Track track = sequence.getTracks()[0];
        var events = new ArrayList<String>();
        for (int i = 0; i < track.size(); i++) {
            MidiEvent e = track.get(i);
            if (e.getMessage() instanceof MetaMessage m && m.getType() == 0x51)
                assertArrayEquals(new byte[]{9, 39, (byte)192}, m.getData());
            if (e.getMessage() instanceof ShortMessage m) {
                if (m.getCommand() == ShortMessage.PROGRAM_CHANGE) assertEquals(10, m.getData1());
                else events.add(e.getTick() + ":" + m.getCommand() + ":" + m.getData1() + ":" + m.getData2());
            }
        }
        assertEquals(List.of("0:144:60:95", "480:128:60:0", "480:144:60:64", "1200:128:60:0"), events);
    }

    @ParameterizedTest @ValueSource(strings = {
        "null", "{}", "{\"bpm\":39,\"notes\":[]}", "{\"bpm\":241,\"notes\":[]}",
        "{\"bpm\":\"100\",\"notes\":[]}", "{\"bpm\":100,\"notes\":null}"
    }) void rejectsMalformedMelodies(String input) throws Exception {
        assertThrows(ApiException.class, () -> validator.validate(json.readTree(input)));
    }

    @Test void rejectsOutOfBoundsFractionalAndMissingFields() throws Exception {
        for (var entry : Map.of("pitch", 108.5, "start", -1.0, "duration", 0.01, "velocity", 1.01).entrySet()) {
            var value = json.readTree(MELODY);
            ((com.fasterxml.jackson.databind.node.ObjectNode)value.get("notes").get(0)).put(entry.getKey(), entry.getValue());
            assertThrows(ApiException.class, () -> validator.validate(value));
        }
        var missing = json.readTree(MELODY);
        ((com.fasterxml.jackson.databind.node.ObjectNode)missing.get("notes").get(0)).remove("duration");
        assertThrows(ApiException.class, () -> validator.validate(missing));
    }

    @Test void limitsNoteCountAndSortsWithoutTrustingIds() throws Exception {
        var value = json.readTree(MELODY);
        var notes = (com.fasterxml.jackson.databind.node.ArrayNode)value.get("notes");
        JsonNode note = notes.get(0).deepCopy();
        for (int i = 2; i < 513; i++) notes.add(note);
        assertThrows(ApiException.class, () -> validator.validate(value));
        notes.removeAll(); notes.add(json.readTree(MELODY).get("notes").get(1)); notes.add(note);
        Melody melody = validator.validate(value);
        assertEquals(0, melody.notes().get(0).start());
        assertEquals("note-1", melody.notes().get(0).id());
        assertThrows(UnsupportedOperationException.class, () -> melody.notes().clear());
    }

    @Test void permitsBoundaryValuesAndRejectsBadProgram() throws Exception {
        Melody edge = validator.validate(json.readTree("""
                {"bpm":240,"notes":[{"pitch":108,"start":256,"duration":64,"velocity":1}]}
                """));
        assertEquals(320, edge.notes().get(0).start()+edge.notes().get(0).duration());
        assertThrows(ApiException.class, () -> new MidiService().export(edge, 128));
    }
}
