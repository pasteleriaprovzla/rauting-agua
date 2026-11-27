// Parchea AndroidManifest.xml para recibir enlaces de mapas y contenido compartido
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

// --- 1. launchMode="singleTask" y exported en MainActivity ---
const nameIdx = manifest.indexOf('android:name=".MainActivity"');
if (nameIdx === -1) {
  console.error('❌ No se encontró MainActivity en AndroidManifest.xml');
  process.exit(1);
}
const activityStart = manifest.lastIndexOf('<activity', nameIdx);
let tagEnd = manifest.indexOf('>', nameIdx);
let tagContent = manifest.substring(activityStart, tagEnd);

if (!tagContent.includes('launchMode')) {
  manifest =
    manifest.substring(0, tagEnd) +
    '\n            android:launchMode="singleTask"' +
    manifest.substring(tagEnd);
  changed = true;
  console.log('✅ launchMode="singleTask" agregado');
}

// Android 12+ exige android:exported explícito cuando hay intent-filters.
if (!tagContent.includes('android:exported')) {
  tagEnd = manifest.indexOf('>', nameIdx);
  manifest =
    manifest.substring(0, tagEnd) +
    '\n            android:exported="true"' +
    manifest.substring(tagEnd);
  changed = true;
  console.log('✅ android:exported="true" agregado');
} else if (tagContent.includes('android:exported="false"')) {
  manifest = manifest.replace('android:exported="false"', 'android:exported="true"');
  changed = true;
  console.log('✅ android:exported corregido a "true"');
}

// --- 2. Intent filters (comprobados dentro de la actividad, no en todo el manifest) ---
const idxEnd = manifest.indexOf('</activity>', nameIdx);
if (idxEnd === -1) {
  console.error('❌ No se pudo insertar intent-filters');
  process.exit(1);
}
const activityBlock = manifest.substring(activityStart, idxEnd);
const needGeo = !activityBlock.includes('android:scheme="geo"');
const needWwwMaps = !activityBlock.includes('android:host="www.google.com"');
const needMapsGoogle = !activityBlock.includes('android:host="maps.google.com"');
const needShortMaps = !activityBlock.includes('android:host="maps.app.goo.gl"');
const needGooGl = !activityBlock.includes('android:host="goo.gl"');
const needSendText = !activityBlock.includes('android:mimeType="text/plain"');

if (needGeo || needWwwMaps || needMapsGoogle || needShortMaps || needGooGl || needSendText) {
  let intentFilters = '';

  if (needGeo) {
    intentFilters += `
            <!-- Recibir ubicaciones nativas de WhatsApp -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="geo" />
            </intent-filter>`;
    console.log('✅ Filtro geo: agregado');
  }

  if (needWwwMaps) {
    intentFilters += `
            <!-- Google Maps: www.google.com/maps (Abrir enlace) -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="www.google.com" android:pathPrefix="/maps" />
                <data android:scheme="http"  android:host="www.google.com" android:pathPrefix="/maps" />
            </intent-filter>`;
    console.log('✅ Filtro www.google.com/maps agregado');
  }

  if (needMapsGoogle) {
    intentFilters += `
            <!-- Google Maps: maps.google.com (Abrir enlace) -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="maps.google.com" />
                <data android:scheme="http"  android:host="maps.google.com" />
            </intent-filter>`;
    console.log('✅ Filtro maps.google.com agregado');
  }

  if (needShortMaps) {
    intentFilters += `
            <!-- Google Maps: enlaces cortos maps.app.goo.gl (Abrir enlace) -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="maps.app.goo.gl" />
                <data android:scheme="http"  android:host="maps.app.goo.gl" />
            </intent-filter>`;
    console.log('✅ Filtro maps.app.goo.gl agregado');
  }

  if (needGooGl) {
    intentFilters += `
            <!-- Google Maps: goo.gl/maps (Abrir enlace) -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="goo.gl" android:pathPrefix="/maps" />
                <data android:scheme="http"  android:host="goo.gl" android:pathPrefix="/maps" />
            </intent-filter>`;
    console.log('✅ Filtro goo.gl/maps agregado');
  }

  if (needSendText) {
    intentFilters += `
            <!-- Recibir texto compartido (Google Maps, WhatsApp, etc.) -->
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
                <data android:mimeType="text/*" />
            </intent-filter>`;
    console.log('✅ Filtro ACTION_SEND (texto compartido) agregado');
  }

  const insertAt = manifest.indexOf('</activity>', nameIdx);
  if (insertAt === -1) {
    console.error('❌ No se pudo insertar intent-filters');
    process.exit(1);
  }
  manifest =
    manifest.substring(0, insertAt) + intentFilters + '\n        ' + manifest.substring(insertAt);
  changed = true;
}

// --- 2b. <queries> para resolver/abrir Google Maps en Android 11+ ---
if (!manifest.includes('com.google.android.apps.maps')) {
  const pkg = '        <package android:name="com.google.android.apps.maps" />';
  if (manifest.includes('<queries>')) {
    manifest = manifest.replace('<queries>', '<queries>\n' + pkg);
  } else if (manifest.includes('<application')) {
    const queriesBlock = `
    <queries>
${pkg}
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:scheme="geo" />
        </intent>
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:scheme="https" android:host="maps.google.com" />
        </intent>
    </queries>

`;
    manifest = manifest.replace('<application', queriesBlock + '    <application');
  }
  changed = true;
  console.log('✅ <queries> para Google Maps agregado');
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
    }
  }
}

if (changed) {
  fs.writeFileSync(manifestPath, manifest);
  console.log('✅ AndroidManifest.xml actualizado');
} else {
  console.log('ℹ️  AndroidManifest.xml ya estaba actualizado');
}
