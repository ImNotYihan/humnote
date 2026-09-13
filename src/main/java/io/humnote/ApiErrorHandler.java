package io.humnote;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestControllerAdvice
public class ApiErrorHandler {
    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String, String>> handle(ApiException error) {
        return ResponseEntity.status(error.status()).body(Map.of("error", error.getMessage()));
    }
}
