import { describe, expect, it } from "vite-plus/test";

import { formatRunElapsed, runElapsedLabel } from "./workflowElapsed.ts";

const STARTED_AT = "2026-10-23T12:00:00.000Z";
const startedMs = Date.parse(STARTED_AT);

describe("formatRunElapsed", () => {
  it("shows m:ss under an hour", () => {
    expect(formatRunElapsed(0)).toBe("0:00");
    expect(formatRunElapsed(7_000)).toBe("0:07");
    expect(formatRunElapsed(252_000)).toBe("4:12");
    expect(formatRunElapsed(3_599_999)).toBe("59:59");
  });

  it("shows hours and minutes from one hour", () => {
    expect(formatRunElapsed(3_600_000)).toBe("1h 00m");
    expect(formatRunElapsed(3_840_000)).toBe("1h 04m");
  });

  it("clamps negative clock skew and unreadable input to zero", () => {
    expect(formatRunElapsed(-5_000)).toBe("0:00");
    expect(formatRunElapsed(Number.NaN)).toBe("0:00");
  });
});

describe("runElapsedLabel", () => {
  it("counts a running run up to now", () => {
    expect(
      runElapsedLabel({ status: "running", startedAt: STARTED_AT }, startedMs + 252_000),
    ).toEqual({ text: "Running 4:12", tone: "running" });
  });

  it("keeps counting through a wait, from the same start", () => {
    expect(
      runElapsedLabel({ status: "waiting", startedAt: STARTED_AT }, startedMs + 750_000),
    ).toEqual({ text: "Waiting 12:30", tone: "waiting" });
  });

  it("freezes a finished run at endedAt, whatever the clock says", () => {
    const endedAt = "2026-10-23T12:14:02.000Z";
    for (const status of ["done", "failed", "stopped"] as const) {
      expect(runElapsedLabel({ status, startedAt: STARTED_AT, endedAt }, startedMs)).toEqual({
        text: "Took 14:02",
        tone: "done",
      });
      expect(
        runElapsedLabel({ status, startedAt: STARTED_AT, endedAt }, startedMs + 9_999_000),
      ).toEqual({ text: "Took 14:02", tone: "done" });
    }
  });

  it("shows no label for a finished run that never recorded an end", () => {
    expect(runElapsedLabel({ status: "done", startedAt: STARTED_AT }, startedMs)).toEqual({
      text: "",
      tone: "done",
    });
  });
});
