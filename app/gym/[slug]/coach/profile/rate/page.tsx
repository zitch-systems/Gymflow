import Link from 'next/link';
import { requireInstructor } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader } from '@/components/ui/card';
import { RateForm } from '../rate-form';
import { ArrowLeft } from 'lucide-react';

export const metadata = { title: 'Session rate' };

type PageProps = { params: Promise<{ slug: string }> };

export default async function CoachRatePage({ params }: PageProps) {
  const { slug } = await params;
  const { gym, user } = await requireInstructor(slug);
  const supabase = await createClient();
  const { data: pricing } = await supabase
    .from('instructor_pricing')
    .select('price')
    .eq('gym_id', gym.id)
    .eq('instructor_id', user.id)
    .eq('billing_period', 'monthly')
    .maybeSingle();
  const hasRate = pricing?.price != null;

  return (
    <div className="gf-page">
      <header className="mhead" style={{ justifyContent: 'space-between', paddingBottom: 6 }}>
        <Link href="/coach/profile" className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Back to profile">
          <ArrowLeft strokeWidth={1.9} />
        </Link>
        <strong className="htitle">Session rate</strong>
        <span style={{ width: 34, height: 34 }} aria-hidden />
      </header>

      <Card>
        <CardHeader title="Monthly subscription rate" />
        <div id="rate">
          <RateForm slug={slug} initial={hasRate ? Number(pricing!.price) : null} />
        </div>
      </Card>
    </div>
  );
}
