import { describe, expect, it } from 'vitest';
import { ldJson } from '@/lib/ld-json';

// The gym landing page injects owner-authored text (gym name, description) into
// a <script type="application/ld+json"> via dangerouslySetInnerHTML. If a '<'
// survives, the gym owner controls markup on their own public page — and the
// previous inline "escape" was a no-op that replaced '<' with '<'.

const PAYLOAD = '</script><img src=x onerror=alert(1)>';

describe('ldJson', () => {
  it('never emits a literal </script>', () => {
    const out = ldJson({ name: PAYLOAD });
    expect(out).not.toContain('</script>');
    expect(out).not.toContain('<');
  });

  it('escapes every < , not just the first', () => {
    expect(ldJson({ a: '<', b: '<<<' })).not.toContain('<');
  });

  it('is still valid JSON that decodes back to the original text', () => {
    // The escape must not corrupt the structured data — search engines read it.
    const parsed = JSON.parse(ldJson({ name: PAYLOAD })) as { name: string };
    expect(parsed.name).toBe(PAYLOAD);
  });

  it('leaves ordinary content untouched', () => {
    const gym = { '@type': 'HealthClub', name: 'Iron Republic', description: 'Strength & conditioning — Lagos' };
    expect(JSON.parse(ldJson(gym))).toEqual(gym);
  });

  it('demonstrates why the old inline version failed', () => {
    // '<' in a TS string literal is the character '<': a replace of '<' with
    // '<' changes nothing, which is exactly what shipped.
    const oldWay = JSON.stringify({ name: PAYLOAD }).replace(/</g, '<');
    expect(oldWay).toContain('</script>');
    expect(ldJson({ name: PAYLOAD })).not.toContain('</script>');
  });
});
