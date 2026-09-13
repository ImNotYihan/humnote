package io.humnote;

import java.io.ByteArrayOutputStream;
import javax.sound.midi.*;
import java.util.ArrayList;
import java.util.Comparator;
import org.springframework.stereotype.Service;

@Service
public class MidiService {
    private record Event(long tick, boolean off, int pitch, int velocity) {}

    public byte[] export(Melody melody, int program) {
        if (program < 0 || program > 127) throw new ApiException(400, "MIDI program must be between 0 and 127.");
        try {
            Sequence sequence = new Sequence(Sequence.PPQ, 480);
            Track track = sequence.createTrack();
            int tempo = (int) Math.round(60_000_000 / melody.bpm());
            byte[] tempoBytes = {(byte)(tempo >> 16), (byte)(tempo >> 8), (byte) tempo};
            track.add(new MidiEvent(new MetaMessage(0x51, tempoBytes, 3), 0));
            track.add(new MidiEvent(new ShortMessage(ShortMessage.PROGRAM_CHANGE, 0, program, 0), 0));
            var events = new ArrayList<Event>();
            for (Note n : melody.notes()) {
                events.add(new Event(Math.round(n.start() * 480), false, n.pitch(), (int)Math.round(n.velocity() * 127)));
                events.add(new Event(Math.round((n.start() + n.duration()) * 480), true, n.pitch(), 0));
            }
            // Note-offs precede note-ons at a shared tick so adjacent repeated notes stay distinct.
            events.sort(Comparator.comparingLong(Event::tick).thenComparing(e -> !e.off()));
            for (Event e : events) {
                var message = new ShortMessage(e.off() ? ShortMessage.NOTE_OFF : ShortMessage.NOTE_ON, 0, e.pitch(), e.velocity());
                track.add(new MidiEvent(message, e.tick()));
            }
            var output = new ByteArrayOutputStream();
            MidiSystem.write(sequence, 0, output);
            return output.toByteArray();
        } catch (InvalidMidiDataException | java.io.IOException e) {
            throw new ApiException(500, "Unable to encode MIDI.");
        }
    }
}
