'use client';
// src/lib/hooks/usePackingSession.ts
// Manages a packing session lifecycle

import { useState, useEffect, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { PackingSession } from '@/types/database.types';

export function usePackingSession(userId: string | null) {
  const [session, setSession] = useState<PackingSession | null>(null);
  const [loading, setLoading] = useState(false);

  // Find an active session. Creating one remains an explicit operator action.
  const startSession = useCallback(async (): Promise<PackingSession | null> => {
    if (!userId) return null;
    setLoading(true);
    const supabase = getSupabaseClient();

    // Check for an active session (no ended_at within last 8 hours)
    const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await supabase
      .from('packing_sessions')
      .select('*')
      .eq('packer_id', userId)
      .is('ended_at', null)
      .gte('started_at', eightHoursAgo)
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    if (existing) {
      setSession(existing as PackingSession);
      setLoading(false);
      return existing as PackingSession;
    }

    // Start a new session only when the operator presses START PACKING.
    const { data: newSession, error } = await (
      supabase.from('packing_sessions') as unknown as {
        insert: (data: { packer_id: string }) => {
          select: () => {
            single: () => Promise<{ data: PackingSession | null; error: unknown }>;
          };
        };
      }
    )
      .insert({ packer_id: userId })
      .select()
      .single();

    if (error || !newSession) {
      setLoading(false);
      return null;
    }

    const sess = newSession as PackingSession;
    setSession(sess);
    setLoading(false);
    return sess;
  }, [userId]);

  const endSession = useCallback(async (): Promise<void> => {
    if (!session) return;
    const supabase = getSupabaseClient();
    await (
      supabase.from('packing_sessions') as unknown as {
        update: (data: { ended_at: string }) => {
          eq: (column: string, val: string) => Promise<unknown>;
        };
      }
    )
      .update({ ended_at: new Date().toISOString() })
      .eq('id', session.id);
    setSession(null);
  }, [session]);

  useEffect(() => {
    if (!userId) {
      const resetTimer = setTimeout(() => setSession(null), 0);
      return () => clearTimeout(resetTimer);
    }
    const supabase = getSupabaseClient();
    supabase
      .from('packing_sessions')
      .select('*')
      .eq('packer_id', userId)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setSession((data as PackingSession | null) || null));
  }, [userId]);

  return { session, loading, startSession, endSession };
}
