# NestJS MySQL 테스트 트랜잭션 모듈

> `@point3/nestjs-mysql-test-transaction`

| 항목 | 내용 |
|------|------|
| 버전 | 1.0.0 |
| 작성일 | 2026-03-25 |
| 작성자 | Backend Team |
| 상태 | Draft |
| 대상 스택 | NestJS + mysql2/promise |

---

## 1. 개요

### 1.1 배경 및 문제점

현재 NestJS + mysql2 환경에서 Repository 통합 테스트 시 데이터베이스 초기화에 다음과 같은 위험이 존재한다.

- TRUNCATE 기반 초기화 코드가 환경변수 설정 오류로 운영 DB에 실행될 가능성
- 테스트 간 데이터 격리가 보장되지 않아 테스트 순서에 따른 비결정적 실패 발생
- 수동 cleanup 로직의 유지보수 비용 및 누락 위험

### 1.2 목표

Spring Framework의 `@Transactional` 테스트 롤백 패턴을 NestJS + mysql2 환경에 이식하여, **프로덕션 코드 수정 없이** 테스트 데이터를 자동 롤백하는 모듈을 제공한다.

### 1.3 설계 원칙

| 원칙 | 설명 |
|------|------|
| **Zero Code Change** | 기존 서비스/레포지토리 코드 수정 없이 적용 가능 |
| **Safety First** | 운영 DB 접속 시 자동 차단, 테스트 DB 네이밍 강제 |
| **Transparent Proxy** | Pool을 Proxy로 감싸 기존 `getConnection()` 흐름 유지 |
| **Savepoint Nesting** | 서비스 내부 트랜잭션을 Savepoint로 변환하여 롤백 가능하게 처리 |

---

## 2. 아키텍처

### 2.1 모듈 구성

| 컴포넌트 | 역할 |
|----------|------|
| **TestTransactionModule** | NestJS DynamicModule. 테스트 모듈에 import하여 사용 |
| **TestTransactionHelper** | 트랜잭션 시작/롤백 관리, Pool Proxy 생성 |
| **PoolProxy** | ES Proxy 기반. `getConnection()`이 래핑된 커넥션 반환 |
| **ConnectionProxy** | `beginTransaction` → SAVEPOINT, `commit` → RELEASE, `rollback` → ROLLBACK TO |
| **SafetyGuard** | DB 이름 검증, NODE_ENV 검증, 운영 DB 접속 차단 |

### 2.2 동작 흐름

각 테스트 케이스의 실행 흐름은 다음과 같다.

```
beforeEach:
  1. TestTransactionHelper.start()
  2. pool.getConnection() → 실제 커넥션 획득
  3. BEGIN TRANSACTION (실제 트랜잭션)
  4. Pool을 Proxy로 교체

테스트 실행:
  5. Service: pool.getConnection() → Proxy가 래핑된 conn 반환
  6. Service: conn.beginTransaction() → SAVEPOINT sp_1
  7. Service: INSERT, UPDATE, DELETE ...
  8. Service: conn.commit() → RELEASE SAVEPOINT sp_1
  9. Service: conn.release() → no-op (무시)

afterEach:
  10. TestTransactionHelper.rollback()
  11. ROLLBACK (전체 트랜잭션 롤백 → 모든 변경 원복)
  12. conn.release() (실제 커넥션 반환)
  13. Proxy 해제, 원래 Pool 복원
```

### 2.3 Savepoint 중첩 처리

서비스 코드 내에서 중첩 트랜잭션이 발생하는 경우, `savepointCount`를 증가시키며 고유한 savepoint 이름을 생성한다.

```
실제 BEGIN TRANSACTION          ← 테스트 헬퍼
  ├─ SAVEPOINT sp_1               ← 서비스 A: beginTransaction()
  │   ├─ SAVEPOINT sp_2           ← 서비스 B: beginTransaction() (중첩)
  │   │   └─ INSERT INTO ...
  │   ├─ RELEASE SAVEPOINT sp_2   ← 서비스 B: commit()
  │   └─ UPDATE ...
  ├─ RELEASE SAVEPOINT sp_1       ← 서비스 A: commit()
ROLLBACK                         ← 테스트 헬퍼: 전체 롤백
```

---

## 3. API 설계

### 3.1 TestTransactionModule

NestJS DynamicModule로 제공되며, `forRoot()`를 통해 설정한다.

```typescript
// test-setup.ts
import { TestTransactionModule } from '@point3/nestjs-mysql-test-transaction';

const module = await Test.createTestingModule({
  imports: [
    TestTransactionModule.forRoot({
      poolToken: 'MYSQL_POOL',        // Pool이 등록된 injection token
      dbNameMustInclude: 'test',       // DB 이름에 반드시 포함되어야 하는 문자열
      allowedNodeEnv: ['test'],         // 허용된 NODE_ENV 값 목록
    }),
    // ... 기존 모듈들
  ],
}).compile();
```

### 3.2 TestTransactionHelper

```typescript
class TestTransactionHelper {
  start(): Promise<void>
    // Pool Proxy 활성화 + 트랜잭션 시작

  rollback(): Promise<void>
    // 트랜잭션 롤백 + Pool Proxy 해제

  getConnection(): PoolConnection
    // 현재 테스트 트랜잭션의 래핑된 커넥션 반환

  isActive(): boolean
    // 트랜잭션 활성 상태 확인
}
```

### 3.3 forRoot Options

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| **poolToken** | `string \| symbol` | `'MYSQL_POOL'` | NestJS IoC에 등록된 mysql2 Pool의 injection token |
| **dbNameMustInclude** | `string` | `'test'` | DB 이름에 반드시 포함되어야 하는 문자열. 미포함 시 에러 |
| **allowedNodeEnv** | `string[]` | `['test']` | 허용되는 NODE_ENV 값 목록. 불일치 시 에러 |
| **savepointPrefix** | `string` | `'sp'` | Savepoint 이름 prefix (sp_1, sp_2, ...) |
| **enableLogging** | `boolean` | `false` | 트랜잭션/세이브포인트 SQL 로깅 활성화 |

### 3.4 사용 예시 (전체)

```typescript
describe('PaymentRepository', () => {
  let app: TestingModule;
  let txHelper: TestTransactionHelper;
  let paymentService: PaymentService;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [
        TestTransactionModule.forRoot({ poolToken: 'MYSQL_POOL' }),
        PaymentModule,
      ],
    }).compile();

    txHelper = app.get(TestTransactionHelper);
    paymentService = app.get(PaymentService);
  });

  beforeEach(() => txHelper.start());
  afterEach(() => txHelper.rollback());
  afterAll(() => app.close());

  it('should process payment', async () => {
    // 기존 서비스 코드 그대로 호출 - 코드 수정 불필요
    await paymentService.processPayment({ amount: 1000 });

    const conn = txHelper.getConnection();
    const [rows] = await conn.execute('SELECT * FROM payments');
    expect((rows as any[]).length).toBe(1);
  });
  // afterEach에서 전부 롤백 → DB 원복
});
```

---

## 4. 핵심 구현 명세

### 4.1 SafetyGuard

모듈 초기화 시 다음 검증을 수행하며, 하나라도 실패하면 에러를 발생시켜 테스트 실행을 차단한다.

```typescript
class SafetyGuard {
  static validate(pool: Pool, options: ModuleOptions): void {
    // 1. NODE_ENV 검증
    const env = process.env.NODE_ENV;
    if (!options.allowedNodeEnv.includes(env)) {
      throw new Error(
        `[SafetyGuard] NODE_ENV="${env}" is not allowed. `
        + `Allowed: ${options.allowedNodeEnv.join(', ')}`
      );
    }

    // 2. DB 이름 검증
    const dbName = (pool.pool?.config?.connectionConfig?.database
      ?? '') as string;
    if (!dbName.includes(options.dbNameMustInclude)) {
      throw new Error(
        `[SafetyGuard] Database "${dbName}" does not include `
        + `"${options.dbNameMustInclude}". Refusing to run.`
      );
    }
  }
}
```

### 4.2 ConnectionProxy

ES Proxy를 사용하여 PoolConnection의 트랜잭션 메서드를 Savepoint 연산으로 교체한다.

| 원래 메서드 | Proxy 동작 | 실행 SQL |
|-------------|-----------|----------|
| `beginTransaction()` | Savepoint 생성 | `SAVEPOINT sp_N` |
| `commit()` | Savepoint 해제 | `RELEASE SAVEPOINT sp_N` |
| `rollback()` | Savepoint 롤백 | `ROLLBACK TO SAVEPOINT sp_N` |
| `release()` | 무시 (no-op) | - |

### 4.3 PoolProxy

Pool 객체를 Proxy로 감싸서 다음 메서드를 인터셉트한다.

- **`getConnection()`**: ConnectionProxy로 래핑된 커넥션 반환
- **`execute()` / `query()`**: 테스트 트랜잭션 커넥션을 통해 실행

---

## 5. 프로젝트 구조

```
@point3/nestjs-mysql-test-transaction/
├── src/
│   ├── index.ts                        # Public exports
│   ├── test-transaction.module.ts       # DynamicModule (forRoot)
│   ├── test-transaction.helper.ts       # 트랜잭션 시작/롤백 관리
│   ├── pool-proxy.ts                    # Pool ES Proxy
│   ├── connection-proxy.ts              # Connection ES Proxy
│   ├── safety-guard.ts                  # 환경 검증
│   ├── interfaces/
│   │   ├── module-options.interface.ts  # forRoot 옵션 타입
│   │   └── constants.ts                # Injection tokens
│   └── __tests__/
│       ├── safety-guard.spec.ts
│       ├── connection-proxy.spec.ts
│       ├── pool-proxy.spec.ts
│       └── integration.spec.ts
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── jest.config.ts
└── README.md
```

---

## 6. 개발 태스크 및 일정

### 6.1 Phase 1: Core (예상 3일)

| # | 태스크 | 우선순위 | 예상 | 상태 |
|---|--------|---------|------|------|
| 1 | 프로젝트 초기 셋업 (package.json, tsconfig, jest) | P0 | 0.5d | TODO |
| 2 | SafetyGuard 구현 + 단위 테스트 | P0 | 0.5d | TODO |
| 3 | ConnectionProxy 구현 (Savepoint 변환) | P0 | 0.5d | TODO |
| 4 | PoolProxy 구현 (getConnection/execute/query 인터셉트) | P0 | 0.5d | TODO |
| 5 | TestTransactionHelper 구현 | P0 | 0.5d | TODO |
| 6 | TestTransactionModule (DynamicModule) 구현 | P0 | 0.5d | TODO |

### 6.2 Phase 2: Testing & Validation (예상 2일)

| # | 태스크 | 우선순위 | 예상 | 상태 |
|---|--------|---------|------|------|
| 7 | 실제 MySQL 컨테이너 기반 통합 테스트 | P0 | 0.5d | TODO |
| 8 | 중첩 트랜잭션 시나리오 테스트 | P0 | 0.5d | TODO |
| 9 | SafetyGuard 엣지 케이스 (잘못된 env, prod DB명 등) | P1 | 0.5d | TODO |
| 10 | 기존 프로젝트 서비스에 적용 검증 | P0 | 0.5d | TODO |

### 6.3 Phase 3: Documentation & Release (예상 1일)

| # | 태스크 | 우선순위 | 예상 | 상태 |
|---|--------|---------|------|------|
| 11 | README.md 작성 (사용법, 예제, FAQ) | P1 | 0.5d | TODO |
| 12 | 사내 npm registry 배포 설정 | P1 | 0.25d | TODO |
| 13 | 팀 공유 및 온보딩 가이드 | P2 | 0.25d | TODO |

---

## 7. 제약사항 및 주의사항

### 7.1 알려진 제약사항

| 제약사항 | 설명 및 대응 |
|----------|-------------|
| **단일 커넥션 제약** | 모든 쿼리가 하나의 커넥션에서 실행되므로, 실제 멀티 커넥션 시나리오(데드락 테스트 등)는 이 모듈로 테스트할 수 없다. |
| **DDL 롤백 불가** | MySQL에서 CREATE TABLE, ALTER TABLE 등 DDL은 암묵적 커밋이 발생하여 롤백되지 않는다. DDL이 포함된 테스트는 별도 처리 필요. |
| **AUTO_INCREMENT 갭** | 롤백되어도 AUTO_INCREMENT 카운터는 복원되지 않는다. ID 값에 의존하는 테스트는 주의 필요. |
| **병렬 테스트 미지원** | Jest의 `--runInBand` 옵션으로 순차 실행 필요. 병렬 실행 시 커넥션 공유 충돌 발생. |

### 7.2 사용 시 주의사항

1. Jest 설정에서 반드시 `--runInBand` 플래그를 사용할 것
2. 테스트 DB 이름에 반드시 `test` 문자열을 포함할 것 (예: `myapp_test`, `test_myapp`)
3. `.env.test` 파일을 별도로 관리하고, CI 환경에서도 동일한 DB 네이밍 규칙 적용
4. `pool.execute()`를 직접 사용하는 코드도 Proxy로 인터셉트되지만, 커넥션 풀 자체의 이벤트 리스너는 Proxy 대상이 아님

---

## 8. 테스트 시나리오

모듈 자체의 품질 보장을 위해 다음 테스트 시나리오를 작성한다.

### 8.1 SafetyGuard 테스트

| # | 시나리오 | 기대 결과 |
|---|---------|----------|
| 1 | NODE_ENV=production 에서 모듈 초기화 | 에러 발생, 실행 차단 |
| 2 | DB 이름에 'test' 미포함 (예: myapp_prod) | 에러 발생, 실행 차단 |
| 3 | NODE_ENV=test, DB=myapp_test | 정상 통과 |

### 8.2 ConnectionProxy 테스트

| # | 시나리오 | 기대 결과 |
|---|---------|----------|
| 4 | `beginTransaction()` 호출 | `SAVEPOINT sp_1` 실행 |
| 5 | `commit()` 호출 | `RELEASE SAVEPOINT sp_1` 실행 |
| 6 | `rollback()` 호출 | `ROLLBACK TO SAVEPOINT sp_1` 실행 |
| 7 | `release()` 호출 | 아무 동작 없음 (no-op) |
| 8 | 중첩 `beginTransaction()` 2회 + `commit()` 2회 | sp_1, sp_2 순서 생성/해제 |

### 8.3 통합 테스트

| # | 시나리오 | 기대 결과 |
|---|---------|----------|
| 9 | INSERT 후 rollback → SELECT | 데이터 없음 |
| 10 | 서비스의 getConnection + beginTransaction 흐름 | Savepoint로 변환, 롤백 후 데이터 없음 |
| 11 | 2개 테스트 연속 실행 시 데이터 격리 | 각 테스트 독립 실행 |
| 12 | 서비스 내부 rollback 시 외부 트랜잭션 유지 | Savepoint만 롤백, 외부 유지 |

---

## 9. 향후 확장 계획

### 9.1 v1.1 - Jest Custom Environment

Jest Custom Test Environment로 제공하여 beforeEach/afterEach 없이 자동으로 트랜잭션을 관리한다.

```typescript
// jest.config.ts
module.exports = {
  testEnvironment: '@point3/nestjs-mysql-test-transaction/jest-env',
};

// 테스트 파일에서 별도 설정 없이 자동 롤백
it('auto rollback', async () => {
  await paymentService.processPayment({ amount: 1000 });
  // afterEach 불필요 - 자동 롤백
});
```

### 9.2 v1.2 - Decorator 지원

Spring의 `@Transactional`과 유사한 데코레이터 인터페이스를 제공한다.

```typescript
@TestTransaction()
it('should process payment', async () => {
  await paymentService.processPayment({ amount: 1000 });
});
```

### 9.3 v2.0 - Multi-DB 지원

PostgreSQL, MariaDB 등 다른 데이터베이스 드라이버도 동일한 인터페이스로 지원한다.

---

## Appendix: Spring @Transactional 비교

| 항목 | Spring Boot | 이 모듈 |
|------|------------|---------|
| **설정** | `@Transactional` on test class | `TestTransactionModule.forRoot()` |
| **롤백 방식** | 트랜잭션 롤백 | 트랜잭션 롤백 + Savepoint |
| **코드 수정** | 불필요 | 불필요 (Proxy 패턴) |
| **중첩 트랜잭션** | NESTED propagation | Savepoint 자동 중첩 |
| **안전장치** | `@ActiveProfiles("test")` | SafetyGuard (DB명 + NODE_ENV) |
