package io.humnote;

import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.*;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ApiTest {
    private MockMvc mvc;
    @BeforeEach void setup() {
        ObjectMapper json = new ObjectMapper();
        MelodyValidator validator = new MelodyValidator();
        AiGateway gateway = (endpoint, key, payload) -> { throw new AssertionError("Invalid requests must not reach a provider"); };
        mvc = MockMvcBuilders.standaloneSetup(new ApiController(json, validator, new MidiService(), new ArrangeService(json, validator, gateway)))
                .setControllerAdvice(new ApiErrorHandler()).addFilters(new ApiRequestFilter("")).build();
    }

    @Test void healthAndValidation() throws Exception {
        mvc.perform(get("/api/health")).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ok"));
        mvc.perform(post("/api/melody/validate").contentType(MediaType.APPLICATION_JSON).content(MusicTest.MELODY))
                .andExpect(status().isOk()).andExpect(jsonPath("$.notes.length()").value(2))
                .andExpect(header().string("Cache-Control", "no-store"));
    }
    @Test void blocksCrossOriginAndOversizeBodies() throws Exception {
        mvc.perform(post("/api/arrange").header("Origin", "https://untrusted.example").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/arrange").contentType(MediaType.APPLICATION_JSON).content(" ".repeat(100001)))
                .andExpect(status().isPayloadTooLarge());
    }
    @Test void rejectsMalformedTrailingAndMissingData() throws Exception {
        for (String body : new String[]{"{", "{} {}", "null", "[]", "{}"})
            mvc.perform(post("/api/arrange").contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").isString());
    }
    @Test void servesMidiAttachmentAndRejectsBadProgram() throws Exception {
        mvc.perform(post("/api/midi").contentType(MediaType.APPLICATION_JSON).content("{\"melody\":" + MusicTest.MELODY + ",\"program\":80}"))
                .andExpect(status().isOk()).andExpect(content().contentType("audio/midi"))
                .andExpect(header().string("Content-Disposition", "attachment; filename=\"humnote.mid\""));
        mvc.perform(post("/api/midi").contentType(MediaType.APPLICATION_JSON).content("{\"melody\":" + MusicTest.MELODY + ",\"program\":1.5}"))
                .andExpect(status().isBadRequest());
    }
}
