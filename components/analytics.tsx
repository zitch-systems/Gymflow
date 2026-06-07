'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';

// PostHog analytics. No-op when the env var is absent so local/preview builds
// don't ping the service. Person profiles are `identified_only` so anonymous
// browsers don't burn through the MAU quota for a marketing-only visit.
function init() {
  if (typeof window === 'undefined') return false;
  if (posthog.__loaded) return true;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return false;
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: false,    // we trigger manually so SPA route changes count
    capture_pageleave: true,
    autocapture: false,         // form fields contain member PII — opt-out by default
    disable_session_recording: true,
  });
  return true;
}

export function Analytics() {
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    if (!init()) return;
    let url = pathname;
    if (search?.toString()) url = `${pathname}?${search.toString()}`;
    posthog.capture('$pageview', { $current_url: url });
  }, [pathname, search]);

  return null;
}
