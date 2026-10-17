import { useEffect, useState } from "react";
import { recorder, clientEnvironment, type ProgramInfo } from "../../fnos/m0/ui/diagnostics.js";
import { nativeJson, useNativeSession } from "./api.js";

// 飞牛与诊断：只看本机运行状态与凭据是否就绪，并提供可选的行为记录导出。
// 用户管理在「账号与同步」，共享空间、文件授权各自独立成分类；
// 逐项验收清单属于内部验收用途，不再出现在用户设置里。
export function NativeSettings() {
  const session = useNativeSession();
  const [status, setStatus] = useState("");
  const [recording, setRecording] = useState(recorder.enabled);
  const [program, setProgram] = useState<ProgramInfo | null>(null);

  useEffect(() => {
    let active = true;

    nativeJson<ProgramInfo>("/api/program-info")
      .then((value) => {
        if (active) setProgram(value);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  function run(operation: () => Promise<void>): void {
    void operation().catch((error) => {
      recorder.error(error instanceof Error ? error.name : "Error");
      setStatus(error instanceof Error ? error.message : "操作失败。");
    });
  }

  function exportReport(): void {
    recorder.action("report.export");
    const data = {
      ...recorder.snapshot(program, {}),
      client: clientEnvironment(),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `拾光便签-诊断-${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  return (
    <div className="native-settings">
      <header className="settings-pane-header">
        <h3>飞牛与诊断</h3>
        <p>查看本机运行状态与凭据是否就绪，记录故障并导出脱敏报告。</p>
      </header>

      <section className="settings-group" aria-label="运行状态">
        <div className="settings-card native-diagnostics-card">
          <dl className="native-status-list">
            <div>
              <dt>运行环境</dt>
              <dd>{session?.simulation ? "开发机模拟网关" : "飞牛 NAS"}</dd>
            </div>
            <div>
              <dt>系统文件授权</dt>
              <dd>
                {session?.systemApiConfigured
                  ? "已就绪，目录授权与 ACL 检查可用"
                  : "未就绪，请在「文件授权」里授权一次目录"}
              </dd>
            </div>
            <div>
              <dt>Node.js</dt>
              <dd>{program?.nodeVersion || "读取中…"}</dd>
            </div>
            <div>
              <dt>数据存储</dt>
              <dd>本机应用目录，正文不写入浏览器缓存</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="settings-group" aria-label="测试与诊断">
        <div className="settings-group-heading">
          <strong>测试与诊断</strong>
          <small>默认关闭，不自动上传，只保留当前页面最近 200 条。</small>
        </div>
        <div className="settings-card native-diagnostics-card">
          <label className="native-toggle-row">
            <input
              aria-label="开启当前页面行为记录"
              checked={recording}
              type="checkbox"
              onChange={(event) => {
                recorder.setEnabled(event.target.checked);
                setRecording(event.target.checked);
              }}
            />
            <span>
              <strong>开启当前页面行为记录</strong>
              <small>关闭设置后继续记录；刷新、关闭或切换账号会清空。</small>
            </span>
            <span className="native-chip">{recording ? "记录中" : "已关闭"}</span>
          </label>
          <p className="native-help">
            不记录正文、输入值、用户信息、目录路径、凭据或原始堆栈。
          </p>
          <div className="native-actions">
            <button
              onClick={() => {
                recorder.clear();
                setStatus("行为记录已清空。");
              }}
            >
              清空行为记录
            </button>
            <button className="native-primary" onClick={exportReport}>
              导出诊断报告 JSON
            </button>
          </div>
          <p className={`native-feedback${status ? " is-visible" : ""}`} role="status">
            {status}
          </p>
        </div>
      </section>

    </div>
  );
}
