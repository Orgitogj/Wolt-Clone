export interface QueryResult {
  data: unknown;
  error: unknown;
}

export const createQueryBuilder = (result: QueryResult) => {
  const builder: Record<string, unknown> = {};
  const chain = [
    'select',
    'eq',
    'in',
    'is',
    'not',
    'overlaps',
    'order',
    'limit',
    'range',
    'filter',
  ];

  chain.forEach((method) => {
    builder[method] = jest.fn(() => builder);
  });

  builder.maybeSingle = jest.fn(() => Promise.resolve(result));
  builder.single = jest.fn(() => Promise.resolve(result));
  builder.then = (resolve: (value: QueryResult) => unknown) => Promise.resolve(result).then(resolve);

  return builder;
};

export const createSupabaseMock = () => ({
  rpc: jest.fn(),
  from: jest.fn(),
  functions: { invoke: jest.fn() },
  auth: {
    getSession: jest.fn(() => Promise.resolve({ data: { session: null }, error: null })),
    onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    signInWithPassword: jest.fn(),
    signUp: jest.fn(),
    signInAnonymously: jest.fn(),
    signInWithOAuth: jest.fn(),
    signOut: jest.fn(() => Promise.resolve({ error: null })),
  },
  channel: jest.fn(() => ({
    on: jest.fn().mockReturnThis(),
    subscribe: jest.fn().mockReturnThis(),
  })),
  removeChannel: jest.fn(),
});

export type SupabaseMock = ReturnType<typeof createSupabaseMock>;
