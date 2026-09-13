package io.humnote;

import com.fasterxml.jackson.databind.*;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.Map;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class ApiController {
    private final ObjectMapper json;
    private final MelodyValidator validator;
    private final MidiService midi;
    private final ArrangeService arranger;
    public ApiController(ObjectMapper json, MelodyValidator validator, MidiService midi, ArrangeService arranger) {
        this.json = json; this.validator = validator; this.midi = midi; this.arranger = arranger;
    }

    @GetMapping("/health") public Map<String, String> health() { return Map.of("status", "ok"); }

    @PostMapping(value = "/arrange", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ArrangeService.Proposal arrange(HttpServletRequest request) throws IOException {
        return arranger.arrange(read(request));
    }

    @PostMapping(value = "/melody/validate", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Melody validate(HttpServletRequest request) throws IOException { return validator.validate(read(request)); }

    @PostMapping(value = "/midi", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<byte[]> export(HttpServletRequest request) throws IOException {
        JsonNode body = read(request);
        Melody melody = validator.validate(body.get("melody"));
        JsonNode field = body.get("program");
        int program = 0;
        if (field != null) {
            if (!field.isIntegralNumber() || !field.canConvertToInt()) throw new ApiException(400, "Invalid MIDI program.");
            program = field.intValue();
        }
        return ResponseEntity.ok().contentType(MediaType.parseMediaType("audio/midi"))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"humnote.mid\"")
                .body(midi.export(melody, program));
    }

    private JsonNode read(HttpServletRequest request) throws IOException {
        byte[] bytes = request.getInputStream().readNBytes(100_001);
        if (bytes.length > 100_000) throw new ApiException(413, "Request exceeds 100 KB.");
        try {
            JsonNode value = json.reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(bytes);
            if (value == null || !value.isObject()) throw new ApiException(400, "Expected a JSON object.");
            return value;
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new ApiException(400, "Invalid JSON request.");
        }
    }
}
