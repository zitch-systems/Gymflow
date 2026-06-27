'use client';

import { useRef } from 'react';
import { ChevronsUpDown } from 'lucide-react';
import { setActiveGym } from '@/lib/actions/active-gym';

// Dropdown to switch the active gym for staff who belong to more than one.
// Renders nothing for single-gym users (the common case). Submitting posts to
// setActiveGym, which sets the cookie and reloads the chosen gym's console.
export function GymSwitcher({ gyms, activeId, redirectTo }: { gyms: { id: string; name: string }[]; activeId: string; redirectTo: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  if (gyms.length < 2) return null;
  return (
    <form ref={formRef} action={setActiveGym} className="gym-switcher">
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <ChevronsUpDown size={14} strokeWidth={2} aria-hidden />
      <select name="gymId" defaultValue={activeId} aria-label="Switch gym" onChange={() => formRef.current?.requestSubmit()}>
        {gyms.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
    </form>
  );
}
