import { debug } from '../utils/debug.js';

export interface Migration {
  version: number;
  migrate: (config: Record<string, any>) => Record<string, any>;
}

const migrations: Migration[] = [
  {
    version: 1,
    migrate: (config) => {
      // Remove deprecated fields
      delete config.port;
      delete config.socketPath;
      return config;
    },
  },
  {
    version: 2,
    migrate: (config) => {
      // Add performance section if missing
      if (!config.performance) {
        config.performance = {};
      }
      return config;
    },
  },
];

export function migrateConfig(config: Record<string, any>): Record<string, any> {
  const currentVersion = config._version ?? 0;
  let migrated = { ...config };

  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      debug.log('config', `Running migration v${migration.version}`);
      migrated = migration.migrate(migrated);
      migrated._version = migration.version;
    }
  }

  return migrated;
}
