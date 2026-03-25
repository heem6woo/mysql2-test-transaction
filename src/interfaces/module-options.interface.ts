export interface TestTransactionModuleOptions {
  /**
   * NestJS IoC에 등록된 mysql2 Pool의 injection token
   * @default 'MYSQL_POOL'
   */
  poolToken?: string | symbol;

  /**
   * DB 이름에 반드시 포함되어야 하는 문자열.
   * 미포함 시 SafetyGuard가 에러를 발생시킨다.
   * @default 'test'
   */
  dbNameMustInclude?: string;

  /**
   * 허용되는 NODE_ENV 값 목록.
   * 불일치 시 SafetyGuard가 에러를 발생시킨다.
   * @default ['test']
   */
  allowedNodeEnv?: string[];

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
  dbNameMustInclude: string;
  allowedNodeEnv: string[];
  savepointPrefix: string;
  enableLogging: boolean;
}

export function resolveOptions(
  opts: TestTransactionModuleOptions = {},
): ResolvedOptions {
  return {
    poolToken: opts.poolToken ?? 'MYSQL_POOL',
    dbNameMustInclude: opts.dbNameMustInclude ?? 'test',
    allowedNodeEnv: opts.allowedNodeEnv ?? ['test'],
    savepointPrefix: opts.savepointPrefix ?? 'sp',
    enableLogging: opts.enableLogging ?? false,
  };
}
