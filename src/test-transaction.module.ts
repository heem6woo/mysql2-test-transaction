import { DynamicModule, Module, type Provider } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { TestTransactionHelper } from './test-transaction.helper';
import {
  type TestTransactionModuleOptions,
  resolveOptions,
} from './interfaces/module-options.interface';
import { createInternalTokens } from './interfaces/constants';

/**
 * NestJS 테스트 모듈에서 import하여 사용하는 DynamicModule.
 *
 * Pool을 DI에서 오버라이드하지 않고, pool 인스턴스의 getConnection/execute/query를
 * 런타임에 직접 패치하여 테스트 트랜잭션 안에서 실행되게 한다.
 *
 * Pool은 ModuleRef를 통해 lazy하게 resolve하므로 모듈 스코핑 문제가 없다.
 *
 * @example
 * ```typescript
 * const module = await Test.createTestingModule({
 *   imports: [
 *     TestTransactionModule.forRoot({ poolToken: 'MYSQL_POOL' }),
 *     YourAppModule,
 *   ],
 * }).compile();
 * ```
 */
@Module({})
export class TestTransactionModule {
  static forRoot(
    options: TestTransactionModuleOptions = {},
  ): DynamicModule {
    const resolved = resolveOptions(options);
    const tokens = createInternalTokens(resolved.poolToken);

    const optionsProvider: Provider = {
      provide: tokens.options,
      useValue: resolved,
    };

    // Helper uses ModuleRef to lazy-resolve the pool at runtime.
    // No compile-time dependency on poolToken.
    const helperProvider: Provider = {
      provide: tokens.helper,
      useFactory: (opts: any, moduleRef: ModuleRef) =>
        new TestTransactionHelper(opts, moduleRef),
      inject: [tokens.options, ModuleRef],
    };

    // Default class-based alias (backwards compatible: module.get(TestTransactionHelper))
    const classHelperProvider: Provider = {
      provide: TestTransactionHelper,
      useExisting: tokens.helper,
    };

    return {
      module: TestTransactionModule,
      providers: [
        optionsProvider,
        helperProvider,
        classHelperProvider,
      ],
      exports: [tokens.helper, TestTransactionHelper],
      global: true,
    };
  }
}
