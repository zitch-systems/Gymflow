// Per-test setup (runs in each worker). The db.ts singleton pool reads
// TEST_DATABASE_URL, which is set by global.ts. Nothing else to do — kept as a
// hook file so we can add per-test seeding later without changing config.
import { afterAll } from 'vitest';
import { pool } from '../db';

afterAll(async () => { await pool.end(); });
