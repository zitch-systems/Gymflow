import { Check, Star, type LucideIcon } from 'lucide-react';

export function FeatureCard({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <article className="marketing-feature">
      <div className="marketing-feature-icon" aria-hidden>
        <Icon size={22} strokeWidth={1.75} />
      </div>
      <h3 className="marketing-feature-title">{title}</h3>
      <p className="marketing-feature-body">{body}</p>
    </article>
  );
}

export function Step({ n, icon: Icon, title, body }: { n: number; icon: LucideIcon; title: string; body: string }) {
  return (
    <article className="mk-step">
      <div className="mk-step-top">
        <span className="mk-step-num">{n}</span>
        <span className="mk-step-icon" aria-hidden><Icon size={20} strokeWidth={1.75} /></span>
      </div>
      <h3 className="mk-step-title">{title}</h3>
      <p className="mk-step-body">{body}</p>
    </article>
  );
}

export function Testimonial({ quote, name, gym }: { quote: string; name: string; gym: string }) {
  return (
    <article className="mk-testimonial">
      <div className="mk-stars" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => <Star key={i} size={15} strokeWidth={0} fill="var(--gf-accent)" />)}
      </div>
      <p className="mk-testimonial-quote">“{quote}”</p>
      <div className="mk-testimonial-by">
        <span className="mk-testimonial-avatar" aria-hidden>{name.charAt(0)}</span>
        <span>
          <span className="mk-testimonial-name">{name}</span>
          <span className="mk-testimonial-gym">{gym}</span>
        </span>
      </div>
    </article>
  );
}

export function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="mk-faq-item">
      <summary className="mk-faq-q">
        <span>{q}</span>
        <span className="mk-faq-plus" aria-hidden><Check size={16} strokeWidth={2.5} /></span>
      </summary>
      <p className="mk-faq-a">{a}</p>
    </details>
  );
}
