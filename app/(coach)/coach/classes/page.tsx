import { CalendarDays } from 'lucide-react';
export const metadata = { title: 'Classes · Instructor' };
const ROWS = [
  { time: '06:30', tag: 'Mon', name: 'Sunrise HIIT', sub: 'Studio A', booked: 20, cap: 20 },
  { time: '09:00', tag: 'Mon', name: 'Power Lifting', sub: 'Weights floor', booked: 12, cap: 16 },
  { time: '17:30', tag: 'Tue', name: 'Conditioning', sub: 'Studio B', booked: 15, cap: 18 },
  { time: '06:30', tag: 'Thu', name: 'Sunrise HIIT', sub: 'Studio A', booked: 18, cap: 20 },
];
export default function CoachClasses() {
  return (
    <>
      <div className="hdr"><h1>Classes</h1><p>Your teaching schedule · 12 classes this week · 84% avg fill</p></div>
      <div className="panel">
        <div className="panel-h"><div><h3>This week</h3><div className="sub">Recurring sessions you teach</div></div></div>
        <div className="tl">
          {ROWS.map((r, i) => (
            <div className="tl-row" key={i}>
              <div className="tl-time"><b>{r.time}</b><span>{r.tag}</span></div>
              <div className="tl-card"><div className="info"><strong>{r.name}</strong><small>{r.sub} · {r.booked}/{r.cap} booked</small></div><span className={`gf-badge ${r.booked >= r.cap ? 'gf-badge-warning' : 'gf-badge-neutral'}`}>{r.booked >= r.cap ? 'Full' : `${r.cap - r.booked} left`}</span></div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
