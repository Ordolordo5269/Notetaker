import { describe, expect, it } from "vitest";
import { previewInterval, scheduleReview } from "@/lib/study/srs";

const fresh = { ease: 2.5, intervalDays: 0, repetitions: 0, lapses: 0 };
const DAY = 86_400_000;

describe("scheduleReview", () => {
  it("grows intervals with good answers and resets on a lapse", () => {
    const a = scheduleReview(fresh, "good", 0);
    expect(a.intervalDays).toBe(1);
    const b = scheduleReview(a, "good", 0);
    expect(b.intervalDays).toBe(3);
    const c = scheduleReview(b, "good", 0);
    expect(c.intervalDays).toBeCloseTo(7.5);
    expect(c.dueAt).toBe(7.5 * DAY);
    const d = scheduleReview(c, "again", 1000);
    expect(d.repetitions).toBe(0);
    expect(d.lapses).toBe(1);
    expect(d.ease).toBeCloseTo(2.3);
    expect(d.dueAt).toBe(1000 + 10 * 60_000);
  });

  it("never drops ease below 1.3 and caps intervals at a year", () => {
    let card = { ...fresh, ease: 1.35 };
    for (let i = 0; i < 5; i++) card = scheduleReview(card, "hard", 0);
    expect(card.ease).toBe(1.3);
    let big = { ease: 3, intervalDays: 300, repetitions: 10, lapses: 0 };
    big = scheduleReview(big, "easy", 0);
    expect(big.intervalDays).toBe(365);
  });

  it("previews intervals for the grade buttons", () => {
    expect(previewInterval(fresh, "again")).toBe("10 min");
    expect(previewInterval(fresh, "hard")).toBe("12 h");
    expect(previewInterval(fresh, "good")).toBe("1 d");
    expect(previewInterval({ ease: 2.5, intervalDays: 40, repetitions: 4, lapses: 0 }, "good")).toBe("3.3 meses");
  });
});
