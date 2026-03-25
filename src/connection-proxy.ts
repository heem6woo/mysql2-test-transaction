import type { PoolConnection } from 'mysql2/promise';

export interface ConnectionProxyOptions {
  savepointPrefix: string;
  enableLogging: boolean;
}

/**
 * PoolConnection을 ES Proxy로 감싸서
 * beginTransaction/commit/rollback을 Savepoint 연산으로 변환한다.
 *
 * 이를 통해 서비스 코드의 트랜잭션이 테스트 트랜잭션 내부의
 * Savepoint로 동작하게 되어, 테스트 종료 시 전체 롤백이 가능하다.
 */
export function createConnectionProxy(
  realConn: PoolConnection,
  options: ConnectionProxyOptions,
): PoolConnection {
  let savepointCount = 0;

  const log = (msg: string) => {
    if (options.enableLogging) {
      console.log(`[TestTransaction] ${msg}`);
    }
  };

  return new Proxy(realConn, {
    get(target, prop, receiver) {
      if (prop === 'beginTransaction') {
        return async () => {
          savepointCount++;
          const name = `${options.savepointPrefix}_${savepointCount}`;
          log(`SAVEPOINT ${name}`);
          await target.query(`SAVEPOINT ${name}`);
        };
      }

      if (prop === 'commit') {
        return async () => {
          if (savepointCount <= 0) {
            log('commit() called but no active savepoint — ignoring');
            return;
          }
          const name = `${options.savepointPrefix}_${savepointCount}`;
          log(`RELEASE SAVEPOINT ${name}`);
          await target.query(`RELEASE SAVEPOINT ${name}`);
          savepointCount--;
        };
      }

      if (prop === 'rollback') {
        return async () => {
          if (savepointCount <= 0) {
            log('rollback() called but no active savepoint — ignoring');
            return;
          }
          const name = `${options.savepointPrefix}_${savepointCount}`;
          log(`ROLLBACK TO SAVEPOINT ${name}`);
          await target.query(`ROLLBACK TO SAVEPOINT ${name}`);
          savepointCount--;
        };
      }

      if (prop === 'release') {
        return () => {
          log('release() intercepted — no-op');
          // no-op: 테스트 트랜잭션이 끝날 때까지 커넥션 유지
        };
      }

      // __isTestProxy: 디버깅/테스트용 마커
      if (prop === '__isTestProxy') {
        return true;
      }

      if (prop === '__savepointCount') {
        return savepointCount;
      }

      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  });
}
