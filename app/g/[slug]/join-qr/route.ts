import QRCode from 'qrcode';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ROOT_DOMAIN } from '@/lib/tenant';
import { isOfflineGym } from '@/lib/gym-status';

export const maxDuration = 60;

// The gym's sign-up QR as a PNG, for the "Scan to join" tile on its public page.
//
// A separate route rather than a data URL inlined into the page: the tile only
// renders on wide screens (scanning a code on the phone you're holding is
// pointless), and a URL referenced from a background-image inside a media query
// is never fetched when that query doesn't match. Inlining would ship ~4KB of
// base64 to every phone visitor to render nothing. It also makes the code
// cacheable, and gives the gym a stable link it can print or post.

const SLUG_RE = /^[a-z0-9-]{1,63}$/;

// Matches the admin console's Member QR codes page, so the code a gym prints
// from the front desk and the one on its website are the same image.
const QR_OPTS = {
  margin: 2,
  width: 512,
  errorCorrectionLevel: 'M' as const,
  color: { dark: '#0a0b0e', light: '#ffffff' },
};

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // The QR only ever encodes this route's own slug, so it can't be coaxed into
  // encoding an arbitrary URL — but an unknown or suspended gym still 404s
  // rather than minting a code that leads nowhere.
  if (!SLUG_RE.test(slug)) return new Response('Not found', { status: 404 });

  let gym: { status: string | null } | null = null;
  try {
    const admin = createAdminClient();
    const { data } = await admin.from('gyms').select('status').eq('slug', slug).maybeSingle();
    gym = data ?? null;
  } catch {
    const supabase = await createClient();
    const { data } = await supabase.from('gyms').select('status').eq('slug', slug).maybeSingle();
    gym = data ?? null;
  }
  if (!gym || isOfflineGym(gym)) return new Response('Not found', { status: 404 });

  const png = await QRCode.toBuffer(`https://${slug}.${ROOT_DOMAIN}/join/${slug}`, {
    ...QR_OPTS,
    type: 'png',
  });

  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      // The encoded URL is derived entirely from the slug, so the image only
      // changes if the gym is renamed — at which point the URL changes too.
      // Long max-age with revalidation keeps a suspended gym's code from
      // outliving the suspension by more than a day at the edge.
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
    },
  });
}
