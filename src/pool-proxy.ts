import type { Pool, PoolConnection } from 'mysql2/promise';
import {
  createConnectionProxy,
  type ConnectionProxyOptions,
} from './connection-proxy';

export interface PoolProxyContext {
  /** 테스트 트랜잭션이 실행 중인 실제 커넥션 */
  conn: PoolConnection;
  /** Proxy로 래핑된 커넥션 (외부에 노출) */
  proxiedConn: PoolConnection;
  /** ConnectionProxy 옵션 */
  connOptions: ConnectionProxyOptions;
  /** 로깅 활성화 여부 */
  enableLogging: boolean;
}

/**
 * Pool 객체를 ES Proxy로 감싸서:
 * - getConnection() → 항상 같은 proxied connection 반환
 * - execute() / query() → 테스트 트랜잭션 커넥션에서 실행
 *
 * 이를 통해 서비스 코드가 Pool에서 새 커넥션을 얻어도
 * 실제로는 테스트 트랜잭션 안에서 실행된다.
 */
export function createPoolProxy(pool: Pool, ctx: PoolProxyContext): Pool {
  const log = (msg: string) => {
    if (ctx.enableLogging) {
      console.log(`[TestTransaction:Pool] ${msg}`);
    }
  };

  return new Proxy(pool, {
    get(target, prop, receiver) {
      if (prop === 'getConnection') {
        return async (): Promise<PoolConnection> => {
          log('getConnection() → returning proxied connection');
          // 매번 새 proxy를 만들어야 savepointCount가 독립적
          return createConnectionProxy(ctx.conn, ctx.connOptions);
        };
      }

      if (prop === 'execute') {
        return async (...args: any[]) => {
          log(`execute() → delegating to test connection`);
          return ctx.conn.execute(...(args as [any]));
        };
      }

      if (prop === 'query') {
        return async (...args: any[]) => {
          log(`query() → delegating to test connection`);
          return ctx.conn.query(...(args as [any]));
        };
      }

      if (prop === '__isTestPoolProxy') {
        return true;
      }

      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  });
}
