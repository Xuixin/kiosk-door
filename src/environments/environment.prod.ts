import { Capacitor } from '@capacitor/core';
import { getRxStorageSQLiteTrial } from 'rxdb/plugins/storage-sqlite';
import { getSQLiteBasicsCapacitor } from 'rxdb/plugins/storage-sqlite';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
        import { RxDBUpdatePlugin } from 'rxdb/plugins/update';
import { addRxPlugin } from 'rxdb';
const sqlite = new SQLiteConnection(CapacitorSQLite);

export const environment = {
  production: true,
  apiUrl: 'http://localhost:3001/graphql',
  wsUrl: 'ws://localhost:3001/graphql',
  databaseName: 'kiosk_prod',
  multiInstance: false,
  addRxDBPlugins() {
    addRxPlugin(RxDBUpdatePlugin);
  },
  getRxStorage() {
    return getRxStorageSQLiteTrial({
      sqliteBasics: getSQLiteBasicsCapacitor(sqlite, Capacitor),
    });
  },
};
