package io.humnote;

/** A safe message that may be shown to the client. Never include upstream bodies or keys. */
public final class ApiException extends RuntimeException {
    private final int status;
    public ApiException(int status, String message) { super(message); this.status = status; }
    public int status() { return status; }
}
