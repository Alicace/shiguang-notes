import assert from "node:assert/strict";
import test from "node:test";
import {
  canStepNoteFontScale,
  DEFAULT_NOTE_FONT_SCALE,
  getNoteFontScaleLabel,
  normalizeNoteFontScale,
  NOTE_FONT_SCALES,
  stepNoteFontScale,
} from "../../src/lib/note-typography.js";
import { normalizeRichNote, parseNoteWorkspace } from "../../src/lib/notes.js";

test("便签字号档位只有四档，非法值回落到标准", () => {
  assert.deepEqual([...NOTE_FONT_SCALES], [0.85, 1, 1.15, 1.3]);
  assert.equal(DEFAULT_NOTE_FONT_SCALE, 1);
  assert.equal(normalizeNoteFontScale(undefined), 1);
  assert.equal(normalizeNoteFontScale("大"), 1);
  assert.equal(normalizeNoteFontScale(Number.NaN), 1);
  assert.equal(normalizeNoteFontScale(1.14), 1.15);
  assert.equal(normalizeNoteFontScale(0.4), 0.85);
  assert.equal(normalizeNoteFontScale(9), 1.3);
});

test("字号档位可逐级增减并在边界停住", () => {
  assert.equal(stepNoteFontScale(1, 1), 1.15);
  assert.equal(stepNoteFontScale(1, -1), 0.85);
  assert.equal(stepNoteFontScale(1.3, 1), 1.3);
  assert.equal(stepNoteFontScale(0.85, -1), 0.85);
  assert.equal(canStepNoteFontScale(1.3, 1), false);
  assert.equal(canStepNoteFontScale(0.85, -1), false);
  assert.equal(canStepNoteFontScale(1, 1), true);
  assert.equal(getNoteFontScaleLabel(0.85), "小");
  assert.equal(getNoteFontScaleLabel(1), "标准");
  assert.equal(getNoteFontScaleLabel(1.3), "特大");
});

test("工作区读写保留字号档位，缺失时补默认值", () => {
  const withScale = normalizeRichNote({
    createdAt: 1,
    deletedAt: null,
    folderId: null,
    fontScale: 1.15,
    id: "note-a",
    isStarred: false,
    markdown: "正文",
    normalOrder: 0,
    pinnedAt: null,
    updatedAt: 1,
  });
  assert.equal(withScale.fontScale, 1.15);

  const workspace = parseNoteWorkspace(
    JSON.stringify({
      activeNoteId: withScale.id,
      folders: [],
      notes: [
        withScale,
        {
          createdAt: 1,
          deletedAt: null,
          folderId: null,
          id: "note-b",
          isStarred: false,
          markdown: "旧便签",
          normalOrder: 1,
          pinnedAt: null,
          updatedAt: 1,
        },
      ],
      version: 1,
    }),
  );

  assert.ok(workspace);
  assert.equal(workspace.notes[0].fontScale, 1.15);
  assert.equal(workspace.notes[1].fontScale, 1);
});
