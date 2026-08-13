// Stand-in for the `server-only` package under vitest.
//
// The real package throws on import so that a server module accidentally pulled
// into a client bundle fails loudly at build time. That check belongs to the
// Next.js bundler; vitest has no client boundary to protect, and the real
// package's unconditional throw would simply make server modules untestable.
//
// See the `resolve.alias` note in vitest.config.ts.
export {};
