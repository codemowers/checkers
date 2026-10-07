/** Short visible samples; three consecutive fast windows unlock one feature stage. */
export class RenderPerformance {
  constructor(public level = 5) {}
  private seconds = 0;
  private frames = 0;
  private fastSamples = 0;
  private warmup = 0.1;

  resetSample() {
    this.seconds = 0;
    this.frames = 0;
    this.fastSamples = 0;
    this.warmup = 0.1;
  }

  sample(delta: number, visible: boolean): { fps: number; level: number } | undefined {
    if (!visible || !Number.isFinite(delta) || delta <= 0 || delta > 5) {
      this.resetSample();
      return;
    }
    if (this.warmup > 0) { this.warmup -= delta; return; }
    this.seconds += delta;
    this.frames++;
    if (this.seconds < 0.25) return;
    // Summing frame deltas can put an exact 50 FPS just below the threshold.
    const fps = Math.round((this.frames / this.seconds) * 1e6) / 1e6;
    this.seconds = 0;
    this.frames = 0;
    this.fastSamples = fps >= 50 ? this.fastSamples + 1 : 0;
    if (this.fastSamples >= 3 && this.level > 0) {
      this.level--;
      this.resetSample();
    }
    return { fps, level: this.level };
  }
}

export const smokeCounts = [16, 8, 4, 0, 0, 0] as const;
