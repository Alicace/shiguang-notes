import assert from "node:assert/strict";
import test from "node:test";
import { pageRanges } from "./ui/png.js";

test("长便签分片没有遗漏或重叠，段落边界优先，单片高度受限", () => {
  const pages = pageRanges(2300, [100, 650, 1050, 1450, 2100]);
  assert.equal(pages[0][0], 0);
  assert.equal(pages.at(-1)?.[1], 2300);
  pages.forEach(([start, end], i) => {
    assert.ok(end > start && end - start <= 900);
    if (i) assert.equal(start, pages[i - 1][1]);
  });
  assert.equal(pages[0][1], 650);
});
test("过长内容明确拒绝，不建立超大 Canvas", () => {
  assert.throws(() => pageRanges(20_000, []), /12/);
  assert.throws(() => pageRanges(0, []), /尺寸/);
});
