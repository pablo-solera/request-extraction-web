"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { bmwTypekeyAvailabilitySchema, type BmwTypekeyAvailability } from "@/lib/readers/bmw/types";

export type AvailabilityTarget = { brand: "BMW" | "MINI"; series: string; developmentCode: string; typekey: string };
export type AvailabilityEntry = { state: "loading" } | { state: "error" } | { state: "ready"; availability: BmwTypekeyAvailability };

const MAX_CONCURRENT_CHECKS = 3;
const LOADING: AvailabilityEntry = { state: "loading" };

export function availabilityKey(target: AvailabilityTarget) {
  return [target.brand, target.series, target.developmentCode, target.typekey].join("|");
}

async function loadAvailability(target: AvailabilityTarget, signal: AbortSignal): Promise<AvailabilityEntry> {
  try {
    const query = new URLSearchParams({ brand: target.brand, series: target.series, developmentCode: target.developmentCode, typekey: target.typekey });
    const response = await fetch(`/api/readers/bmw/availability?${query.toString()}`, { cache: "no-store", signal });
    if (!response.ok) return { state: "error" };
    const parsed = bmwTypekeyAvailabilitySchema.safeParse((await response.json() as { availability?: unknown }).availability);
    return parsed.success ? { state: "ready", availability: parsed.data } : { state: "error" };
  } catch (error) {
    if (signal.aborted) throw error;
    return { state: "error" };
  }
}

/**
 * Checks every distinct typekey against BMW Flat Rates (three at a time, to respect BMW's shared rate limit).
 * A target without an answer yet is reported as loading.
 */
export function useBmwAvailability(targets: AvailabilityTarget[], enabled: boolean) {
  const [entries, setEntries] = useState<Record<string, AvailabilityEntry>>({});
  const [attempt, setAttempt] = useState(0);
  const requested = useRef(new Set<string>());
  const known = useRef<Record<string, AvailabilityEntry>>({});
  const signature = targets.map(availabilityKey).join("\n");

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const inFlight = requested.current;
    const pending = [...new Map(signature.split("\n").filter(Boolean).map((key) => {
      const [brand, series, developmentCode, typekey] = key.split("|") as [AvailabilityTarget["brand"], string, string, string];
      return [key, { brand, series, developmentCode, typekey }] as const;
    })).entries()].filter(([key]) => !requested.current.has(key));
    for (const [key] of pending) inFlight.add(key);
    const finished = new Set<string>();

    let next = 0;
    async function worker() {
      while (next < pending.length && !controller.signal.aborted) {
        const [key, target] = pending[next++]!;
        try {
          const entry = await loadAvailability(target, controller.signal);
          finished.add(key);
          known.current[key] = entry;
          setEntries((current) => ({ ...current, [key]: entry }));
        } catch {
          return;
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_CHECKS, pending.length) }, worker));

    return () => {
      controller.abort();
      for (const [key] of pending) if (!finished.has(key)) inFlight.delete(key);
    };
  }, [attempt, enabled, signature]);

  const retry = useCallback((target: AvailabilityTarget) => {
    const key = availabilityKey(target);
    requested.current.delete(key);
    delete known.current[key];
    setEntries((current) => Object.fromEntries(Object.entries(current).filter(([entryKey]) => entryKey !== key)));
    setAttempt((current) => current + 1);
  }, []);

  /** Checks every target now (three at a time) and resolves once all have an answer; answers already known are reused. */
  const ensure = useCallback(async (wanted: AvailabilityTarget[], onProgress?: (done: number, total: number) => void) => {
    const unique = [...new Map(wanted.map((target) => [availabilityKey(target), target])).entries()];
    const results: Record<string, AvailabilityEntry> = {};
    const todo: Array<[string, AvailabilityTarget]> = [];
    for (const [key, target] of unique) {
      const cached = known.current[key];
      if (cached?.state === "ready") results[key] = cached;
      else todo.push([key, target]);
    }
    let done = unique.length - todo.length;
    onProgress?.(done, unique.length);
    let next = 0;
    async function worker() {
      while (next < todo.length) {
        const [key, target] = todo[next++]!;
        const entry = await loadAvailability(target, new AbortController().signal);
        results[key] = entry;
        if (entry.state === "ready") {
          known.current[key] = entry;
          requested.current.add(key);
        }
        setEntries((current) => ({ ...current, [key]: entry }));
        onProgress?.(++done, unique.length);
      }
    }
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_CHECKS, todo.length) }, worker));
    return results;
  }, []);

  return {
    ensure,
    entryFor: (target: AvailabilityTarget): AvailabilityEntry => entries[availabilityKey(target)] ?? LOADING,
    retry,
  };
}
