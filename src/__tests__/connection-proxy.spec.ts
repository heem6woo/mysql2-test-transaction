import { createConnectionProxy } from '../connection-proxy';
import type { PoolConnection } from 'mysql2/promise';

function createMockConnection(): {
  conn: PoolConnection;
  queries: string[];
} {
  const queries: string[] = [];

  const conn = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      return [[], []];
    }),
    execute: jest.fn(async (sql: string, values?: any[]) => {
      queries.push(sql);
      return [[], []];
    }),
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  } as unknown as PoolConnection;

  return { conn, queries };
}

describe('ConnectionProxy', () => {
  const defaultOptions = {
    savepointPrefix: 'sp',
    enableLogging: false,
  };

  describe('beginTransaction', () => {
    it('should create a SAVEPOINT instead of BEGIN', async () => {
      const { conn, queries } = createMockConnection();
      const proxy = createConnectionProxy(conn, defaultOptions);

      await proxy.beginTransaction();

      expect(queries).toEqual(['SAVEPOINT sp_1']);
      expect(conn.beginTransaction).not.toHaveBeenCalled();
    });

    it('should increment savepoint count on nested calls', async () => {
      const { conn, queries } = createMockConnection();
      const proxy = createConnectionProxy(conn, defaultOptions);

      await proxy.beginTransaction();
      await proxy.beginTransaction();

      expect(queries).toEqual(['SAVEPOINT sp_1', 'SAVEPOINT sp_2']);
    });
  });

  describe('commit', () => {
    it('should RELEASE SAVEPOINT instead of COMMIT', async () => {
      const { conn, queries } = createMockConnection();
      const proxy = createConnectionProxy(conn, defaultOptions);

      await proxy.beginTransaction();
      await proxy.commit();

      expect(queries).toEqual(['SAVEPOINT sp_1', 'RELEASE SAVEPOINT sp_1']);
    });

    it('should handle nested commit in correct order', async () => {
      const { conn, queries } = createMockConnection();
      const proxy = createConnectionProxy(conn, defaultOptions);

      await proxy.beginTransaction(); // sp_1
      await proxy.beginTransaction(); // sp_2
      await proxy.commit(); // release sp_2
      await proxy.commit(); // release sp_1

      expect(queries).toEqual([
        'SAVEPOINT sp_1',
        'SAVEPOINT sp_2',
        'RELEASE SAVEPOINT sp_2',
        'RELEASE SAVEPOINT sp_1',
      ]);
    });

    it('should be no-op when no active savepoint', async () => {
      const { conn, queries } = createMockConnection();
      const proxy = createConnectionProxy(conn, defaultOptions);

      await proxy.commit();

      expect(queries).toEqual([]);
    });
  });

  describe('rollback', () => {
    it('should ROLLBACK TO SAVEPOINT instead of ROLLBACK', async () => {
      const { conn, queries } = createMockConnection();
      const proxy = createConnectionProxy(conn, defaultOptions);

      await proxy.beginTransaction();
      await proxy.rollback();

      expect(queries).toEqual([
        'SAVEPOINT sp_1',
        'ROLLBACK TO SAVEPOINT sp_1',
      ]);
    });

    it('should be no-op when no active savepoint', async () => {
      const { conn, queries } = createMockConnection();
      const proxy = createConnectionProxy(conn, defaultOptions);

      await proxy.rollback();

      expect(queries).toEqual([]);
    });
  });

  describe('release', () => {
    it('should be a no-op', () => {
      const { conn } = createMockConnection();
      const proxy = createConnectionProxy(conn, defaultOptions);

      proxy.release();

      expect(conn.release).not.toHaveBeenCalled();
    });
  });

  describe('passthrough', () => {
    it('should delegate execute() to real connection', async () => {
      const { conn } = createMockConnection();
      const proxy = createConnectionProxy(conn, defaultOptions);

      await proxy.execute('SELECT 1');

      expect(conn.execute).toHaveBeenCalledWith('SELECT 1');
    });

    it('should delegate query() to real connection', async () => {
      const { conn } = createMockConnection();
      const proxy = createConnectionProxy(conn, defaultOptions);

      await proxy.query('SELECT 1');

      expect(conn.query).toHaveBeenCalledWith('SELECT 1');
    });
  });

  describe('markers', () => {
    it('should expose __isTestProxy', () => {
      const { conn } = createMockConnection();
      const proxy = createConnectionProxy(conn, defaultOptions);

      expect((proxy as any).__isTestProxy).toBe(true);
    });

    it('should expose __savepointCount', async () => {
      const { conn } = createMockConnection();
      const proxy = createConnectionProxy(conn, defaultOptions);

      expect((proxy as any).__savepointCount).toBe(0);
      await proxy.beginTransaction();
      expect((proxy as any).__savepointCount).toBe(1);
    });
  });

  describe('custom prefix', () => {
    it('should use custom savepoint prefix', async () => {
      const { conn, queries } = createMockConnection();
      const proxy = createConnectionProxy(conn, {
        savepointPrefix: 'test',
        enableLogging: false,
      });

      await proxy.beginTransaction();

      expect(queries).toEqual(['SAVEPOINT test_1']);
    });
  });
});
