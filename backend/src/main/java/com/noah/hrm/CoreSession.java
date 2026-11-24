package com.noah.hrm;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
class CoreSession extends OncePerRequestFilter {
    private final HrmIdentity identity;
    private final RestClient http;
    private final String coreUrl;

    CoreSession(HrmIdentity identity, RestClient http, @Value("${CORE_URL:}") String coreUrl) {
        this.identity = identity;
        this.http = http;
        this.coreUrl = coreUrl.endsWith("/") ? coreUrl.substring(0, coreUrl.length() - 1) : coreUrl;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        adopt(request);
        chain.doFilter(request, response);
    }

    private void adopt(HttpServletRequest request) {
        if (coreUrl.isBlank() || identity.user(request) != null) return;
        String cookie = request.getHeader(HttpHeaders.COOKIE);
        if (cookie == null || !cookie.contains("noah-core.sid=")) return;
        try {
            JsonNode body = http.get().uri(coreUrl + "/api/session").header(HttpHeaders.COOKIE, cookie)
                    .retrieve().body(JsonNode.class);
            if (body == null) return;
            identity.adopt(request, body.path("displayName").asText(""), body.path("issuer").asText(""),
                    body.path("subject").asText(""));
        } catch (RestClientException error) {
            return;
        }
    }
}
