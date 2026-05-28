// `server-only` is a Next.js sentinel package that throws if imported from a
// client bundle. In Vitest (Node environment) it doesn't exist — alias to this
// no-op so SUT files can be imported and tested.
export {};
