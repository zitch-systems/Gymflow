// Minimal chainable Supabase client mock for unit tests.
//
// The real @supabase/supabase-js builder returns a thenable that you can chain
// `.select().eq().maybeSingle()` / `.insert(...).select()` / `.update(...).eq()`
// on. We don't need to fully reimplement it — we just need the chain to resolve
// to a deterministic `{ data, error }`. Each test sets per-call results in
// FIFO order via `queue()`, so the assertions are tightly coupled to the
// production call order and any drift fails loudly.

type QueryResult = { data?: unknown; error?: { message: string } | null };

export class MockBuilder {
  private last: QueryResult;
  constructor(initial: QueryResult) {
    this.last = initial;
  }
  // Every chained call is a no-op that returns `this` so chains terminate at
  // an awaited builder. Awaiting returns the queued result.
  select(): this { return this; }
  insert(): this { return this; }
  update(): this { return this; }
  upsert(): this { return this; }
  delete(): this { return this; }
  eq(): this { return this; }
  neq(): this { return this; }
  gt(): this { return this; }
  gte(): this { return this; }
  lt(): this { return this; }
  lte(): this { return this; }
  ilike(): this { return this; }
  in(): this { return this; }
  order(): this { return this; }
  limit(): this { return this; }
  maybeSingle(): this { return this; }
  single(): this { return this; }
  // Make awaiting the builder resolve to the queued result.
  then<T>(resolve: (v: QueryResult) => T): T {
    return resolve(this.last);
  }
}

export type FromCall = { table: string };

export function createMockSupabase(queue: QueryResult[]) {
  const fromCalls: FromCall[] = [];
  let i = 0;
  const client = {
    from(table: string) {
      fromCalls.push({ table });
      const result = queue[i] ?? { data: null, error: null };
      i += 1;
      return new MockBuilder(result);
    },
    // helpers for tests
    _fromCalls: fromCalls,
    _consumed: () => i,
    _remaining: () => queue.length - i,
  };
  return client;
}

export type MockSupabase = ReturnType<typeof createMockSupabase>;
