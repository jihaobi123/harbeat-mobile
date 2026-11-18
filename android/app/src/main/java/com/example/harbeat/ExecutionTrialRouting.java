package com.example.harbeat;

import java.util.regex.Pattern;

/** Route only the existing execution protocol to the USB-only trial. */
final class ExecutionTrialRouting {
    private static final String USB_ORIGIN = "http://127.0.0.1:18796";
    private static final Pattern ROUTES = Pattern.compile(
        "/listen/(?:execution/(?:index\\.json|tracks/[A-Za-z0-9_-]{1,160}\\.json|profiles/[a-f0-9]{64}\\.json)"
        + "|execution-media/[a-f0-9]{64}\\.(?:flac|wav)|smart-api/plans(?:/[a-f0-9]{64})?)"
    );

    static String origin(boolean enabled, String cloud, String path) {
        return enabled && ROUTES.matcher(path).matches() ? USB_ORIGIN : cloud;
    }
}
