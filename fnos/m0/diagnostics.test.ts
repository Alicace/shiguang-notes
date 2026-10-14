import assert from "node:assert/strict";
import test from "node:test";
import { DiagnosticRecorder } from "./ui/diagnostics.js";

test("诊断默认关闭，不记录任何行为", () => {
  const recorder = new DiagnosticRecorder();
  recorder.action("note.save"); recorder.api("workspace", "PUT", 200, 10);
  assert.equal(recorder.snapshot(null, {}).events.length, 0);
});
test("仅允许固定动作、接口与错误类别，不记录正文路径和凭据", () => {
  const recorder = new DiagnosticRecorder(); recorder.setEnabled(true);
  recorder.action("CANARY_PRIVATE_NOTE"); recorder.api("workspace?token=FAKE_SECRET", "GET", 200, 1);
  recorder.error("CANARY_PRIVATE_USERNAME", "https://private-host.example/main-Ab12.js?token=FAKE_SECRET", 1, 2);
  recorder.error("Error", "file:///Users/private-user/private-document.md", 1, 2);
  const program = { nodeVersion: "22.23.3", uid: 123456, token: "FAKE_SECRET", path: "/vol1/private", username: "CANARY_PRIVATE_USERNAME", systemApiConfigured: true };
  const json = JSON.stringify(recorder.snapshot(program, { T01: "passed", CANARY_PRIVATE_NOTE: "failed" }));
  for (const text of ["FAKE_SECRET", "CANARY_PRIVATE", "private-host", "private-user", "/vol1", "123456"]) assert.ok(!json.includes(text), text);
  assert.ok(json.includes("main-Ab12.js"));
});
test("记录上限为 200 条，接口只保留状态和耗时", () => {
  const recorder = new DiagnosticRecorder(); recorder.setEnabled(true);
  for (let i = 0; i < 250; i++) recorder.api("workspace", "PUT", 409, 12);
  const snapshot = recorder.snapshot(null, {});
  assert.equal(snapshot.events.length, 200);
  assert.deepEqual(snapshot.events[0].data, { route: "workspace", method: "PUT", status: 409, durationMs: 12 });
  assert.ok(snapshot.events[0].sequence > 1);
});
test("清空和关闭会删除旧记录，关闭后不再新增", () => {
  const recorder = new DiagnosticRecorder(); recorder.setEnabled(true); recorder.action("note.save");
  recorder.clear(); assert.equal(recorder.snapshot(null, {}).events.length, 0);
  recorder.action("png.generate"); recorder.setEnabled(false); recorder.action("note.save");
  assert.equal(recorder.snapshot(null, {}).events.length, 0);
});
test("仅导出合法测试编号和结果，恶意额外字段不可进入报告", () => {
  const recorder = new DiagnosticRecorder(); recorder.setEnabled(true);
  recorder.action("test.result", "T02", "passed"); recorder.action("test.result", "T99", "SECRET");
  const snapshot = recorder.snapshot(null, { T02: "passed", T99: "failed" });
  assert.deepEqual(snapshot.tests, [{ caseId: "T02", result: "passed" }]);
  assert.equal(snapshot.events.length, 2);
});
