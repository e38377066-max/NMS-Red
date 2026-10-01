import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.imperioap.nmsfield",
  appName: "Imperio AP",
  webDir: "dist",
  server: {
    androidScheme: "https",
    iosScheme: "capacitor",
  },
};

export default config;