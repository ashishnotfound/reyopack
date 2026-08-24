'use client';
// src/lib/hooks/usePackingSession.ts
// Manages a packing session lifecycle

import { useState, useEffect, useCallback, useRef } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { PackingSession } from '@/types/database.types';

const SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000;

export function usePackingSession(userId: string | null) {
  const [session, setSession] = useState<PackingSession | null>(null);
  const [loading, setLoading] = useState(false);
  const startInFlightRef = useRef(false);

  // Find an active session. Creating one remains an explicit operator action.
  const startSession = useCallback(async (): Promise<PackingSession | null> => {
    if (!userId || startInFlightRef.current) return null;
    startInFlightRef.current = true;
    setLoading(true);
    try {
      const supabase = getSupabaseClient();

      // Reuse a current session, but close an abandoned one before creating a
      // fresh session after a long device/app outage.
      const eightHoursAgo = new Date(Date.now() - SESSION_TIMEOUT_MS).toISOString();
      const existingResult = await supabase
        .from('packing_sessions')
        .select('*')
        .eq('packer_id', userId)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const existing = existingResult.data as unknown as PackingSession | null;

      if (existing) {
        if (existing.started_at >= eightHoursAgo) {
          setSession(existing as PackingSession);
          return existing as PackingSession;
        }

        await (supabase.from('packing_sessions') as unknown as {
          update: (data: { ended_at: string }) => {
            eq: (column: string, val: string) => {
              is: (column: string, val: null) => Promise<unknown>;
            };
          };
        })
          .update({ ended_at: new Date().toISOString() })
          .eq('id', existing.id)
          .is('ended_at', null);
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
        // Another device may have won the active-session race. Reuse that
        // session instead of surfacing a duplicate-start failure to the user.
        const concurrentResult = await supabase
          .from('packing_sessions')
          .select('*')
          .eq('packer_id', userId)
          .is('ended_at', null)
          .gte('started_at', new Date(Date.now() - SESSION_TIMEOUT_MS).toISOString())
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const concurrentSession = concurrentResult.data as unknown as PackingSession | null;
        if (concurrentSession) {
          setSession(concurrentSession as PackingSession);
          return concurrentSession as PackingSession;
        }
        return null;
      }

      const sess = newSession as PackingSession;
      setSession(sess);
      return sess;
    } finally {
      setLoading(false);
      startInFlightRef.current = false;
    }
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
    let active = true;

    if (!userId) {
      const resetTimer = setTimeout(() => setSession(null), 0);
      return () => {
        active = false;
        clearTimeout(resetTimer);
      };
    }
    const supabase = getSupabaseClient();
    supabase
      .from('packing_sessions')
      .select('*')
      .eq('packer_id', userId)
      .is('ended_at', null)
      .gte('started_at', new Date(Date.now() - SESSION_TIMEOUT_MS).toISOString())
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setSession((data as PackingSession | null) || null);
      });

    return () => {
      active = false;
    };
  }, [userId]);

  return { session, loading, startSession, endSession };
}
