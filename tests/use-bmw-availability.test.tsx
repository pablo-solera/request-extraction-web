import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { availabilityKey, useBmwAvailability, type AvailabilityTarget } from "@/lib/hooks/use-bmw-availability";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const target = (typekey: string): AvailabilityTarget => ({ brand: "BMW", series: "6'", developmentCode: "F13", typekey });
const answer = (typekey: string, status = "available") => Response.json({ availability: { typekey, status, suggestedTypekey: null } });

describe("useBmwAvailability", () => {
  it("does nothing until it is enabled and reports pending targets as loading", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const targets = [target("6J92")];
    const { result, rerender } = renderHook(({ enabled }) => useBmwAvailability(targets, enabled), { initialProps: { enabled: false } });
    expect(result.current.entryFor(targets[0]!)).toEqual({ state: "loading" });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockImplementation(async () => answer("6J92"));
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.entryFor(targets[0]!)).toMatchObject({ state: "ready", availability: { status: "available" } }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/readers/bmw/availability?brand=BMW&series=6%27&developmentCode=F13&typekey=6J92");
  });

  it("checks each distinct typekey once and never runs more than three checks at a time", async () => {
    let active = 0;
    let maximum = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return answer(new URL(String(input), "http://localhost").searchParams.get("typekey")!);
    });
    vi.stubGlobal("fetch", fetchMock);
    const targets = ["11EH", "12EH", "13EH", "14EH", "15EH", "11EH"].map(target);
    const { result } = renderHook(() => useBmwAvailability(targets, true));
    await waitFor(() => expect(targets.every((item) => result.current.entryFor(item).state === "ready")).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(maximum).toBeLessThanOrEqual(3);
  });

  it("keeps failures as errors and lets the user retry them", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { message: "down" } }, { status: 502 }))
      .mockResolvedValueOnce(answer("YM13", "unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    const targets = [target("YM13")];
    const { result } = renderHook(() => useBmwAvailability(targets, true));
    await waitFor(() => expect(result.current.entryFor(targets[0]!)).toEqual({ state: "error" }));

    act(() => result.current.retry(targets[0]!));
    await waitFor(() => expect(result.current.entryFor(targets[0]!)).toMatchObject({ state: "ready", availability: { status: "unavailable" } }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats a malformed answer as an error and builds stable keys", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ availability: { typekey: "6J92", status: "maybe" } })));
    const targets = [target("6J92")];
    const { result } = renderHook(() => useBmwAvailability(targets, true));
    await waitFor(() => expect(result.current.entryFor(targets[0]!)).toEqual({ state: "error" }));
    expect(availabilityKey(targets[0]!)).toBe("BMW|6'|F13|6J92");
  });
});
