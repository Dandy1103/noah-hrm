package com.noah.hrm;

import java.net.URI;
import java.util.Locale;
import org.springframework.web.util.UriUtils;

import static java.nio.charset.StandardCharsets.UTF_8;

final class LoginDestination {
    private LoginDestination() {}

    static String resolve(String value) {
        if (value == null || value.length() > 2000 || !value.startsWith("/") || value.startsWith("//")) return "/";
        try {
            URI uri = URI.create(value);
            String rawPath = uri.getRawPath();
            String path = uri.getPath();
            if (uri.getRawAuthority() != null || uri.getRawFragment() != null || path == null
                    || rawPath.toLowerCase(Locale.ROOT).matches(".*%(?:2f|5c|25).*")
                    || path.contains("\\") || path.chars().anyMatch(Character::isISOControl)) return "/";
            for (String segment : path.split("/")) {
                if (segment.equals(".") || segment.equals("..")) return "/";
            }
            String first = path.substring(1).split("[/;]", 2)[0];
            if (first.equals("auth") || first.equals("api") || first.equals("login") || first.equals("healthz")) return "/";
            return value;
        } catch (IllegalArgumentException error) {
            return "/";
        }
    }

    static String keep(String destination) {
        return "/".equals(destination) ? "" : "&next=" + encoded(destination);
    }

    private static String encoded(String destination) {
        return UriUtils.encode(destination, UTF_8);
    }
}
