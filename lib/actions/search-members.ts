'use server';

import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/gym';

export type MemberSearchHit = {
  id: string;
  label: string;
  email: string | null;
  href: string;
};

/**
 * Live member search for the admin command palette. Returns up to 8 matches
 * scoped to the current gym (via gym_member_links). Authorization: requireStaff
 * — front-desk, accountant, manager, owner can all search.
 *
 * Empty / too-short queries return []. We sanitise the query for the Supabase
 * .or() filter syntax (commas and parens have special meaning) and the
 * ilike percent.
 */
export async function searchMembers(slug: string, query: string): Promise<MemberSearchHit[]> {
  const { gym } = await requireStaff(slug);
  const q = query.trim();
  if (q.length < 2) return [];

  // Sanitise: characters with PostgREST .or() meaning. Brand-blocking these in
  // member names is sad but the query is just a prefix-match so the user
  // doesn't notice.
  const safe = q.replace(/[%,()*]/g, '');
  if (!safe) return [];
  const like = `%${safe}%`;

  const supabase = await createClient();
  // Embedded ilike against profiles using the !inner join so members of OTHER
  // gyms aren't returned. The referencedTable option targets the .or filter at
  // the joined profiles table rather than gym_member_links.
  const { data, error } = await supabase
    .from('gym_member_links')
    .select('user_id, profiles!inner(id, full_name, first_name, email)')
    .eq('gym_id', gym.id)
    .or(`full_name.ilike.${like},email.ilike.${like},first_name.ilike.${like}`, { referencedTable: 'profiles' })
    .limit(8);

  if (error || !data) return [];

  return data
    .map((row) => {
      const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      if (!p) return null;
      const label = p.full_name ?? p.first_name ?? p.email ?? 'Member';
      return {
        id: p.id,
        label,
        email: p.email ?? null,
        href: `/admin/members/${p.id}`,
      };
    })
    .filter((m): m is MemberSearchHit => m !== null);
}
