import { useCallback, useEffect, useRef } from "react";
import { createSession, endSession, sendEvents } from "../api/client";
import type { BehaviorEvent, SessionCreatePayload, SessionRecord } from "../api/client";

const FLUSH_INTERVAL_MS = 4000;

/**
 * Manages one behavioral-tracking session's lifecycle (create -> batched event
 * upload -> end/summarize) for either a real shopper or an AI persona agent.
 * Events are queued client-side and flushed periodically so we don't hammer
 * the API on every animation frame; a failed flush logs a warning and drops
 * that batch rather than blocking the UI (best-effort telemetry, never a hard
 * dependency for the walkthrough itself to keep working).
 */
export function useBehaviorSession() {
  const sessionRef = useRef<SessionRecord | null>(null);
  const sessionStartMsRef = useRef<number>(0);
  const queueRef = useRef<BehaviorEvent[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  // Guards against React 18 StrictMode's dev-only mount->cleanup->mount effect
  // replay racing with this hook's async start(): each start()/stop() bumps
  // the generation, and a start() that resolves after being superseded
  // discards/ends its (now-orphaned) session instead of clobbering the newer one.
  const generationRef = useRef(0);

  const flush = useCallback(() => {
    const session = sessionRef.current;
    if (!session || queueRef.current.length === 0) return;
    const batch = queueRef.current;
    queueRef.current = [];
    void sendEvents(session.id, batch).catch((err) => {
      console.warn(`[behavior-session] dropped ${batch.length} event(s):`, err);
    });
  }, []);

  const start = useCallback(
    async (payload: SessionCreatePayload) => {
      const myGeneration = ++generationRef.current;
      const session = await createSession(payload);
      if (generationRef.current !== myGeneration) {
        // A stop()/newer start() happened while this request was in flight
        // (e.g. StrictMode's dev-only double-effect) - don't adopt it, just
        // close out the orphaned session server-side.
        void endSession(session.id).catch(() => {});
        return session;
      }
      sessionRef.current = session;
      sessionStartMsRef.current = performance.now();
      queueRef.current = [];
      if (flushTimerRef.current) window.clearInterval(flushTimerRef.current);
      flushTimerRef.current = window.setInterval(flush, FLUSH_INTERVAL_MS);
      return session;
    },
    [flush]
  );

  const elapsedMs = useCallback(() => performance.now() - sessionStartMsRef.current, []);
  const toSessionMs = useCallback((perfNowMs: number) => Math.max(0, Math.round(perfNowMs - sessionStartMsRef.current)), []);

  const logEvent = useCallback(
    (event: Omit<BehaviorEvent, "ts_ms"> & { ts_ms?: number }) => {
      if (!sessionRef.current) return;
      queueRef.current.push({ ts_ms: Math.round(event.ts_ms ?? elapsedMs()), ...event } as BehaviorEvent);
    },
    [elapsedMs]
  );

  const stop = useCallback(async () => {
    generationRef.current++; // invalidate any start() still in flight
    const session = sessionRef.current;
    if (!session) return null;
    flush();
    if (flushTimerRef.current) {
      window.clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    await new Promise((resolve) => setTimeout(resolve, 200)); // let the last flush land
    sessionRef.current = null;
    try {
      return await endSession(session.id);
    } catch (err) {
      console.warn("[behavior-session] failed to end session cleanly:", err);
      return null;
    }
  }, [flush]);

  useEffect(
    () => () => {
      if (flushTimerRef.current) window.clearInterval(flushTimerRef.current);
    },
    []
  );

  return {
    start,
    stop,
    logEvent,
    elapsedMs,
    toSessionMs,
    getSession: () => sessionRef.current,
  };
}
