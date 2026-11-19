// Parchea MainActivity.java para recibir enlaces compartidos desde Google Maps
const fs = require('fs');
const path = require('path');

const javaPath = path.join(
  __dirname, '..', 'android', 'app', 'src', 'main', 'java', 'com', 'aguarutas', 'app', 'MainActivity.java'
);

if (!fs.existsSync(javaPath)) {
  console.error('❌ No se encontró MainActivity.java en la ruta esperada.');
  console.error('   Buscando en: ' + javaPath);
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

public class MainActivity extends BridgeActivity {
    private String pendingShareText = null;

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
            String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (sharedText == null || sharedText.isEmpty()) return;
            pendingShareText = sharedText;
            attemptInject(0);
        } catch (Exception e) {
            // Ignorar
        }
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
                } catch (Exception e) {
                    // Ignorar
                }
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
console.log('✅ MainActivity.java parcheado para recibir ACTION_SEND');