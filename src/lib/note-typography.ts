// 官方便签移动端的 A+/A- 是整篇字号档位（没有选区语义），因此这里存的是便签级字号，
// 而不是行内语法：预览、PNG、公众号与富文本编辑面共用同一个档位。
export const NOTE_FONT_SCALES = [0.85, 1, 1.15, 1.3] as const;
export const NOTE_FONT_SCALE_LABELS = ["小", "标准", "大", "特大"] as const;
export const DEFAULT_NOTE_FONT_SCALE = 1;

export function normalizeNoteFontScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_NOTE_FONT_SCALE;
  }

  const closest = NOTE_FONT_SCALES.reduce((best, candidate) =>
    Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best,
  );
  return closest;
}

export function getNoteFontScaleLabel(scale: number): string {
  const index = NOTE_FONT_SCALES.indexOf(
    normalizeNoteFontScale(scale) as (typeof NOTE_FONT_SCALES)[number],
  );
  return NOTE_FONT_SCALE_LABELS[index] ?? NOTE_FONT_SCALE_LABELS[1];
}

export function stepNoteFontScale(scale: number, direction: 1 | -1): number {
  const current = NOTE_FONT_SCALES.indexOf(
    normalizeNoteFontScale(scale) as (typeof NOTE_FONT_SCALES)[number],
  );
  const next = Math.min(
    NOTE_FONT_SCALES.length - 1,
    Math.max(0, current + direction),
  );
  return NOTE_FONT_SCALES[next];
}

export function canStepNoteFontScale(scale: number, direction: 1 | -1): boolean {
  const current = NOTE_FONT_SCALES.indexOf(
    normalizeNoteFontScale(scale) as (typeof NOTE_FONT_SCALES)[number],
  );
  return direction === 1
    ? current < NOTE_FONT_SCALES.length - 1
    : current > 0;
}
