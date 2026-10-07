import { describe, expect, it } from "vitest";
import { RenderPerformance, smokeCounts } from "./render-performance";

function run(monitor: RenderPerformance, fps: number, seconds: number) {
  let last;
  for (let i = 0; i < fps * seconds; i++) last = monitor.sample(1 / fps, true) ?? last;
  return last;
}

describe("render performance", () => {
  it("reports tablet FPS within a second, including after a reset", () => {
    const monitor = new RenderPerformance();
    expect(run(monitor, 34, 0.7)?.fps).toBeCloseTo(34);
    monitor.resetSample();
    expect(run(monitor, 34, 0.7)?.fps).toBeCloseTo(34);
    expect(monitor.level).toBe(5);
  });

  it("unlocks a stage within a second when all samples reach 50 FPS", () => {
    const monitor = new RenderPerformance();
    run(monitor, 50, 0.98);
    expect(monitor.level).toBe(4);
  });

  it("starts simple and unlocks materials, then effects, then smoke in stages", () => {
    const monitor = new RenderPerformance();
    expect(monitor.level).toBe(5);
    expect(smokeCounts[monitor.level]).toBe(0);
    run(monitor, 60, 0.6);
    expect(monitor.level).toBe(5);
    run(monitor, 60, 0.4);
    expect(monitor.level).toBe(4);
    run(monitor, 60, 1);
    expect(monitor.level).toBe(3);
    expect(smokeCounts[monitor.level]).toBe(0);
    run(monitor, 60, 1);
    expect(smokeCounts[monitor.level]).toBe(4);
    run(monitor, 60, 3);
    expect(monitor.level).toBe(0);
  });

  it("requires at least 50 FPS before restoring richer materials", () => {
    const monitor = new RenderPerformance();
    run(monitor, 49, 60);
    expect(monitor.level).toBe(5);
    run(monitor, 50, 1);
    expect(monitor.level).toBe(4);
  });

  it("retains unlocked features even when rendering becomes very slow", () => {
    const monitor = new RenderPerformance();
    run(monitor, 60, 3);
    expect(monitor.level).toBe(2);
    run(monitor, 20, 60);
    run(monitor, 1, 60);
    expect(monitor.level).toBe(2);
    expect(smokeCounts[monitor.level]).toBe(4);
  });

  it("requires consecutive fast samples rather than isolated bursts", () => {
    const monitor = new RenderPerformance();
    run(monitor, 60, 0.6);
    run(monitor, 40, 0.7);
    run(monitor, 60, 0.4);
    expect(monitor.level).toBe(5);
    run(monitor, 60, 0.6);
    expect(monitor.level).toBe(4);
  });

  it("resets the sampling window on hidden tabs or resume gaps, preserving quality", () => {
    const monitor = new RenderPerformance(3);
    run(monitor, 60, 0.6);
    monitor.sample(1, false);
    monitor.sample(10, true);
    run(monitor, 60, 0.6);
    expect(monitor.level).toBe(3);
    run(monitor, 60, 0.4);
    expect(monitor.level).toBe(2);
  });

  it("a fresh monitor starts simple rather than remembering an earlier session", () => {
    const previous = new RenderPerformance();
    run(previous, 60, 100);
    expect(previous.level).toBe(0);
    expect(new RenderPerformance().level).toBe(5);
  });
});
