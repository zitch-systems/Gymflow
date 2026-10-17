'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { acceptWaiver, WaiverChangedError, WaiverUnavailableError } from '@/lib/waiver-core';

export async function signWaiver(expected: { gymId: string; revision: string }): Promise<{ error: string } | void> {
  const { user, gym } = await requireMember();
  try {
    await acceptWaiver(await createClient(), user.id, gym, expected);
  } catch (error) {
    if (error instanceof WaiverChangedError || error instanceof WaiverUnavailableError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath('/dashboard', 'layout');
  redirect('/dashboard');
}
