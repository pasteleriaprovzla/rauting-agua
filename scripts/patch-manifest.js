// Parchea AndroidManifest.xml para:
//  - Recibir ubicaciones de WhatsApp (geo:)
//  - Recibir enlaces de Google Maps (https://maps.google.com, etc.)
//  - Permisos de ubicación, notificaciones y foreground service
const fs = require('fs');
const path = require('path');

const manifestPath = path.join(
  __dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'
);

if (!fs.existsSync(manifestPath)) {
  console.error('❌ AndroidManifest.xml no existe. Ejecuta `npx cap add android` primero.');
  process.exit(1);
}

let manifest = fs.readFileSync(manifestPath, 'utf8');
let changed = false;

// --- 1. launchMode="singleTask" en MainActivity ---
const nameIdx = manifest.indexOf('android:name=".MainActivity"');
if (nameIdx === -1) {
  console.error('❌ No se encontró MainActivity en AndroidManifest.xml');
  process.exit(1);
}
const tagEnd = manifest.indexOf('>', nameIdx);
const tagContent = manifest.substring(manifest.lastIndexOf('<activity', nameIdx), tagEnd);

if (!tagContent.includes('launchMode')) {
  manifest =
    manifest.substring(0, tagEnd) +
    '\n            android:launchMode="singleTask"' +
    manifest.substring(tagEnd);
  changed = true;
  console.log('✅ launchMode="singleTask" agregado');
}

// --- 2. Intent filters: geo: + Google Maps ---
if (!manifest.includes('android:scheme="geo"')) {
  const intentFilters = `
            <!-- Recibir ubicaciones nativas de WhatsApp -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="geo" />
            </intent-filter>
            <!-- Recibir enlaces de Google Maps: www.google.com/maps -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="www.google.com" android:pathPrefix="/maps" />
                <data android:scheme="http"  android:host="www.google.com" android:pathPrefix="/maps" />
            </intent-filter>
            <!-- Recibir enlaces de Google Maps: maps.google.com -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="maps.google.com" />
                <data android:scheme="http"  android:host="maps.google.com" />
            </intent-filter>
            <!-- Recibir enlaces cortos: maps.app.goo.gl -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="maps.app.goo.gl" />
            </intent-filter>
            <!-- Recibir enlaces cortos viejos: goo.gl/maps -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="goo.gl" android:pathPrefix="/maps" />
            </intent-filter>`;
  const idxEnd = manifest.indexOf('</activity>', nameIdx);
  if (idxEnd === -1) {
    console.error('❌ No se pudo insertar intent-filters');
    process.exit(1);
  }
  manifest =
    manifest.substring(0, idxEnd) + intentFilters + '\n        ' + manifest.substring(idxEnd);
  changed = true;
  console.log('✅ Intent-filters (geo + Google Maps) agregados');
}

// --- 3. Permisos ---
const perms = [
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.WAKE_LOCK',
];
for (const perm of perms) {
  if (!manifest.includes(perm)) {
    const internetRe = /(<uses-permission android:name="android\.permission\.INTERNET"[^>]*\/>)/;
    if (internetRe.test(manifest)) {
      manifest = manifest.replace(
        internetRe,
        `$1\n    <uses-permission android:name="${perm}" />`
      );
      changed = true;
      console.log(`✅ Permiso ${perm} agregado`);
    } else {
      const manifestOpen = manifest.indexOf('>', manifest.indexOf('<manifest'));
      manifest = manifest.substring(0, manifestOpen + 1) +
        `\n    <uses-permission android:name="${perm}" />` +
        manifest.substring(manifestOpen + 1);
      changed = true;
      console.log(`✅ Permiso ${perm} agregado (junto a <manifest>)`);
    }
  }
}

if (changed) {
  fs.writeFileSync(manifestPath, manifest);
  console.log('✅ AndroidManifest.xml actualizado');
} else {
  console.log('ℹ️  AndroidManifest.xml ya estaba actualizado');
}