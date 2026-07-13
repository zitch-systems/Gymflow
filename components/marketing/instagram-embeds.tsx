'use client';

import { useEffect } from 'react';

// Renders curated Instagram posts using Instagram's official embed. Each URL
// becomes a `blockquote.instagram-media`; loading embed.js (once) replaces the
// blockquotes with the real embedded posts. No API keys, no per-gym OAuth — the
// gym just pastes public post/reel permalinks in Settings.
//
// `embed.js` is idempotent: once loaded it exposes window.instgrm; calling
// `.Embeds.process()` (re)hydrates any blockquotes currently on the page, which
// also covers client-side navigations where the script tag is already present.
declare global {
  interface Window { instgrm?: { Embeds: { process: () => void } } }
}

const SCRIPT_SRC = 'https://www.instagram.com/embed.js';

export function InstagramEmbeds({ urls }: { urls: string[] }) {
  useEffect(() => {
    if (window.instgrm) { window.instgrm.Embeds.process(); return; }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) { existing.addEventListener('load', () => window.instgrm?.Embeds.process()); return; }
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => window.instgrm?.Embeds.process();
    document.body.appendChild(s);
  }, [urls]);

  return (
    <div className="ig-embeds">
      {urls.map((url) => (
        <blockquote
          key={url}
          className="instagram-media"
          data-instgrm-permalink={url}
          data-instgrm-version="14"
          // Sensible min sizing before embed.js swaps in the real iframe, so the
          // section doesn't collapse to nothing on first paint.
          style={{ background: '#fff', border: 0, borderRadius: 12, margin: 0, maxWidth: 540, minWidth: 260, width: '100%' }}
        >
          <a href={url} target="_blank" rel="noreferrer">View this post on Instagram</a>
        </blockquote>
      ))}
    </div>
  );
}
