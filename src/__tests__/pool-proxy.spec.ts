import { createPoolProxy, type PoolProxyContext } from '../pool-proxy';
import type { Pool, PoolConnection } from 'mysql2/promise';

function createMockConn(): PoolConnection {
  return {
    query: jest.fn(async () => [[], []]),
    execute: jest.fn(async () => [[], []]),
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  } as unknown as PoolConnection;
}

function createMockPool(): Pool {
  return {
    getConnection: jest.fn(),
    execute: jest.fn(),
    query: jest.fn(),
    end: jest.fn(),
  } as unknown as Pool;
}

describe('PoolProxy', () => {
  let pool: Pool;
  let conn: PoolConnection;
  let ctx: PoolProxyContext;

  beforeEach(() => {
    pool = createMockPool();
    conn = createMockConn();
    ctx = {
      conn,
      proxiedConn: conn,
      connOptions: { savepointPrefix: 'sp', enableLogging: false },
      enableLogging: false,
    };
  });

  describe('getConnection', () => {
    it('should return a proxied connection instead of real one', async () => {
      const proxy = createPoolProxy(pool, ctx);
      const result = await proxy.getConnection();

      // Should NOT call original pool.getConnection
      expect(pool.getConnection).not.toHaveBeenCalled();

      // Should return a proxy (has __isTestProxy marker)
      expect((result as any).__isTestProxy).toBe(true);
    });

    it('should return independent proxies on each call', async () => {
      const proxy = createPoolProxy(pool, ctx);
      const conn1 = await proxy.getConnection();
      const conn2 = await proxy.getConnection();

      // 각각 독립적인 savepointCount를 가져야 함
      await conn1.beginTransaction();
      expect((conn1 as any).__savepointCount).toBe(1);
      expect((conn2 as any).__savepointCount).toBe(0);
    });
  });

  describe('execute', () => {
    it('should delegate to test connection', async () => {
      const proxy = createPoolProxy(pool, ctx);
      await proxy.execute('SELECT 1');

      expect(conn.execute).toHaveBeenCalledWith('SELECT 1');
      expect(pool.execute).not.toHaveBeenCalled();
    });
  });

  describe('query', () => {
    it('should delegate to test connection', async () => {
      const proxy = createPoolProxy(pool, ctx);
      await proxy.query('SELECT 1');

      expect(conn.query).toHaveBeenCalledWith('SELECT 1');
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe('passthrough', () => {
    it('should pass through end() to original pool', async () => {
      const proxy = createPoolProxy(pool, ctx);
      await proxy.end();

      expect(pool.end).toHaveBeenCalled();
    });
  });

  describe('markers', () => {
    it('should expose __isTestPoolProxy', () => {
      const proxy = createPoolProxy(pool, ctx);
      expect((proxy as any).__isTestPoolProxy).toBe(true);
    });
  });
});
