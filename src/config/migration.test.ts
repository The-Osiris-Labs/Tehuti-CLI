import { describe, it, expect } from 'vitest';
import { migrateConfig } from './migration.js';

describe('migrateConfig', () => {
	it('should migrate a v0 config to latest (v2)', () => {
		const config = { provider: 'opencode', model: 'test' };
		const migrated = migrateConfig(config);
		expect(migrated._version).toBe(2);
		expect(migrated.performance).toBeDefined();
		expect(migrated.performance).toEqual({});
	});

	it('should not re-migrate a config already at latest version', () => {
		const config = { _version: 2, provider: 'opencode' };
		const migrated = migrateConfig(config);
		expect(migrated._version).toBe(2);
		expect(migrated).toEqual(config);
	});

	it('should skip migrations for versions beyond known range', () => {
		const config = { _version: 999, provider: 'opencode' };
		const migrated = migrateConfig(config);
		expect(migrated._version).toBe(999);
	});

	it('should remove deprecated port field', () => {
		const config = { port: 9090, provider: 'test' };
		const migrated = migrateConfig(config);
		expect(migrated.port).toBeUndefined();
	});

	it('should remove deprecated socketPath field', () => {
		const config = { socketPath: '/tmp/test.sock', provider: 'test' };
		const migrated = migrateConfig(config);
		expect(migrated.socketPath).toBeUndefined();
	});

	it('should remove both deprecated fields in a single migration run', () => {
		const config = { port: 9090, socketPath: '/tmp/test.sock', provider: 'test' };
		const migrated = migrateConfig(config);
		expect(migrated.port).toBeUndefined();
		expect(migrated.socketPath).toBeUndefined();
		expect(migrated._version).toBe(2);
	});

	it('should run only migration v2 for a v1 config', () => {
		const config = { _version: 1, provider: 'test' };
		const migrated = migrateConfig(config);
		expect(migrated._version).toBe(2);
		expect(migrated.performance).toBeDefined();
	});

	it('should not modify the original config object', () => {
		const config = { provider: 'test', port: 9090 };
		const original = { ...config };
		migrateConfig(config);
		expect(config).toEqual(original);
		expect(config.port).toBe(9090);
	});

	it('should preserve existing fields through migration', () => {
		const config = {
			provider: 'opencode',
			model: 'gpt-4',
			apiKey: 'sk-123',
			customSetting: true,
		};
		const migrated = migrateConfig(config);
		expect(migrated.provider).toBe('opencode');
		expect(migrated.model).toBe('gpt-4');
		expect(migrated.apiKey).toBe('sk-123');
		expect(migrated.customSetting).toBe(true);
	});

	it('should preserve an existing performance section', () => {
		const config = {
			_version: 0,
			performance: { maxTokens: 4096 },
		};
		const migrated = migrateConfig(config);
		expect(migrated.performance).toEqual({ maxTokens: 4096 });
		expect(migrated._version).toBe(2);
	});

	it('should handle empty config object', () => {
		const migrated = migrateConfig({});
		expect(migrated._version).toBe(2);
		expect(migrated.performance).toBeDefined();
	});

	it('should handle a fully migrated v2 config with no-op', () => {
		const config = {
			_version: 2,
			provider: 'opencode',
			performance: { cacheEnabled: true },
		};
		const migrated = migrateConfig(config);
		expect(migrated).toEqual(config);
	});
});
