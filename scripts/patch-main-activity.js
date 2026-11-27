// Genera las clases Java de Android:
//  - MapsLinkResolver: resuelve enlaces de Google Maps (incluidos los cortos)
//  - MapsLinkPlugin: puente JS -> nativo para resolver enlaces desde la app
//  - MainActivity: recibe ACTION_SEND (compartir) y ACTION_VIEW (abrir enlace)
const fs = require('fs');
const path = require('path');

const javaDir = path.join(
  __dirname, '..', 'android', 'app', 'src', 'main', 'java', 'com', 'aguarutas', 'app'
);

if (!fs.existsSync(javaDir)) {
  console.error('❌ No se encontró la carpeta Java de la app:');
  console.error('   ' + javaDir);
  console.error('   Ejecuta `npx cap add android` primero.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// MapsLinkResolver.java
// ---------------------------------------------------------------------------
const resolverCode = String.raw`package com.aguarutas.app;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Resuelve enlaces de Google Maps y extrae coordenadas.
 * No usa ninguna API key: sigue redirecciones y lee los metadatos del HTML.
 */
public final class MapsLinkResolver {

    public static class Result {
        public String originalUrl;
        public String finalUrl;
        public Double lat;
        public Double lng;
        public String error;
        public String debug;
    }

    private static final String MOBILE_UA =
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

    private static final Pattern URL_PATTERN =
        Pattern.compile("https?://[^\\s\"'<>]+", Pattern.CASE_INSENSITIVE);

    private static final Pattern GEO_PATTERN =
        Pattern.compile("geo:\\s*-?\\d+(?:\\.\\d+)?\\s*,\\s*-?\\d+(?:\\.\\d+)?", Pattern.CASE_INSENSITIVE);

    private MapsLinkResolver() {}

    public static boolean isMapsUrl(String raw) {
        if (raw == null) return false;
        String url = raw.trim();
        if (url.toLowerCase().startsWith("geo:")) return true;
        try {
            URL u = new URL(url);
            String host = u.getHost() == null ? "" : u.getHost().toLowerCase();
            String path = u.getPath() == null ? "" : u.getPath();
            if (host.equals("maps.app.goo.gl")) return true;
            if (host.equals("goo.gl") && path.startsWith("/maps")) return true;
            if (host.equals("maps.google.com") || host.startsWith("maps.google.")) return true;
            if (host.equals("google.com") || host.startsWith("www.google.") || host.matches("google\\.[a-z.]+")) {
                return path.startsWith("/maps");
            }
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    public static String firstMapsUrl(String text) {
        if (text == null) return null;
        Matcher m = URL_PATTERN.matcher(text);
        while (m.find()) {
            String candidate = trimTrailing(m.group());
            if (isMapsUrl(candidate)) return candidate;
        }
        Matcher g = GEO_PATTERN.matcher(text);
        if (g.find()) return g.group();
        return null;
    }

    private static String trimTrailing(String url) {
        if (url == null) return null;
        return url.replaceAll("[)\\]},.;!?]+$", "");
    }

    public static Result resolve(String rawUrl) {
        Result result = new Result();
        result.originalUrl = rawUrl == null ? "" : rawUrl.trim();
        result.finalUrl = result.originalUrl;

        double[] direct = extractCoords(result.originalUrl);
        if (direct != null) {
            result.lat = direct[0];
            result.lng = direct[1];
            result.debug = "coordenadas encontradas en el enlace";
            return result;
        }

        if (!result.originalUrl.toLowerCase().startsWith("http")) {
            result.error = "El enlace no es una URL de Google Maps";
            return result;
        }

        HttpURLConnection conn = null;
        try {
            URL current = new URL(result.originalUrl);
            for (int i = 0; i < 8; i++) {
                conn = (HttpURLConnection) current.openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(12000);
                conn.setReadTimeout(12000);
                conn.setRequestMethod("GET");
                conn.setRequestProperty("User-Agent", MOBILE_UA);
                conn.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
                conn.setRequestProperty("Accept-Language", "es-MX,es;q=0.9,en;q=0.8");
                conn.setRequestProperty("Accept-Encoding", "identity");

                int code = conn.getResponseCode();
                if (code >= 300 && code < 400) {
                    String location = conn.getHeaderField("Location");
                    conn.disconnect();
                    conn = null;
                    if (location == null) break;
                    current = new URL(current, location);
                    result.finalUrl = current.toString();
                    double[] redirected = extractCoords(result.finalUrl);
                    if (redirected != null) {
                        result.lat = redirected[0];
                        result.lng = redirected[1];
                        result.debug = "coordenadas tras redirección";
                        return result;
                    }
                    continue;
                }

                result.finalUrl = current.toString();
                InputStream is = conn.getInputStream();
                String html = readLimited(is, 1500000);
                conn.disconnect();
                conn = null;

                double[] c = extractCoords(result.finalUrl);
                if (c != null) {
                    result.lat = c[0];
                    result.lng = c[1];
                    result.debug = "coordenadas en la URL final";
                    return result;
                }

                c = extractCoordsFromHtml(html);
                if (c != null) {
                    result.lat = c[0];
                    result.lng = c[1];
                    result.debug = "coordenadas en el HTML de Maps";
                    return result;
                }

                String canonical = extractCanonical(html);
                if (canonical != null) {
                    c = extractCoords(canonical);
                    if (c != null) {
                        result.finalUrl = canonical;
                        result.lat = c[0];
                        result.lng = c[1];
                        result.debug = "coordenadas en el canonical";
                        return result;
                    }
                }

                result.error = "Google Maps no devolvió coordenadas. Abre el enlace en Maps y compártelo otra vez.";
                return result;
            }
            result.error = "Demasiadas redirecciones al abrir el enlace";
            return result;
        } catch (Exception e) {
            result.error = "No se pudo abrir el enlace: " + e.getMessage();
            return result;
        } finally {
            if (conn != null) {
                try { conn.disconnect(); } catch (Exception ignored) {}
            }
        }
    }

    private static String readLimited(InputStream is, int maxChars) throws Exception {
        BufferedReader br = new BufferedReader(new InputStreamReader(is, "UTF-8"));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) {
            sb.append(line).append('\n');
            if (sb.length() >= maxChars) break;
        }
        br.close();
        return sb.toString();
    }

    private static String extractCanonical(String html) {
        if (html == null) return null;
        String[] patterns = new String[]{
            "<meta[^>]+(?:property|name)=[\"']og:url[\"'][^>]+content=[\"']([^\"']+)[\"']",
            "<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+(?:property|name)=[\"']og:url[\"']",
            "<link[^>]+rel=[\"']canonical[\"'][^>]+href=[\"']([^\"']+)[\"']",
            "<link[^>]+href=[\"']([^\"']+)[\"'][^>]+rel=[\"']canonical[\"']"
        };
        for (String p : patterns) {
            try {
                Matcher m = Pattern.compile(p, Pattern.CASE_INSENSITIVE).matcher(html);
                if (m.find()) return m.group(1).replace("&amp;", "&");
            } catch (Exception ignored) {}
        }
        return null;
    }

    public static double[] extractCoords(String text) {
        if (text == null || text.isEmpty()) return null;
        String decoded = safeDecode(text);
        String[] sources = decoded.equals(text) ? new String[]{text} : new String[]{decoded, text};
        for (String s : sources) {
            double[] c;
            c = match(s, "geo:\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)", 1, 2, false);
            if (c != null) return c;
            c = match(s, "[?&](?:q|query|destination|ll|center|sll|daddr|saddr)=(-?\\d+(?:\\.\\d+)?)\\s*(?:%2C|,)\\s*(-?\\d+(?:\\.\\d+)?)", 1, 2, false);
            if (c != null) return c;
            c = match(s, "!3d(-?\\d+(?:\\.\\d+)?)!4d(-?\\d+(?:\\.\\d+)?)", 1, 2, false);
            if (c != null) return c;
            c = match(s, "/maps/(?:place|search|dir)/(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)", 1, 2, false);
            if (c != null) return c;
            c = match(s, "@(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)", 1, 2, false);
            if (c != null) return c;
            c = match(s, "!2d(-?\\d+(?:\\.\\d+)?)!3d(-?\\d+(?:\\.\\d+)?)", 1, 2, true);
            if (c != null) return c;
            c = match(s, "[?&]lat=(-?\\d+(?:\\.\\d+)?)[^&]*&(?:lon|lng)=(-?\\d+(?:\\.\\d+)?)", 1, 2, false);
            if (c != null) return c;
            c = match(s, "(?<![\\d.])(-?\\d{1,2}\\.\\d{3,})\\s*,\\s*(-?\\d{1,3}\\.\\d{3,})(?![\\d.])", 1, 2, false);
            if (c != null) return c;
        }
        return null;
    }

    private static double[] extractCoordsFromHtml(String html) {
        if (html == null) return null;
        double[] c;
        c = match(html, "\\[null,\\s*null,\\s*(-?\\d+(?:\\.\\d+)?),\\s*(-?\\d+(?:\\.\\d+)?)\\]", 1, 2, false);
        if (c != null) return c;
        c = match(html, "\"latitude\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*\"longitude\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)", 1, 2, false);
        if (c != null) return c;
        c = match(html, "\"lng\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*\"lat\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)", 1, 2, true);
        if (c != null) return c;
        c = match(html, "@(-?\\d+(?:\\.\\d+)?),(-?\\d+(?:\\.\\d+)?)", 1, 2, false);
        if (c != null) return c;
        c = match(html, "!3d(-?\\d+(?:\\.\\d+)?)!4d(-?\\d+(?:\\.\\d+)?)", 1, 2, false);
        if (c != null) return c;
        return null;
    }

    private static double[] match(String text, String regex, int latGroup, int lngGroup, boolean swap) {
        try {
            Matcher m = Pattern.compile(regex, Pattern.CASE_INSENSITIVE).matcher(text);
            while (m.find()) {
                double a = Double.parseDouble(m.group(latGroup));
                double b = Double.parseDouble(m.group(lngGroup));
                double[] value = swap ? validate(b, a) : validate(a, b);
                if (value != null) return value;
            }
        } catch (Exception ignored) {}
        return null;
    }

    private static double[] validate(double lat, double lng) {
        if (Double.isNaN(lat) || Double.isNaN(lng) || Double.isInfinite(lat) || Double.isInfinite(lng)) return null;
        if (lat < -90 || lat > 90) return null;
        if (lng < -180 || lng > 180) return null;
        if (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001) return null;
        return new double[]{lat, lng};
    }

    private static String safeDecode(String text) {
        try {
            return URLDecoder.decode(text, "UTF-8");
        } catch (Exception e) {
            return text;
        }
    }
}
`;

// ---------------------------------------------------------------------------
// MapsLinkPlugin.java
// ---------------------------------------------------------------------------
const pluginCode = String.raw`package com.aguarutas.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Permite resolver enlaces de Google Maps desde JavaScript:
 *   Capacitor.Plugins.MapsLink.resolve({ url: "https://maps.app.goo.gl/..." })
 */
@CapacitorPlugin(name = "MapsLink")
public class MapsLinkPlugin extends Plugin {

    @PluginMethod
    public void resolve(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("URL vacía");
            return;
        }

        new Thread(new Runnable() {
            @Override
            public void run() {
                final MapsLinkResolver.Result result = MapsLinkResolver.resolve(url);
                final JSObject ret = new JSObject();
                ret.put("originalUrl", result.originalUrl == null ? "" : result.originalUrl);
                ret.put("url", result.finalUrl == null ? "" : result.finalUrl);
                if (result.lat != null) ret.put("lat", result.lat);
                if (result.lng != null) ret.put("lng", result.lng);
                if (result.error != null) ret.put("error", result.error);
                if (result.debug != null) ret.put("debug", result.debug);

                if (getActivity() != null) {
                    getActivity().runOnUiThread(new Runnable() {
                        @Override public void run() {
                            call.resolve(ret);
                        }
                    });
                } else {
                    call.resolve(ret);
                }
            }
        }).start();
    }
}
`;

// ---------------------------------------------------------------------------
// MainActivity.java
// ---------------------------------------------------------------------------
const mainActivityCode = String.raw`package com.aguarutas.app;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import android.widget.Toast;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    private JSONObject pendingPayload = null;
    private int injectAttempt = 0;
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MapsLinkPlugin.class);
        super.onCreate(savedInstanceState);
        handleIncomingIntent(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    private void handleIncomingIntent(Intent intent) {
        try {
            if (intent == null) return;
            String action = intent.getAction();

            if (Intent.ACTION_SEND.equals(action)) {
                String type = intent.getType();
                if (type == null || !type.startsWith("text/")) return;
                String text = intent.getStringExtra(Intent.EXTRA_TEXT);
                if (text == null || text.trim().isEmpty()) return;
                Toast.makeText(this, "Procesando ubicación…", Toast.LENGTH_SHORT).show();
                processIncoming(text, "share");
                return;
            }

            if (Intent.ACTION_VIEW.equals(action)) {
                if (intent.getData() == null) return;
                String url = intent.getData().toString();
                if (!MapsLinkResolver.isMapsUrl(url)) return;
                Toast.makeText(this, "Procesando enlace de Maps…", Toast.LENGTH_SHORT).show();
                processIncoming(url, "view");
            }
        } catch (Exception e) {
            android.util.Log.e("AguaRutas", "Error leyendo el intent", e);
        }
    }

    private void processIncoming(final String rawText, final String source) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                final JSONObject payload = buildPayload(rawText, source);
                handler.post(new Runnable() {
                    @Override
                    public void run() {
                        pendingPayload = payload;
                        injectAttempt = 0;
                        attemptInject();
                    }
                });
            }
        }).start();
    }

    private JSONObject buildPayload(String rawText, String source) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("text", rawText == null ? "" : rawText);
            payload.put("source", source == null ? "share" : source);

            String url = MapsLinkResolver.firstMapsUrl(rawText);
            payload.put("url", url == null ? "" : url);

            Double lat = null;
            Double lng = null;
            String error = null;
            String debug = null;

            if (url != null) {
                MapsLinkResolver.Result result = MapsLinkResolver.resolve(url);
                if (result.finalUrl != null && !result.finalUrl.isEmpty()) {
                    payload.put("url", result.finalUrl);
                }
                lat = result.lat;
                lng = result.lng;
                error = result.error;
                debug = result.debug;
            }

            if (lat == null || lng == null) {
                double[] coords = MapsLinkResolver.extractCoords(rawText);
                if (coords != null) {
                    lat = coords[0];
                    lng = coords[1];
                    debug = "coordenadas encontradas en el texto";
                }
            }

            if (lat != null && lng != null) {
                payload.put("lat", lat.doubleValue());
                payload.put("lng", lng.doubleValue());
                error = null;
            } else if (error == null) {
                error = "No se encontró un enlace de Google Maps con coordenadas";
            }

            if (error != null) payload.put("error", error);
            if (debug != null) payload.put("debug", debug);

            android.util.Log.d("AguaRutas", "Payload: " + payload.toString());
        } catch (Exception e) {
            try { payload.put("error", "Error interno: " + e.getMessage()); } catch (Exception ignored) {}
        }
        return payload;
    }

    private void attemptInject() {
        if (pendingPayload == null) return;
        Bridge b = this.bridge;
        final WebView webView = b == null ? null : b.getWebView();
        if (webView == null) {
            retry();
            return;
        }

        webView.evaluateJavascript("(window.__aguaRutasReady === true)", value -> {
            if (value != null && value.contains("true")) {
                injectNow(webView);
            } else {
                retry();
            }
        });
    }

    private void retry() {
        if (pendingPayload == null) return;
        if (injectAttempt >= 60) {
            android.util.Log.w("AguaRutas", "La WebView no estuvo lista para recibir la ubicación");
            return;
        }
        injectAttempt++;
        handler.postDelayed(new Runnable() {
            @Override public void run() {
                attemptInject();
            }
        }, 500);
    }

    private void injectNow(WebView webView) {
        final JSONObject payload = pendingPayload;
        if (payload == null) return;
        pendingPayload = null;
        try {
            String js = "window.__pendingShareData = " + payload.toString() + ";" +
                "if (window.__aguaRutasConsumeShare) { window.__aguaRutasConsumeShare(); }";
            webView.evaluateJavascript(js, null);
            android.util.Log.d("AguaRutas", "Ubicación inyectada en la WebView");
        } catch (Exception e) {
            android.util.Log.e("AguaRutas", "Error inyectando la ubicación", e);
        }
    }
}
`;

fs.writeFileSync(path.join(javaDir, 'MapsLinkResolver.java'), resolverCode);
fs.writeFileSync(path.join(javaDir, 'MapsLinkPlugin.java'), pluginCode);
fs.writeFileSync(path.join(javaDir, 'MainActivity.java'), mainActivityCode);

console.log('✅ MapsLinkResolver.java generado');
console.log('✅ MapsLinkPlugin.java generado');
console.log('✅ MainActivity.java generado (share + abrir enlaces + plugin JS)');
