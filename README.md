# 💧 Agua Rutas

App para gestionar rutas de reparto de agua. Recibe ubicaciones compartidas por WhatsApp y las envía a los choferes con navegación de Google Maps.

## 🏗️ Stack

- **Capacitor 6** + HTML/CSS/JS vanilla
- **Leaflet + OpenStreetMap** (mapa, sin API key)
- **@capacitor/geolocation** (GPS)
- **Deep link `geo:`** (recibir ubicaciones de WhatsApp)
- **Google Maps navigation intent** (navegación turn-by-turn)

## 🚀 Compilar localmente

```bash
npm install
npx cap add android
node scripts/patch-manifest.js
npx cap sync android
npx cap open android    # o: cd android && ./gradlew assembleDebug
