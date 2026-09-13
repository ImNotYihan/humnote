package io.humnote;

import com.fasterxml.jackson.databind.*;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ArrangeServiceTest {
    private final ObjectMapper json = new ObjectMapper();
    private JsonNode request() throws Exception {
        return json.readTree("{\"melody\":" + MusicTest.MELODY + ",\"instruction\":\"Transpose up\",\"provider\":\"openai\",\"model\":\"test-model\",\"apiKey\":\"test-key-not-real\"}");
    }
    private ArrangeService service(AiGateway gateway) { return new ArrangeService(json, new MelodyValidator(), gateway); }
    private String envelope(String melody) throws Exception {
        return json.writeValueAsString(Map.of("choices", new Object[]{Map.of("message", Map.of("content", melody))}));
    }
    @Test void sendsOnlyExpectedDataToFixedProviderAndValidatesResult() throws Exception {
        String reply = envelope(MusicTest.MELODY);
        var service = service((endpoint, key, payload) -> {
            assertEquals("https://api.openai.com/v1/chat/completions", endpoint.toString());
            assertEquals("test-key-not-real", key);
            assertFalse(payload.contains(key));
            assertTrue(payload.contains("English"));
            assertTrue(payload.contains("quarter-note beats"));
            return new AiGateway.Reply(200, reply);
        });
        assertEquals(2, service.arrange(request()).notes().size());
    }
    @Test void rejectsUnknownProviderWithoutSendingCredentials() throws Exception {
        var request = (com.fasterxml.jackson.databind.node.ObjectNode)request();
        request.put("provider", "https://untrusted.example");
        var service = service((a,b,c) -> { fail("Must not call unknown provider"); return null; });
        assertEquals(400, assertThrows(ApiException.class, () -> service.arrange(request)).status());
    }
    @Test void sanitizesProviderErrorsAndMalformedResponses() throws Exception {
        for (int status : new int[]{401, 403, 429, 500, 302}) {
            var service = service((a,b,c) -> new AiGateway.Reply(status, "secret-provider-body"));
            ApiException error = assertThrows(ApiException.class, () -> service.arrange(request()));
            assertEquals(502, error.status()); assertFalse(error.getMessage().contains("secret"));
        }
        for (String body : new String[]{"not-json", "null", "{}", envelope("{}"), envelope("{\"bpm\":100,\"notes\":[]}")}) {
            var service = service((a,b,c) -> new AiGateway.Reply(200, body));
            assertEquals(502, assertThrows(ApiException.class, () -> service.arrange(request())).status());
        }
    }
    @Test void propagatesSafeTimeoutAndBoundsExplanation() throws Exception {
        var timeout = service((a,b,c) -> { throw new ApiException(504, "The model timed out."); });
        assertEquals(504, assertThrows(ApiException.class, () -> timeout.arrange(request())).status());
        var result = (com.fasterxml.jackson.databind.node.ObjectNode)json.readTree(MusicTest.MELODY);
        result.put("explanation", "x".repeat(900));
        String body = envelope(result.toString());
        assertEquals(600, service((a,b,c) -> new AiGateway.Reply(200, body)).arrange(request()).explanation().length());
    }
}
