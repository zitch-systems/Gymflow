'use client';

import Script from 'next/script';

// Third-party marketing/analytics + live-chat snippets for a gym's public
// landing page. Every value here is a public client-side ID validated to a
// fixed shape server-side (no quotes/angle-brackets possible), so interpolating
// it into these fixed templates has no injection surface. Renders nothing when
// a given integration isn't configured.
export function LandingTrackers({ ga4: ga4Raw, metaPixel: metaPixelRaw, chatProvider, chatId: chatIdRaw }: {
  ga4?: string | null; metaPixel?: string | null; chatProvider?: string | null; chatId?: string | null;
}) {
  // Re-validate at render (defense in depth): updateMarketing enforces these
  // shapes at save time, but the values round-trip through the DB — a row
  // edited by any other path must still never reach the script templates.
  const ga4 = ga4Raw && /^G-[A-Z0-9]{4,20}$/i.test(ga4Raw) ? ga4Raw : null;
  const metaPixel = metaPixelRaw && /^\d{6,20}$/.test(metaPixelRaw) ? metaPixelRaw : null;
  const chatId = chatIdRaw && (
    (chatProvider === 'crisp' && /^[0-9a-f-]{20,40}$/i.test(chatIdRaw)) ||
    (chatProvider === 'tawk' && /^[0-9a-f]{16,30}\/[0-9a-z]{5,20}$/i.test(chatIdRaw))
  ) ? chatIdRaw : null;
  return (
    <>
      {ga4 && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${ga4}`} strategy="afterInteractive" />
          <Script id="ga4-init" strategy="afterInteractive">{`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${ga4}');
          `}</Script>
        </>
      )}

      {metaPixel && (
        <Script id="meta-pixel" strategy="afterInteractive">{`
          !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
          n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
          document,'script','https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '${metaPixel}');
          fbq('track', 'PageView');
        `}</Script>
      )}

      {chatProvider === 'crisp' && chatId && (
        <Script id="crisp-chat" strategy="afterInteractive">{`
          window.$crisp=[];window.CRISP_WEBSITE_ID='${chatId}';
          (function(){var d=document,s=d.createElement('script');
          s.src='https://client.crisp.chat/l.js';s.async=1;
          d.getElementsByTagName('head')[0].appendChild(s);})();
        `}</Script>
      )}

      {chatProvider === 'tawk' && chatId && (
        <Script id="tawk-chat" strategy="afterInteractive">{`
          var Tawk_API=Tawk_API||{},Tawk_LoadStart=new Date();
          (function(){var s1=document.createElement("script"),s0=document.getElementsByTagName("script")[0];
          s1.async=true;s1.src='https://embed.tawk.to/${chatId}';s1.charset='UTF-8';
          s1.setAttribute('crossorigin','*');s0.parentNode.insertBefore(s1,s0);})();
        `}</Script>
      )}
    </>
  );
}
