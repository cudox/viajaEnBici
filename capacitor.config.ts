import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'co.viajaenbici.app',
  appName: 'Viaja en Bici',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#eef2f7',
  },
  plugins: {
    Geolocation: {
      // La app pide el permiso en tiempo de ejecución desde el código.
    },
  },
};

export default config;
