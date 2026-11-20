// Parchea MainActivity.java para recibir ACTION_SEND y resolver shortlinks de Google Maps
const fs = require('fs');
const path = require('path');

const javaPath = path.join(
  __dirname, '..', 'android', 'app', 'src', 'main', 'java', 'com', 'aguarutas', 'app', 'MainActivity.java'
);

if (!fs.existsSync(javaPath)) {
  console.error('❌ No se encontró MainActivity.java en la ruta esperada:');
  console.error('   ' + javaPath);
  process.exit(1);
}

const javaCode = `package com.aguarutas.app;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends BridgeActivity {
    private String pendingShareText = null;

    private static final Pattern SHORTLINK_PATTERN =
        Pattern.compile("https?://(maps\\\\.app\\\\.goo\\\\.gl|goo\\\\.gl/maps)/[^\\\\s]+");
    private static final Pattern OG_URL_PATTERN =
        Pattern.compile("property=[\\"']og:url[\\"']\\\\s+content=[\\"']([^\\"']+)[\\"']", Pattern.CASE_INSENSITIVE);
    private static final Pattern CANONICAL_PATTERN =
        Pattern.compile("rel=[\\"']canonical[\\"']\\\\s+href=[\\"']([^\\"']+)[\\"']", Pattern.CASE_INSENSITIVE);
    private static final Pattern MAPS_URL_IN_HTML =
        Pattern.compile("(https://www\\\\.google\\\\.com/maps/[^\\"'\\\\s]+)");

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handleShareIntent(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShareIntent(intent);
    }

    private void handleShareIntent(Intent intent) {
        try {
            if (intent == null) return;
            if (!Intent.ACTION_SEND.equals(intent.getAction())) return;
            String type = intent.getType();
            if (type == null || !type.startsWith("text/")) return;
            final String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (sharedText == null || sharedText.isEmpty()) return;

            // Resolver shortlinks en segundo plano (evita bloquear el UI)
            new Thread(new Runnable() {
                @Override public void run() {
                    final String resolvedText = resolveShortlinksInText(sharedText);
                    runOnUiThread(new Runnable() {
                        @Override public void run() {
                            pendingShareText = resolvedText;
                            attemptInject(0);
                        }
                    });
                }
            }).start();
        } catch (Exception e) {
            // Ignorar
        }
    }

    private String resolveShortlinksInText(String text) {
        try {
            Matcher m = SHORTLINK_PATTERN.matcher(text);
            if (!m.find()) return text;
            String shortUrl = m.group();
            String expanded = followRedirects(shortUrl);
            if (expanded != null && !expanded.isEmpty()) {
                return text.replace(shortUrl, expanded);
            }
        } catch (Exception e) {
            // Ignorar
        }
        return text;
    }

    private String followRedirects(String urlStr) {
        HttpURLConnection conn = null;
        try {
            URL currentUrl = new URL(urlStr);
            for (int i = 0; i < 6; i++) {
                conn = (HttpURLConnection) currentUrl.openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);
                conn.setRequestProperty("User-Agent",
                    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");
                conn.setRequestProperty("Accept", "text/html,application/xhtml+xml");

                int code = conn.getResponseCode();
                if (code >= 300 && code < 400) {
                    String location = conn.getHeaderField("Location");
                    conn.disconnect();
                    conn = null;
                    if (location == null) return currentUrl.toString();
                    currentUrl = new URL(currentUrl, location);
                    continue;
                }

                // Última petición: leer HTML y buscar URL canónica con coordenadas
                InputStream is = conn.getInputStream();
                BufferedReader br = new BufferedReader(new InputStreamReader(is, "UTF-8"));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                br.close();
                conn.disconnect();
                conn = null;

                String html = sb.toString();

                Matcher og = OG_URL_PATTERN.matcher(html);
                if (og.find()) return og.group(1);

                Matcher can = CANONICAL_PATTERN.matcher(html);
                if (can.find()) return can.group(1);

                Matcher maps = MAPS_URL_IN_HTML.matcher(html);
                if (maps.find()) return maps.group(1);

                return currentUrl.toString();
            }
        } catch (Exception e) {
            // Ignorar
        } finally {
            if (conn != null) {
                try { conn.disconnect(); } catch (Exception e) { }
            }
        }
        return null;
    }

    private void attemptInject(final int attempt) {
        if (pendingShareText == null) return;
        Bridge b = this.bridge;
        if (b == null || b.getWebView() == null || !isPageReady(b)) {
            if (attempt < 30) {
                new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                    @Override public void run() { attemptInject(attempt + 1); }
                }, 500);
            }
            return;
        }
        final String textToInject = pendingShareText;
        pendingShareText = null;
        b.getWebView().post(new Runnable() {
            @Override public void run() {
                try {
                    String escaped = JSONObject.quote(textToInject);
                    String js = "window.__pendingShareData = " + escaped + ";" +
                        "if (window.__aguaRutasReady && window.__aguaRutasConsumeShare) { window.__aguaRutasConsumeShare(); }";
                    bridge.getWebView().evaluateJavascript(js, null);
                } catch (Exception e) { }
            }
        });
    }

    private boolean isPageReady(Bridge b) {
        try {
            String url = b.getWebView().getUrl();
            return url != null && url.startsWith("http");
        } catch (Exception e) {
            return false;
        }
    }
}
`;

fs.writeFileSync(javaPath, javaCode);
console.log('✅ MainActivity.java parcheado (con resolución de shortlinks)');