# Android

La app web se empaqueta con Capacitor 8.5.3 en un proyecto Android nativo. El APK debug ya fue compilado y verificado; **no se ha ejecutado en un teléfono ni en un emulador** porque no había un dispositivo conectado.

> Importante: el APK existente se generó antes de la rama de **Mis rutas** y del cambio de color de la ruta segura. Recompílalo con `npm run android:apk` después de validar la web.

## Estado verificado

```text
APK:            android/app/build/outputs/apk/debug/app-debug.apk
Tamaño:         12 MB
Package:        co.viajaenbici.app
Etiqueta:       Viaja en Bici
versionCode:    1
versionName:    0.1.0
minSdk:         24
targetSdk:      36
compileSdk:     36
Gradle:         8.14.3
JDK:            21.0.12.1
```

Permisos del manifiesto:

```text
android.permission.INTERNET
android.permission.ACCESS_NETWORK_STATE
android.permission.ACCESS_COARSE_LOCATION
android.permission.ACCESS_FINE_LOCATION
```

El APK contiene `assets/public/index.html`, el JavaScript/CSS compilado, el service worker y los datos de Bogotá, incluido `assets/public/data/grafo-bogota.json.gz.bin`. Se comprobó que el asset se puede descomprimir a 19.216.646 bytes.

## Requisitos en CachyOS

```bash
sudo pacman -S --needed git nodejs npm jdk21-openjdk android-tools unzip
```

- `android-tools` aporta `adb` y utilidades básicas.
- El SDK completo se instala aparte; Android Studio no es obligatorio.
- Node debe ser ≥ 22.12; se probó con 26.11.1.

Comprueba Java:

```bash
archlinux-java status
java -version
```

Si hay varias versiones:

```bash
sudo archlinux-java set java-21-openjdk
```

## Instalar el SDK

Se usó el SDK en `/home/cudox/Android/Sdk`. Los comandos de esta sección son los que se ejecutaron; la versión de las command-line tools puede cambiar.

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
mkdir -p "$ANDROID_HOME/cmdline-tools"
```

Descarga las command-line tools desde la página oficial de Android y descomprímelas de forma que quede:

```text
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager
```

Luego:

```bash
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
```

El SDK Manager avisa que `sdkmanager` está obsoleto y que el reemplazo es `android sdk`; en la prueba funcionó igual. Si usas el CLI nuevo:

```bash
android sdk install platform-tools "platforms;android-36" "build-tools;36.0.0"
```

Verifica:

```bash
sdkmanager --list_installed | grep -E 'platforms;android-36|build-tools;36.0.0|platform-tools'
```

## Configurar el proyecto

Crea `android/local.properties` (no se versiona):

```properties
sdk.dir=/home/cudox/Android/Sdk
```

Alternativa: exporta `ANDROID_HOME` y `ANDROID_SDK_ROOT` antes de compilar.

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk
```

## Compilar

Desde la raíz del proyecto:

```bash
npm install
npm run android:apk
```

Ese script ejecuta `npm run build` (TypeScript + Vite), `npx cap sync android` y:

```bash
cd android
./gradlew assembleDebug --no-daemon
```

El APK queda en:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

También se puede compilar por separado:

```bash
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```

### Verificar el APK

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
"$ANDROID_HOME/build-tools/36.0.0/aapt" dump badging \
  android/app/build/outputs/apk/debug/app-debug.apk | head -20

unzip -l android/app/build/outputs/apk/debug/app-debug.apk | grep 'assets/public/data'
unzip -p android/app/build/outputs/apk/debug/app-debug.apk \
  assets/public/data/grafo-bogota.json.gz.bin | gzip -dc | wc -c
```

La última comprobación devolvió `19216646` bytes.

## Configuración nativa

- `capacitor.config.ts`: `appId: co.viajaenbici.app`, `appName: Viaja en Bici`, `webDir: dist`, esquema Android.
- `android/variables.gradle`: compile/target 36, minSdk 24.
- `android/app/src/main/AndroidManifest.xml`: permisos de red y ubicación.
- `android/app/src/main/res/values/colors.xml`: colores de marca.
- `android/app/src/main/res/values/styles.xml`: tema `AppTheme` y splash.
- `android/app/src/main/res/mipmap-*/`: iconos legacy, redondos y foreground adaptativo.
- `android/app/src/main/res/drawable*/splash.png`: splash con fondo verde y bicicleta.

El icono adaptativo usa `#0F766E` como fondo. Los iconos web están en `public/icons/`.

## Mis rutas en Android

- **Origen GPS por defecto**: si no se fija un origen, la app toma la ubicación actual al comparar. El campo muestra «Mi ubicación (GPS)» y la etiqueta GPS.
- **Mis rutas**: destinos recientes (sin origen) y favoritas con A → B. Se guardan en `localStorage` del WebView y se pueden borrar desde el panel.
- No hay sincronización con la versión web: cada instalación conserva su propio historial.

## Plugin de geolocalización

Se usa `@capacitor/geolocation@8.1.0`. El diálogo de permisos se muestra la primera vez que hace falta la ubicación: al comparar sin origen manual, al elegir un destino reciente o al pulsar el botón de ubicación. Si se deniega, la app informa y permite elegir el origen en el mapa.

La ubicación no se pide al abrir la app; solo por acción del usuario.

## Probar en un dispositivo

No se hizo. Para hacerlo:

```bash
adb devices
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb logcat | grep -i capacitor
```

Comprueba:

1. que el mapa y las ciclorrutas carguen con red;
2. que «Probar motor local» calcule rutas sin red;
3. que el permiso de ubicación funcione;
4. que el botón Atrás de Android no cierre la app de forma inesperada;
5. que el APK abra sin conexión desde el primer arranque (los datos están empaquetados).

## Firma de producción

El APK actual es **debug**, firmado con la clave de depuración. Para publicar:

```bash
keytool -genkeypair -v -keystore viajaenbici-release.jks \
  -alias viajaenbici -keyalg RSA -keysize 2048 -validity 10000
```

Configura un `signingConfig` de release y compila:

```bash
cd android
./gradlew assembleRelease
```

No se generó ni se subió ninguna clave. No publiques el keystore ni sus contraseñas.

## Problemas frecuentes

### `SDK location not found`

Falta `android/local.properties` o `ANDROID_HOME`. Crea el archivo con `sdk.dir` absoluto.

### `Unsupported class file major version`

Gradle está usando un JDK distinto de 21. Exporta `JAVA_HOME=/usr/lib/jvm/java-21-openjdk` y vuelve a ejecutar.

### `Duplicate resources` con `ic_launcher_background`

No definas el mismo color en `colors.xml` y en `values/ic_launcher_background.xml`. En este proyecto se dejó solo en este último.

### El grafo no carga en Android

No renombes `grafo-bogota.json.gz.bin` a `.gz`: AAPT puede quitar la extensión. Comprueba también que el WebView sea moderno; la app usa `DecompressionStream` para gzip. Si no está disponible, muestra un error explicativo.

### El APK no refleja cambios web

Ejecuta `npm run build` y después `npx cap sync android`; `assembleDebug` por sí solo no copia `dist/`.

### Las teselas no cargan sin red

Es esperado. El modo offline usa el mapa vectorial, no las teselas de IDECA. Pulsa «Preparar datos» en la web o usa el APK, que ya trae los datos.
