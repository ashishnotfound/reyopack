import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.reyostore.reyopack',
  appName: 'Reyo Pack',
  webDir: 'out',
  android: {
    allowMixedContent: false,
  },
  server: {
    cleartext: false,
  },
};

export default config;
