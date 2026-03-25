import { SafetyGuard } from '../safety-guard';
import type { ResolvedOptions } from '../interfaces/module-options.interface';
import type { Pool } from 'mysql2/promise';

function createMockPool(database: string): Pool {
  return {
    pool: {
      config: {
        connectionConfig: { database },
      },
    },
  } as unknown as Pool;
}

function createOptions(
  overrides: Partial<ResolvedOptions> = {},
): ResolvedOptions {
  return {
    poolToken: 'MYSQL_POOL',
    dbNameMustInclude: 'test',
    allowedNodeEnv: ['test'],
    savepointPrefix: 'sp',
    enableLogging: false,
    ...overrides,
  };
}

describe('SafetyGuard', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('validateNodeEnv', () => {
    it('should pass when NODE_ENV is in allowed list', () => {
      process.env.NODE_ENV = 'test';
      const pool = createMockPool('myapp_test');
      const options = createOptions();

      expect(() => SafetyGuard.validate(pool, options)).not.toThrow();
    });

    it('should throw when NODE_ENV is production', () => {
      process.env.NODE_ENV = 'production';
      const pool = createMockPool('myapp_test');
      const options = createOptions();

      expect(() => SafetyGuard.validate(pool, options)).toThrow(
        /NODE_ENV="production" is not allowed/,
      );
    });

    it('should throw when NODE_ENV is development', () => {
      process.env.NODE_ENV = 'development';
      const pool = createMockPool('myapp_test');
      const options = createOptions();

      expect(() => SafetyGuard.validate(pool, options)).toThrow(
        /NODE_ENV="development" is not allowed/,
      );
    });

    it('should throw when NODE_ENV is empty', () => {
      process.env.NODE_ENV = '';
      const pool = createMockPool('myapp_test');
      const options = createOptions();

      expect(() => SafetyGuard.validate(pool, options)).toThrow(
        /NODE_ENV="" is not allowed/,
      );
    });

    it('should support custom allowed envs', () => {
      process.env.NODE_ENV = 'ci';
      const pool = createMockPool('myapp_test');
      const options = createOptions({ allowedNodeEnv: ['test', 'ci'] });

      expect(() => SafetyGuard.validate(pool, options)).not.toThrow();
    });
  });

  describe('validateDatabaseName', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'test';
    });

    it('should pass when database name includes "test"', () => {
      const pool = createMockPool('myapp_test');
      const options = createOptions();

      expect(() => SafetyGuard.validate(pool, options)).not.toThrow();
    });

    it('should pass when database name is "test_myapp"', () => {
      const pool = createMockPool('test_myapp');
      const options = createOptions();

      expect(() => SafetyGuard.validate(pool, options)).not.toThrow();
    });

    it('should throw when database name does not include "test"', () => {
      const pool = createMockPool('myapp_production');
      const options = createOptions();

      expect(() => SafetyGuard.validate(pool, options)).toThrow(
        /Database "myapp_production" does not include "test"/,
      );
    });

    it('should throw when database name is "myapp"', () => {
      const pool = createMockPool('myapp');
      const options = createOptions();

      expect(() => SafetyGuard.validate(pool, options)).toThrow(
        /does not include "test"/,
      );
    });

    it('should be case-insensitive', () => {
      const pool = createMockPool('MyApp_TEST');
      const options = createOptions();

      expect(() => SafetyGuard.validate(pool, options)).not.toThrow();
    });

    it('should support custom dbNameMustInclude', () => {
      const pool = createMockPool('myapp_e2e');
      const options = createOptions({ dbNameMustInclude: 'e2e' });

      expect(() => SafetyGuard.validate(pool, options)).not.toThrow();
    });

    it('should throw when pool has no database configured', () => {
      const pool = { pool: {} } as unknown as Pool;
      const options = createOptions();

      expect(() => SafetyGuard.validate(pool, options)).toThrow(
        /Could not determine database name/,
      );
    });
  });

  describe('extractDatabaseName', () => {
    it('should extract from connectionConfig path', () => {
      const pool = createMockPool('mydb');
      expect(SafetyGuard.extractDatabaseName(pool)).toBe('mydb');
    });

    it('should extract from config.database path', () => {
      const pool = {
        pool: { config: { database: 'mydb2' } },
      } as unknown as Pool;
      expect(SafetyGuard.extractDatabaseName(pool)).toBe('mydb2');
    });

    it('should return null for empty pool', () => {
      const pool = {} as unknown as Pool;
      expect(SafetyGuard.extractDatabaseName(pool)).toBeNull();
    });
  });
});
