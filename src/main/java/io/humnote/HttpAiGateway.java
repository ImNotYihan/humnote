package io.humnote;

import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.concurrent.*;
import org.springframework.stereotype.Component;

@Component
public class HttpAiGateway implements AiGateway {
    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER).build();

    public Reply complete(URI endpoint, String apiKey, String payload) {
        HttpRequest request = HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(60))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(payload)).build();
        var future = client.sendAsync(request, HttpResponse.BodyHandlers.ofString());
        try {
            var response = future.get(60, TimeUnit.SECONDS);
            return new Reply(response.statusCode(), response.body());
        } catch (TimeoutException e) {
            future.cancel(true);
            throw new ApiException(504, "The model timed out. Please try again.");
        } catch (InterruptedException e) {
            future.cancel(true);
            Thread.currentThread().interrupt();
            throw new ApiException(503, "The request was interrupted. Please try again.");
        } catch (ExecutionException e) {
            if (e.getCause() instanceof HttpTimeoutException)
                throw new ApiException(504, "The model timed out. Please try again.");
            throw new ApiException(502, "Unable to reach the model provider.");
        }
    }
}
