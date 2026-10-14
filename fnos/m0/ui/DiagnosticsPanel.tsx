import { useEffect, useState } from "react";
import metadata from "../metadata.json";
import { api } from "./api";
import { clientEnvironment, collectPageEvents, recorder, type ProgramInfo } from "./diagnostics";
import { featureInventory, resultLabels, testCases, type TestResult } from "./features";

const targets = { editor: "editor", export: "png-controls", system: "system", diagnostics: "diagnostics" };

export function DiagnosticsPanel() {
  const [enabled, setEnabled] = useState(false);
  const [count, setCount] = useState(0);
  const [program, setProgram] = useState<ProgramInfo | null>(null);
  const [status, setStatus] = useState("");
  const [checks, setChecks] = useState<Record<string, TestResult>>(() => Object.fromEntries(testCases.map((item) => [item.id, "untested"])));
  useEffect(() => {
    let active = true;
    recorder.setEnabled(false);
    const dispose = collectPageEvents();
    void api<ProgramInfo>("program-info").then((info) => { if (active) setProgram(info); }).catch(() => { if (active) setStatus("程序信息暂不可用，仍可导出本地记录。"); });
    return () => { active = false; dispose(); recorder.setEnabled(false); };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setCount(recorder.count), 1000);
    return () => clearInterval(timer);
  }, [enabled]);

  function downloadReport() {
    const report = { ...recorder.snapshot(program, checks), client: clientEnvironment() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = `拾光便签-诊断-${Date.now()}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
    setStatus("诊断报告已交给浏览器保存，请检查下载位置。");
  }

  return <details id="diagnostics" className="diagnostics-panel" tabIndex={-1}>
    <summary>设置 · 测试与诊断</summary>
    <p>当前版本 {metadata.appVersion} · M0。以下是功能接入状态，不代表完整上游应用已经实现。测试结果由你手动标记。</p>
    <h2>诊断记录</h2>
    <p>默认关闭；仅在当前页面内存保留最近 200 条记录。刷新、关闭记录或切换账号会清空事件，不自动上传。测试标记也仅当前页面有效。</p>
    <p>记录固定按钮动作、接口状态和耗时、错误类别、应用版本及浏览器/屏幕信息。不记录正文、输入值、用户名、UID、目录路径、网址、原始错误堆栈或凭据。</p>
    <label className="capture-toggle"><input type="checkbox" checked={enabled} onChange={(event) => { const next = event.target.checked; recorder.setEnabled(next); setEnabled(next); setCount(recorder.count); setStatus(next ? "已开启当前页面行为记录。" : "已关闭并清空行为记录。"); }} />开启当前页面行为记录</label>
    <p aria-live="polite">{enabled ? "记录中" : "记录关闭"} · {count} / 200 条</p>
    <div className="actions"><button onClick={() => { recorder.clear(); setCount(0); setStatus("行为记录已清空，测试标记保留。"); }}>清空行为记录</button><button data-diag-action="report.export" onClick={downloadReport}>导出诊断报告 JSON</button></div>
    <p role="status">{status}</p>
    <h2>逐项点击测试</h2>
    <p>建议使用测试正文和测试目录。标记“通过”仅代表你的手动结果；带“NAS / App 真机”的项目需要在目标设备执行。</p>
    <div className="test-list">{testCases.map((item) => <article className="test-case" key={item.id}>
      <h3>{item.id} · {item.name}{item.device && <span className="device-label">NAS / App 真机</span>}</h3>
      <p>操作：{item.steps}</p><p>预期：{item.expected}</p>
      <div className="actions"><button onClick={() => { const target = document.getElementById(targets[item.target]); target?.scrollIntoView({ behavior: "smooth", block: "start" }); target?.focus({ preventScroll: true }); }}>前往功能</button><label>测试结果 <select aria-label={`${item.id} 测试结果`} value={checks[item.id]} onChange={(event) => { const result = event.target.value as TestResult; setChecks((old) => ({ ...old, [item.id]: result })); recorder.action("test.result", item.id, result); }}>{Object.entries(resultLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
    </article>)}</div>
    <details className="feature-inventory"><summary>查看原作者功能与当前接入状态 · {featureInventory.length} 项</summary><div className="feature-list">{featureInventory.map((item) => <article key={item.id}><h3>{item.id} · {item.name} <span>{item.status}</span></h3><p>{item.detail}</p></article>)}</div></details>
  </details>;
}
