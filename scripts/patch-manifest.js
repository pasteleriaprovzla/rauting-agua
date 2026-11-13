// scripts/patch-manifest.js
const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

if (!fs.existsSync(manifestPath)) {
  console.error('❌ AndroidManifest.xml no existe. Ejecuta `npx cap add android` primero.');
  process.exit(1);
}

let manifest = fs.readFileSync(manifestPath, 'utf8');
let changed = false;

// 1. Asegurar launchMode="singleTask" en MainActivity
const nameIdx = manifest.indexOf('android:name=".MainActivity"');
if (nameIdx === -1) {
  console.error('❌ No se encontró MainActivity en AndroidManifest.xml');
  process.exit(1);
}
const tagStart = manifest.lastIndexOf('<activity', nameIdx);
const tagEnd = manifest.indexOf('>', nameIdx);
const tagContent = manifest.substring(tagStart, tagEnd);

if (!tagContent.includes('launchMode')) {
  manifest = manifest.substring(0, tagEnd) + '\n            android:launchMode="singleTask"' + manifest.substring(tagEnd);
  changed = true;
  console.log('✅ launchMode="singleTask" agregado');
}

// 2. Agregar intent-filter geo
if (!manifest.includes('android:scheme="geo"')) {
  const geoFilter = `            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="geo" />
            </intent-filter>`;
  const idxEnd = manifest.indexOf('</activity>', nameIdx);
  if (idxEnd === -1) {
    console.error('❌ No se pudo insertar intent-filter');
    process.exit(1);
  }
  manifest = manifest.substring(0, idxEnd) + geoFilter + '\n        ' + manifest.substring(idxEnd);
  changed = true;
  console.log('✅ Intent-filter geo agregado');
}

// 3. Permisos de ubicación
const perms = [
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
];
for (const perm of perms) {
  if (!manifest.includes(perm)) {
    const internetRe = /(<uses-permission android:name="android\.permission\.INTERNET"[^>]*\/>)/;
    if (internetRe.test(manifest)) {
      manifest = manifest.replace(internetRe, `$1\n    <uses-permission android:name="${perm}" />`);
      changed = true;
      console.log(`✅ Permiso ${perm} agregado`);
    }
  }
}

if (changed) {
  fs.writeFileSync(manifestPath, manifest);
  console.log('✅ AndroidManifest.xml actualizado');
} else {
  console.log('ℹ️  AndroidManifest.xml ya estaba actualizado');
}
