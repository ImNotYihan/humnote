package io.humnote;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class ApiRequestFilter extends OncePerRequestFilter {
    private final Set<String> allowedOrigins;
    public ApiRequestFilter(@Value("${humnote.allowed-origins:}") String origins) {
        allowedOrigins = Arrays.stream(origins.split(",")).map(String::trim).filter(s -> !s.isEmpty()).collect(Collectors.toSet());
    }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Referrer-Policy", "same-origin");
        if (request.getRequestURI().startsWith("/api/")) {
            response.setHeader("Cache-Control", "no-store");
            String origin = request.getHeader("Origin");
            String sameOrigin = request.getScheme() + "://" + request.getServerName();
            int port = request.getServerPort();
            if (!(request.isSecure() ? port == 443 : port == 80)) sameOrigin += ":" + port;
            if (origin != null && !origin.equals(sameOrigin) && !allowedOrigins.contains(origin)) {
                reject(response, 403, "Request origin is not allowed."); return;
            }
            if (request.getContentLengthLong() > 100_000) {
                reject(response, 413, "Request exceeds 100 KB."); return;
            }
        }
        chain.doFilter(request, response);
    }
    private void reject(HttpServletResponse response, int status, String message) throws IOException {
        response.setStatus(status); response.setContentType("application/json");
        response.getWriter().write("{\"error\":\"" + message + "\"}");
    }
}
