export interface TestTransactionModuleOptions {
  /**
   * NestJS IoC에 등록된 mysql2 Pool의 injection token
   * @default 'MYSQL_POOL'
   */
  poolToken?: string | symbol;

  /**
   * Savepoint 이름 prefix
   * @default 'sp'
   */
  savepointPrefix?: string;

  /**
   * 트랜잭션/세이브포인트 SQL 로깅 활성화
   * @default false
   */
  enableLogging?: boolean;
}

export interface ResolvedOptions {
  poolToken: string | symbol;
  savepointPrefix: string;
  enableLogging: boolean;
}

export function resolveOptions(
  opts: TestTransactionModuleOptions = {},
): ResolvedOptions {
  return {
    poolToken: opts.poolToken ?? 'MYSQL_POOL',
    savepointPrefix: opts.savepointPrefix ?? 'sp',
    enableLogging: opts.enableLogging ?? false,
  };
}
