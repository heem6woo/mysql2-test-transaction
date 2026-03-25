import type { Pool, PoolConnection } from 'mysql2/promise';
import type { ModuleRef } from '@nestjs/core';
import { SafetyGuard } from './safety-guard';
import { createConnectionProxy } from './connection-proxy';
import type { ResolvedOptions } from './interfaces/module-options.interface';

/**
 * 테스트 트랜잭션 라이프사이클을 관리하는 헬퍼.
 *
 * beforeEach에서 start()를 호출하면:
 *   1. 실제 커넥션을 획득하고 트랜잭션을 시작
 *   2. Pool의 getConnection/execute/query를 monkey-patch하여
 *      모든 쿼리가 이 트랜잭션 안에서 실행되게 함
 *
 * afterEach에서 rollback()을 호출하면:
 *   1. 트랜잭션을 롤백하여 모든 변경사항 원복
 *   2. Pool의 원래 메서드를 복원
 *
 * Pool은 ModuleRef를 통해 lazy하게 resolve되므로 모듈 스코핑 문제가 없다.
 *
 * @example
 * ```typescript
 * beforeEach(() => txHelper.start());
 * afterEach(() => txHelper.rollback());
 * ```
 */
export class TestTransactionHelper {
  private pool: Pool | null = null;
  private conn: PoolConnection | null = null;
  private proxiedConn: PoolConnection | null = null;
  private _isActive = false;
  private validated = false;

  // Original pool methods saved for restore
  private originalGetConnection: Pool['getConnection'] | null = null;
  private originalExecute: Pool['execute'] | null = null;
  private originalQuery: Pool['query'] | null = null;

  constructor(
    private readonly options: ResolvedOptions,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Lazily resolves the pool from the global NestJS container.
   * Using ModuleRef.get with strict: false finds the pool across all modules,
   * avoiding compile-time module scoping issues.
   */
  private resolvePool(): Pool {
    if (!this.pool) {
      this.pool = this.moduleRef.get<Pool>(this.options.poolToken, { strict: false });
    }
    return this.pool!;
  }

  /**
   * 테스트 트랜잭션을 시작한다.
   * beforeEach에서 호출할 것.
   */
  async start(): Promise<void> {
    if (this._isActive) {
      throw new Error(
        '[TestTransaction] Transaction already active. ' +
          'Did you forget to call rollback() in afterEach?',
      );
    }

    const pool = this.resolvePool();

    // 첫 호출 시에만 SafetyGuard 검증
    if (!this.validated) {
      SafetyGuard.validate(pool, this.options);
      this.validated = true;
    }

    this.log('Starting test transaction...');

    // 1. 실제 커넥션 획득 + 트랜잭션 시작
    this.conn = await pool.getConnection();
    await this.conn.beginTransaction();

    // 2. Proxied connection 생성
    this.proxiedConn = createConnectionProxy(this.conn, {
      savepointPrefix: this.options.savepointPrefix,
      enableLogging: this.options.enableLogging,
    });

    // 3. Pool 메서드를 monkey-patch하여 모든 호출이 테스트 트랜잭션을 사용하게 함
    this.originalGetConnection = pool.getConnection.bind(pool);
    this.originalExecute = pool.execute.bind(pool);
    this.originalQuery = pool.query.bind(pool);

    const connOptions = {
      savepointPrefix: this.options.savepointPrefix,
      enableLogging: this.options.enableLogging,
    };
    const conn = this.conn;

    (pool as any).getConnection = async (): Promise<PoolConnection> => {
      this.log('getConnection() → returning proxied connection');
      // 매번 새 proxy를 만들어야 savepointCount가 독립적
      return createConnectionProxy(conn, connOptions);
    };

    (pool as any).execute = async (...args: any[]) => {
      this.log('execute() → delegating to test connection');
      return conn.execute(...(args as [any]));
    };

    (pool as any).query = async (...args: any[]) => {
      this.log('query() → delegating to test connection');
      return conn.query(...(args as [any]));
    };

    this._isActive = true;
    this.log('Test transaction started.');
  }

  /**
   * 테스트 트랜잭션을 롤백한다.
   * afterEach에서 호출할 것.
   */
  async rollback(): Promise<void> {
    if (!this._isActive || !this.conn) {
      this.log('No active transaction to rollback.');
      return;
    }

    this.log('Rolling back test transaction...');

    const pool = this.resolvePool();

    try {
      await this.conn.rollback();
    } catch (err) {
      this.log(`Rollback error (non-fatal): ${err}`);
    }

    try {
      this.conn.release();
    } catch (err) {
      this.log(`Release error (non-fatal): ${err}`);
    }

    // Pool 원래 메서드 복원
    if (this.originalGetConnection) {
      (pool as any).getConnection = this.originalGetConnection;
    }
    if (this.originalExecute) {
      (pool as any).execute = this.originalExecute;
    }
    if (this.originalQuery) {
      (pool as any).query = this.originalQuery;
    }

    this.conn = null;
    this.proxiedConn = null;
    this.originalGetConnection = null;
    this.originalExecute = null;
    this.originalQuery = null;
    this._isActive = false;

    this.log('Test transaction rolled back.');
  }

  /**
   * 현재 테스트 트랜잭션의 커넥션을 반환한다.
   * 테스트 코드에서 직접 쿼리를 실행할 때 사용.
   */
  getConnection(): PoolConnection {
    if (!this._isActive || !this.proxiedConn) {
      throw new Error(
        '[TestTransaction] No active transaction. Call start() first.',
      );
    }
    return this.proxiedConn;
  }

  /**
   * 현재 테스트 트랜잭션의 실제(raw) 커넥션을 반환한다.
   * Proxy를 거치지 않으므로 주의.
   */
  getRawConnection(): PoolConnection {
    if (!this._isActive || !this.conn) {
      throw new Error(
        '[TestTransaction] No active transaction. Call start() first.',
      );
    }
    return this.conn;
  }

  /**
   * 트랜잭션 활성 상태 확인
   */
  get isActive(): boolean {
    return this._isActive;
  }

  private log(msg: string): void {
    if (this.options.enableLogging) {
      console.log(`[TestTransaction] ${msg}`);
    }
  }
}
