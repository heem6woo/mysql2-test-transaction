# mysql2-test-transaction

NestJS + mysql2 환경에서 Spring `@Transactional` 스타일의 테스트 트랜잭션 자동 롤백을 제공하는 모듈입니다.

**프로덕션 코드 수정 없이**, 각 테스트 케이스를 트랜잭션으로 감싸고 테스트 종료 시 자동으로 롤백합니다.

## 주요 특징

- **Zero Code Change**: 기존 서비스/레포지토리 코드 수정 없이 적용
- **Monkey-Patch**: Pool의 `getConnection()`/`execute()`/`query()`를 런타임 패치하여 모든 쿼리를 테스트 트랜잭션으로 라우팅
- **Savepoint Nesting**: 서비스 내부 트랜잭션을 Savepoint로 변환하여 롤백 가능하게 처리
- **Multi-Pool 지원**: `forRoot()`을 여러 번 호출하여 서로 다른 Pool을 독립적으로 관리 가능

## 설치

```bash
npm install --save-dev mysql2-test-transaction
```

또는 로컬 빌드 사용:

```bash
# 이 프로젝트에서
npm run build && npm pack

# 다른 프로젝트에서
npm install --save-dev /path/to/mysql2-test-transaction-1.0.0.tgz
```

## 빠른 시작

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import {
  TestTransactionModule,
  TestTransactionHelper,
} from 'mysql2-test-transaction';

describe('PaymentService', () => {
  let moduleRef: TestingModule;
  let txHelper: TestTransactionHelper;
  let paymentService: PaymentService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TestTransactionModule.forRoot({
          poolToken: 'MYSQL_POOL', // 앱에서 사용하는 Pool injection token
        }),
        PaymentModule,
      ],
    }).compile();

    txHelper = moduleRef.get(TestTransactionHelper);
    paymentService = moduleRef.get(PaymentService);
  });

  beforeEach(() => txHelper.start());
  afterEach(() => txHelper.rollback());
  afterAll(() => moduleRef.close());

  it('결제를 처리한다', async () => {
    // 기존 서비스 코드 그대로 호출 - 코드 수정 불필요
    await paymentService.processPayment({ amount: 1000 });

    // 테스트 트랜잭션 커넥션으로 직접 검증
    const conn = txHelper.getConnection();
    const [rows] = await conn.execute('SELECT * FROM payments');
    expect((rows as any[]).length).toBe(1);
  });
  // afterEach에서 자동 롤백 -> DB 깨끗
});
```

## 동작 원리

### 핵심 메커니즘: Pool Monkey-Patch + Connection Proxy

이 모듈은 NestJS DI를 오버라이드하지 않습니다. 대신 Pool **인스턴스 자체의 메서드**를 런타임에 교체합니다.

NestJS DI 컨테이너에서 서비스들이 주입받는 Pool 객체는 **모두 같은 참조**입니다. 따라서 이 인스턴스의 메서드를 교체하면 해당 Pool을 사용하는 모든 서비스가 자동으로 테스트 트랜잭션을 통과하게 됩니다.

```
┌─ Pool 인스턴스 (모든 서비스가 공유하는 동일 참조) ─────────────┐
│                                                                │
│  평상시:                                                        │
│    getConnection() → 원본 구현 (새 커넥션 반환)                  │
│    execute()       → 원본 구현                                  │
│    query()         → 원본 구현                                  │
│                                                                │
│  start() 호출 후:                                               │
│    getConnection() → [패치됨] Proxied Connection 반환            │
│    execute()       → [패치됨] 테스트 트랜잭션 커넥션으로 위임      │
│    query()         → [패치됨] 테스트 트랜잭션 커넥션으로 위임      │
│                                                                │
│  rollback() 호출 후:                                            │
│    getConnection() → 원본 복원                                  │
│    execute()       → 원본 복원                                  │
│    query()         → 원본 복원                                  │
└────────────────────────────────────────────────────────────────┘
```

### Pool Resolve: ModuleRef Lazy Resolution

Pool 참조는 NestJS의 `ModuleRef.get(token, { strict: false })`를 사용하여 **런타임에 lazy하게** resolve합니다.

```
compile 시점:  TestTransactionModule은 poolToken에 의존하지 않음 (DI 사이클 없음)
start() 시점:  ModuleRef로 전체 IoC 컨테이너에서 poolToken을 찾아 resolve
```

이 방식은 NestJS 모듈 스코핑 제약을 완전히 우회합니다. `TestTransactionModule`이 어느 위치에 import되든, 전역 컨테이너에서 Pool을 찾을 수 있습니다.

### 테스트 라이프사이클

```
beforeEach (txHelper.start())
  │
  ├─ 1. Pool에서 실제 커넥션 획득
  ├─ 2. BEGIN TRANSACTION
  ├─ 3. Connection Proxy 생성 (beginTransaction/commit/rollback → SAVEPOINT 변환)
  └─ 4. Pool.getConnection/execute/query를 패치 (모든 호출이 이 커넥션으로 라우팅)
  │
  ├─ 서비스 코드: pool.getConnection() → Proxy Connection 반환
  ├─ 서비스 코드: conn.beginTransaction() → SAVEPOINT sp_1
  ├─ 서비스 코드: INSERT, UPDATE ...
  ├─ 서비스 코드: conn.commit() → RELEASE SAVEPOINT sp_1
  └─ 서비스 코드: conn.release() → no-op (커넥션 유지)
  │
afterEach (txHelper.rollback())
  │
  ├─ 1. ROLLBACK (전체 원복)
  ├─ 2. 커넥션 release
  └─ 3. Pool 원래 메서드 복원
```

### Savepoint 중첩 처리

서비스 코드 내에서 중첩 트랜잭션이 발생하면, Connection Proxy가 이를 SAVEPOINT로 자동 변환합니다:

```
실제 BEGIN TRANSACTION              ← txHelper.start()
  ├─ SAVEPOINT sp_1                 ← 서비스 A: conn.beginTransaction()
  │   ├─ SAVEPOINT sp_2             ← 서비스 B: conn.beginTransaction() (중첩)
  │   │   └─ INSERT INTO ...
  │   ├─ RELEASE SAVEPOINT sp_2     ← 서비스 B: conn.commit()
  │   └─ UPDATE ...
  ├─ RELEASE SAVEPOINT sp_1         ← 서비스 A: conn.commit()
ROLLBACK                           ← txHelper.rollback() (전체 롤백)
```

각 `getConnection()` 호출은 독립적인 savepoint 카운터를 가진 새 Proxy를 반환합니다. 따라서 서비스 A와 서비스 B가 각각 `getConnection()`을 호출해도 savepoint 넘버링이 충돌하지 않습니다.

## API

### TestTransactionModule.forRoot(options?)

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `poolToken` | `string \| symbol` | `'MYSQL_POOL'` | mysql2 Pool injection token |
| `savepointPrefix` | `string` | `'sp'` | Savepoint 이름 prefix |
| `enableLogging` | `boolean` | `false` | SQL 로깅 활성화 |

### TestTransactionHelper

| 메서드 | 설명 |
|--------|------|
| `start(): Promise<void>` | 테스트 트랜잭션 시작. `beforeEach`에서 호출 |
| `rollback(): Promise<void>` | 트랜잭션 롤백 + Pool 복원. `afterEach`에서 호출 |
| `getConnection(): PoolConnection` | 현재 테스트 트랜잭션의 프록시 커넥션 반환 |
| `getRawConnection(): PoolConnection` | 프록시를 거치지 않은 실제 커넥션 반환 |
| `isActive: boolean` | 트랜잭션 활성 상태 확인 |

### getTestTransactionHelperToken(poolToken)

Multi-pool 환경에서 특정 Pool에 바인딩된 helper를 가져올 때 사용합니다.

```typescript
import {
  TestTransactionHelper,
  getTestTransactionHelperToken,
} from 'mysql2-test-transaction';

const clientHelper = moduleRef.get<TestTransactionHelper>(
  getTestTransactionHelperToken(ClientPoolToken),
);
```

## Multi-Pool 지원

도메인 분리 아키텍처 등에서 여러 Pool을 사용하는 경우, `forRoot()`을 Pool별로 호출합니다.

내부 토큰이 `poolToken` 기준으로 네임스페이싱되므로 서로 충돌하지 않습니다.

```typescript
const moduleRef = await Test.createTestingModule({
  imports: [
    TestTransactionModule.forRoot({ poolToken: ClientPoolToken }),
    TestTransactionModule.forRoot({ poolToken: ManagerPoolToken }),
    AppModule,
  ],
}).compile();

const clientTx = moduleRef.get<TestTransactionHelper>(
  getTestTransactionHelperToken(ClientPoolToken),
);
const managerTx = moduleRef.get<TestTransactionHelper>(
  getTestTransactionHelperToken(ManagerPoolToken),
);

beforeEach(async () => {
  await clientTx.start();
  await managerTx.start();
});

afterEach(async () => {
  await clientTx.rollback();
  await managerTx.rollback();
});
```

> **참고**: `module.get(TestTransactionHelper)` (클래스 토큰)은 마지막으로 등록된 helper를 반환합니다. Multi-pool에서는 반드시 `getTestTransactionHelperToken()`을 사용하세요.

## 제약사항

| 제약사항 | 설명 |
|----------|------|
| **Jest `--runInBand` 필수** | 병렬 실행 시 커넥션 공유 충돌 발생 |
| **DDL 롤백 불가** | MySQL CREATE/ALTER TABLE 등은 암묵적 커밋 발생 |
| **AUTO_INCREMENT** | 롤백되어도 카운터는 복원되지 않음 |
| **단일 커넥션** | 멀티 커넥션 시나리오(데드락 등) 테스트 불가 |

## 로컬 개발

```bash
# 의존성 설치
npm install

# 테스트
npm test

# 빌드
npm run build

# 다른 프로젝트에서 로컬 사용
npm pack  # mysql2-test-transaction-1.0.0.tgz 생성
```

## Peer Dependencies

- `@nestjs/common` >= 9.0.0
- `@nestjs/core` >= 9.0.0
- `@nestjs/testing` >= 9.0.0
- `mysql2` >= 3.0.0

## License

UNLICENSED
