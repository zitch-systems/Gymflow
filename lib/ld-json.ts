/**
 * Serialise structured data for a `<script type="application/ld+json">`.
 *
 * `JSON.stringify` does not escape `<`, so any string that reaches the document
 * this way can close the script tag: a gym named
 * `</script><img src=x onerror=…>` would execute on its own landing page. The
 * fix is to emit `<` as the JSON escape `<` — parsers decode it back to
 * `<`, so the structured data is unchanged, but the literal characters
 * `</script>` can never appear in the markup.
 *
 * This existed inline on the gym landing page as
 * `.replace(/</g, '<')` — which is a no-op, because in a TypeScript string
 * literal `'<'` IS the character `<`. It replaced `<` with `<` and the page
 * stayed injectable. Writing it once, tested, is the point of this module.
 *
 * U+2028/U+2029 need no escaping here: JSON-LD is parsed as data, not evaluated
 * as JavaScript, so the line-terminator hazard doesn't apply.
 */
export function ldJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
