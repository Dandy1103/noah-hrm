package com.noah.hrm;

import java.net.URI;
import java.nio.file.Path;
import java.util.Locale;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
final class HrmSettings {
    static final String CALLBACK = "/auth/callback";

    final URI origin;
    final URI issuer;
    final String clientId;
    final String clientSecret;
    final String databaseUrl;
    final String hrmAdminSubject;
    final String managementClientId;
    final String managementClientSecret;
    final Path browserDirectory;

    HrmSettings(Environment environment) {
        origin = URI.create(environment.getProperty("APP_ORIGIN", "http://localhost:3001"));
        String issuerValue = environment.getProperty("OIDC_ISSUER_URL", "").strip();
        issuer = issuerValue.isBlank() ? null : URI.create(issuerValue);
        clientId = environment.getProperty("OIDC_CLIENT_ID", "");
        clientSecret = environment.getProperty("OIDC_CLIENT_SECRET", "");
        databaseUrl = environment.getProperty("DATABASE_URL", "");
        hrmAdminSubject = environment.getProperty("HRM_ADMIN_SUBJECT", "");
        managementClientId = environment.getProperty("HRM_KEYCLOAK_CLIENT_ID", "");
        managementClientSecret = environment.getProperty("HRM_KEYCLOAK_CLIENT_SECRET", "");
        browserDirectory = Path.of(environment.getProperty("HRM_BROWSER_DIRECTORY", "dist/noah-hrm/browser"))
                .toAbsolutePath().normalize();

        boolean local = "http".equals(origin.getScheme()) && "localhost".equalsIgnoreCase(origin.getHost());
        if (origin.getHost() == null || origin.getRawUserInfo() != null || origin.getRawFragment() != null
                || origin.getRawQuery() != null || !origin.getPath().matches("/?") || (!secure() && !local)) {
            throw new IllegalArgumentException("APP_ORIGIN must be an HTTPS origin or a local localhost origin.");
        }
        if (issuer != null && (issuer.getHost() == null || issuer.getRawUserInfo() != null
                || issuer.getRawQuery() != null || issuer.getRawFragment() != null
                || (!"https".equals(issuer.getScheme())
                && !(local && "http".equals(issuer.getScheme()) && "localhost".equalsIgnoreCase(issuer.getHost()))))) {
            throw new IllegalArgumentException("OIDC_ISSUER_URL must use HTTPS outside local development.");
        }
    }

    boolean secure() {
        return "https".equals(origin.getScheme());
    }

    String cookieName() {
        return secure() ? "__Host-noah.hrm.sid" : "noah.hrm.sid";
    }

    String originValue() {
        return origin.getScheme() + "://" + origin.getAuthority().toLowerCase(Locale.ROOT);
    }

    boolean ssoConfigured() {
        return issuer != null && !clientId.isBlank() && !clientSecret.isBlank();
    }
}
