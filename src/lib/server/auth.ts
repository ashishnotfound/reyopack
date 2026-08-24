import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Profile, UserRole } from '@/types/database.types';

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export async function requireUser(roles?: UserRole[]) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new HttpError(401, 'Authentication required.');
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (profileError || !profile || !(profile as Profile).is_active) {
    throw new HttpError(403, 'Your account is inactive or not provisioned.');
  }

  const typedProfile = profile as Profile;
  if (roles && !roles.includes(typedProfile.role)) {
    throw new HttpError(403, 'You do not have permission for this operation.');
  }

  return { supabase, user, profile: typedProfile };
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error('[Reyo Pack API]', error);
  return Response.json({ error: 'The server could not complete this request.' }, { status: 500 });
}
