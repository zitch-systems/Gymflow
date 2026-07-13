import { CalendarPlus } from 'lucide-react';
import { calendarLinks, type CalEvent } from '@/lib/calendar';

// "Add to calendar" control for a booked class. Server-rendered (native
// <details> popover — no client JS): a Google Calendar link and a downloadable
// .ics for Apple Calendar / Outlook. Renders nothing if the event time can't be
// resolved.
export function AddToCalendar({ event }: { event: CalEvent }) {
  const links = calendarLinks(event);
  if (!links) return null;
  return (
    <details className="cal-add">
      <summary className="gf-btn gf-btn-secondary gf-btn-sm" aria-label="Add to calendar" title="Add to calendar">
        <CalendarPlus strokeWidth={2} size={15} />
      </summary>
      <div className="cal-menu">
        <a href={links.google} target="_blank" rel="noreferrer">Google Calendar</a>
        <a href={links.ics} download={links.filename}>Apple / Outlook (.ics)</a>
      </div>
    </details>
  );
}
