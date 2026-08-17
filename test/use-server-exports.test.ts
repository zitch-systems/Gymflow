import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// A 'use server' file may only export async functions.
//
// That is Next's documented rule, and the interesting part is HOW it breaks.
// `export type Foo = { … }` — a type alias declared in the file — is erased by
// the compiler and is fine; every action file here uses one for its form state.
// But `export type { Foo };` — a type-only RE-export of an imported binding —
// came out the other side of Turbopack's server-actions transform as a real
// `export { Foo }`, against a binding types had already erased. The module then
// threw `ReferenceError: Foo is not defined` at evaluation, before any handler
// ran, so every request to the route died in the error boundary.
//
// It shipped in three files at once (renew, check-in, class booking) when the
// member logic was extracted into shared cores, and stayed invisible because
// nothing in lint, type-check or the build objects: the TypeScript is valid,
// and the failure only exists in the emitted output. Production told us, six
// crashes deep, in the client_errors table.
//
// So this test reads the source instead. Cheap, and it is the only thing
// standing between a re-export written out of habit and a dead route.

const ROOT = resolve(__dirname, '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(resolve(ROOT, dir))) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const rel = `${dir}/${entry}`;
    if (statSync(resolve(ROOT, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.tsx?$/.test(entry)) out.push(rel);
  }
  return out;
}

const useServerFiles = ['lib', 'app', 'components']
  .flatMap(sourceFiles)
  .filter((f) => /^\s*'use server'/.test(readFileSync(resolve(ROOT, f), 'utf8')));

describe("'use server' files", () => {
  it('exist (the scan found the action files)', () => {
    // A guard on the guard: if the glob ever stops matching, every assertion
    // below would pass vacuously and the lock would be silently gone.
    expect(useServerFiles.length).toBeGreaterThan(20);
    expect(useServerFiles).toContain('lib/actions/renew.ts');
  });

  it('re-export no bindings — type-only or otherwise', () => {
    const offenders: string[] = [];
    for (const file of useServerFiles) {
      const src = readFileSync(resolve(ROOT, file), 'utf8');
      for (const [i, line] of src.split('\n').entries()) {
        // `export type Foo = …` and `export interface Foo` declare a type in
        // this file and are erased cleanly. `export { … }` / `export type { … }`
        // re-export a binding, which is the broken form.
        if (/^\s*export\s+(type\s+)?\{/.test(line)) offenders.push(`${file}:${i + 1} ${line.trim()}`);
      }
    }
    expect(offenders, 'move the type to the module it comes from and import it there').toEqual([]);
  });

  it('export only async functions and type aliases', () => {
    const offenders: string[] = [];
    for (const file of useServerFiles) {
      const src = readFileSync(resolve(ROOT, file), 'utf8');
      for (const [i, line] of src.split('\n').entries()) {
        if (!/^\s*export\s/.test(line)) continue;
        const ok = /^\s*export\s+async\s+function\s/.test(line)
          || /^\s*export\s+type\s+\w+\s*=/.test(line)
          || /^\s*export\s+interface\s/.test(line);
        if (!ok) offenders.push(`${file}:${i + 1} ${line.trim()}`);
      }
    }
    // A non-async export here is the sibling failure: Next rejects the whole
    // module at runtime with "a 'use server' file can only export async
    // functions, found object" — which this app has also hit in production.
    expect(offenders).toEqual([]);
  });
});
