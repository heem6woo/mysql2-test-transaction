import type { Pool } from 'mysql2/promise';
import type { ResolvedOptions } from './interfaces/module-options.interface';

export class SafetyGuard {
  /**
   * 모듈 초기화 시 환경을 검증한다.
   * 하나라도 실패하면 에러를 발생시켜 테스트 실행을 차단한다.
   */
  static validate(pool: Pool, options: ResolvedOptions): void {
    this.validateNodeEnv(options);
    this.validateDatabaseName(pool, options);
  }

  private static validateNodeEnv(options: ResolvedOptions): void {
    const env = process.env.NODE_ENV ?? '';
    if (!options.allowedNodeEnv.includes(env)) {
      throw new Error(
        `[TestTransaction:SafetyGuard] NODE_ENV="${env}" is not allowed. ` +
          `Allowed values: [${options.allowedNodeEnv.join(', ')}]. ` +
          `Set NODE_ENV to one of the allowed values before running tests.`,
      );
    }
  }

  private static validateDatabaseName(
    pool: Pool,
    options: ResolvedOptions,
  ): void {
    const dbName = this.extractDatabaseName(pool);

    if (!dbName) {
      throw new Error(
        `[TestTransaction:SafetyGuard] Could not determine database name from pool. ` +
          `Ensure the pool is properly configured with a database option.`,
      );
    }

    if (!dbName.toLowerCase().includes(options.dbNameMustInclude.toLowerCase())) {
      throw new Error(
        `[TestTransaction:SafetyGuard] Database "${dbName}" does not include ` +
          `"${options.dbNameMustInclude}". Refusing to run test transactions. ` +
          `This is a safety measure to prevent accidental data loss in non-test databases.`,
      );
    }
  }

  /**
   * mysql2 Pool에서 database 이름을 추출한다.
   * mysql2의 내부 구조에 따라 여러 경로를 시도한다.
   */
  static extractDatabaseName(pool: Pool): string | null {
    try {
      // mysql2/promise Pool → pool.pool은 내부 mysql2 Pool
      const innerPool = (pool as any).pool;

      // 경로 1: pool.pool.config.connectionConfig.database
      if (innerPool?.config?.connectionConfig?.database) {
        return innerPool.config.connectionConfig.database;
      }

      // 경로 2: pool.pool.config.database
      if (innerPool?.config?.database) {
        return innerPool.config.database;
      }

      // 경로 3: pool 자체의 config
      if ((pool as any).config?.database) {
        return (pool as any).config.database;
      }

      return null;
    } catch {
      return null;
    }
  }
}
