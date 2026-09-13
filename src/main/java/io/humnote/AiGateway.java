package io.humnote;

import java.net.URI;

/** Narrow transport boundary, allowing provider responses to be tested without real credentials. */
public interface AiGateway {
    record Reply(int status, String body) {}
    Reply complete(URI endpoint, String apiKey, String payload);
}
