import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const alt = 'GymFlow — Modern Gym Management for Nigerian Fitness Businesses';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Satori (next/og) is strict: every container with more than one child must
// declare display:flex (or contents/none). It also can't load glyphs that
// aren't in the default font (e.g. the Naira sign ₦), so the body copy uses
// "NGN" instead. Keep visual hierarchy with size/colour, not exotic chars.
export default async function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: 'linear-gradient(135deg, #08130d 0%, #0a1f15 55%, #0a2a1c 100%)',
          color: '#e6fff3',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: '#11d18b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#08130d" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19.5 7.2A8 8 0 1 0 20 12h-6" />
            </svg>
          </div>
          <div style={{ display: 'flex', fontSize: 40, fontWeight: 700, letterSpacing: -0.5, color: '#e6fff3' }}>
            GymFlow
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', fontSize: 28, color: '#11d18b', letterSpacing: 1, textTransform: 'uppercase' }}>
            Built in Lagos · Made for Nigerian gyms
          </div>
          <div style={{ display: 'flex', fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, color: '#11d18b' }}>
            Run your gym the modern way.
          </div>
          <div style={{ display: 'flex', fontSize: 30, lineHeight: 1.35, maxWidth: 980, color: '#cdeedd' }}>
            QR check-in · Paystack subscriptions · class booking · automated reminders.
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: 22, color: '#9adcbe' }}>
          <div style={{ display: 'flex' }}>gymflow.ng</div>
          <div style={{ display: 'flex' }}>From NGN 14,999/mo · Cancel anytime</div>
        </div>
      </div>
    ),
    size,
  );
}
