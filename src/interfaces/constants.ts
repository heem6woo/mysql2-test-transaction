export const DEFAULT_POOL_TOKEN = 'MYSQL_POOL';

/**
 * Creates namespaced internal tokens for a given poolToken.
 * This prevents collisions when forRoot() is called multiple times
 * with different poolTokens (multi-pool scenarios).
 */
export function createInternalTokens(poolToken: string | symbol) {
  const key = typeof poolToken === 'symbol' ? poolToken.toString() : poolToken;
  return {
    options: Symbol.for(`__TEST_TX_OPTIONS__::${key}`),
    originalPool: Symbol.for(`__TEST_TX_ORIGINAL_POOL__::${key}`),
    poolHolder: Symbol.for(`__TEST_TX_POOL_HOLDER__::${key}`),
    helper: Symbol.for(`__TEST_TX_HELPER__::${key}`),
  };
}

/**
 * Returns the injection token for TestTransactionHelper bound to a specific poolToken.
 * Use this when you have multiple pools and need to retrieve a specific helper.
 *
 * @example
 * ```typescript
 * const clientHelper = module.get<TestTransactionHelper>(
 *   getTestTransactionHelperToken(ClientPoolToken),
 * );
 * ```
 */
export function getTestTransactionHelperToken(poolToken: string | symbol): symbol {
  const key = typeof poolToken === 'symbol' ? poolToken.toString() : poolToken;
  return Symbol.for(`__TEST_TX_HELPER__::${key}`);
}

// Legacy export kept for backwards compat — no longer used internally
export const TEST_TRANSACTION_OPTIONS = Symbol('TEST_TRANSACTION_OPTIONS');
