interface CapacitorConfig {
  appId: string;
  appName: string;
  webDir: string;
  server?: {
    androidScheme: string;
  };
  plugins?: any;
}

const config: CapacitorConfig = {
  appId: "io.ionic.starter",
  appName: "kiosk",
  webDir: "www/browser",
  server: {
    androidScheme: "https",
  },
  plugins: {
    CapacitorSQLite: {
      iosDatabaseLocation: "Library/databases",
      androidDatabaseLocation: "databases",
    },
  },
};

export default config;
