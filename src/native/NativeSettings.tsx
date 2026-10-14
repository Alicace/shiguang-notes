import { useEffect, useState } from "react";
import { appFetch, appPath, currentSpace } from "../lib/fnos-client.js";
import { recorder, clientEnvironment, type ProgramInfo } from "../../fnos/m0/ui/diagnostics.js";
import { resultLabels, type TestResult } from "../../fnos/m0/ui/features.js";
import { AUTH_STATE_KEY } from "../../fnos/m0/ui/api.js";
import { featureInventory, manualSteps } from "./features.js";
import metadata from "./metadata.json" with { type: "json" };

interface Space { id: string; name: string; ownerId: string; members: Record<string, "editor" | "viewer"> }
async function json<T>(route: string, init: RequestInit = {}): Promise<T> {
  const response = await appFetch(route, init); const data = await response.json();
  if (!response.ok) throw new Error(data.error || "操作失败，请刷新重试。");
  return data;
}
const write = (body: object, method = "POST") => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
let testResults: Record<string, TestResult> = {};
export function resetNativeTestResults() { testResults = {}; }

export function NativeSettings({ onSpaceChange }: { onSpaceChange: (scope: string) => Promise<void> }) {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [uid, setUid] = useState("");
  const [role, setRole] = useState("viewer");
  const [status, setStatus] = useState("");
  const [recording, setRecording] = useState(recorder.enabled);
  const [program, setProgram] = useState<ProgramInfo | null>(null);
  const [checks, setChecks] = useState(testResults);
  const [session, setSession] = useState<{ user: { uid: number; username: string; isAdmin: boolean }; simulation: boolean } | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [config, setConfig] = useState<Record<string, string>>({});
  async function refreshSpaces() { const data = await json<{ privateScope: string; spaces: Space[] }>("/api/fnos/spaces"); setUserId(data.privateScope); setSpaces(data.spaces); }
  function run(operation: () => Promise<void>) { void operation().catch((error) => { recorder.error(error instanceof Error ? error.name : "Error"); setStatus(error instanceof Error ? error.message : "操作失败。"); }); }
  useEffect(() => {
    let active = true;
    run(async () => { await refreshSpaces(); const data = await json<typeof session>("/api/session"); if (active) setSession(data); });
    void json<ProgramInfo>("/api/program-info").then((data) => { if (active) setProgram(data); }).catch(() => {});
    return () => { active = false; };
  }, []);
  function exportReport() {
    recorder.action("report.export");
    const data = { ...recorder.snapshot(program, checks), client: clientEnvironment() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `拾光便签-诊断-${Date.now()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function authorize() {
    recorder.action("system.authorize");
    if (session?.simulation) throw new Error("模拟网关不能代替 NAS 的真实文件授权。");
    const { TrimApp } = await import("@trimjs/web-app");
    const app = new TrimApp(); await app.ready();
    if (app.isStandaloneWeb) {
      const state = Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) => value.toString(16).padStart(2, "0")).join("");
      sessionStorage.setItem(AUTH_STATE_KEY, JSON.stringify({ state, uid: session!.user.uid }));
      await app.openAppAuth("pickUserFile", { appName: "fnnotes-m0", directory: true, redirectUri: appPath("/auth-callback.html"), state }, { target: "_self" });
    } else { await app.pickUserFile({ directory: true, title: "为拾光便签授权测试目录" }); await refreshFolders(); }
  }
  async function refreshFolders() { recorder.action("system.refresh"); const data = await json<{ paths: string[] }>("/api/authorized-folders"); setFolders(data.paths); }
  const labels: Record<string, string> = { OPENAI_BASE_URL: "AI 服务地址", OPENAI_MODEL: "模型名称", OPENAI_API_KEY: "AI API Key", QINIU_ACCESS_KEY: "七牛 Access Key", QINIU_SECRET_KEY: "七牛 Secret Key", QINIU_BUCKET: "存储空间名称", QINIU_DOMAIN: "图片访问域名", QINIU_PREFIX: "图片目录前缀" };
  const owned = spaces.filter((space) => space.ownerId === userId);
  return <div className="native-settings">
    <header className="settings-pane-header"><h3>飞牛与诊断</h3><p>管理工作区、系统授权与本机故障记录。</p></header>
    <div className="settings-card native-identity-card"><span className="settings-account-avatar" aria-hidden="true">{Array.from(session?.user.username || "")[0]?.toLocaleUpperCase()}</span><div className="settings-account-copy"><strong>{session?.user.username || "正在读取飞牛账号"}</strong><small>拾光便签 {metadata.appVersion} · NAS UID {session?.user.uid || "…"}</small></div><span className="settings-status-badge">{session?.simulation ? "本机模拟" : "飞牛账号"}</span></div>
    {session?.simulation && <p className="native-help">当前为开发机模拟。NAS 登录、目录权限和手机保存仍需真机验收。</p>}
    <p className={`native-feedback${status ? " is-visible" : ""}`} role="status">{status}</p>

    <section className="settings-group" aria-label="私有便签与共享空间">
      <div className="settings-group-heading"><strong>私有便签与共享空间</strong><small>切换前保存本机修改；共享内容与私有便签分开。</small></div>
      <div className="settings-card native-form-card">
        <label className="native-field"><span>当前工作区</span><select aria-label="选择共享空间" value={currentSpace()} onChange={(event) => { const value = event.target.value; run(() => onSpaceChange(value)); }}><option value="">私有便签</option>{spaces.map((space) => <option key={space.id} value={`space-${space.id}`}>{space.name} · {space.ownerId === userId ? "所有者" : space.members[userId] === "editor" ? "可编辑" : "只读"}</option>)}</select></label>
        <div className="native-actions"><button onClick={() => run(() => onSpaceChange(""))}>返回私有便签</button></div>
        <label className="native-field"><span>创建共享空间</span><div className="native-input-action"><input aria-label="新共享空间名称" placeholder="输入空间名称" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} /><button className="native-primary" onClick={() => run(async () => { recorder.action("space.create"); await json("/api/fnos/spaces", write({ name })); setName(""); await refreshSpaces(); })}>创建共享空间</button></div></label>
      </div>
      {owned.length > 0 && <div className="settings-card native-space-list">{owned.map((space) => <details className="native-space" key={space.id}><summary>{space.name} · 管理成员</summary><div className="native-space-content">
        <p className="native-help">所有者管理成员；编辑成员可修改，只读成员可查看和导出。</p>
        <div className="native-fields-grid"><label className="native-field"><span>成员 NAS UID</span><input aria-label="成员 NAS UID" placeholder="从 NAS 用户信息确认" value={uid} inputMode="numeric" onChange={(event) => setUid(event.target.value)} /></label><label className="native-field"><span>成员权限</span><select aria-label="成员权限" value={role} onChange={(event) => setRole(event.target.value)}><option value="viewer">只读</option><option value="editor">可编辑</option></select></label></div>
        <div className="native-actions"><button className="native-primary" onClick={() => run(async () => { recorder.action("space.members"); await json(`/api/fnos/spaces/${space.id}/members`, write({ uid, role }, "PUT")); await refreshSpaces(); })}>为此空间添加/更新成员</button></div>
        {Object.entries(space.members).map(([id, permission]) => <div className="native-member-row" key={id}><span><strong>UID {id.slice(4)}</strong><small>{permission === "editor" ? "可编辑" : "只读"}</small></span><button onClick={() => run(async () => { await json(`/api/fnos/spaces/${space.id}/members`, write({ uid: id.slice(4), role: "remove" }, "PUT")); await refreshSpaces(); })}>撤销成员权限</button></div>)}
        <div className="native-actions"><button className="native-danger" onClick={() => { if (confirm("删除共享空间后，成员无法继续访问。确认删除这个测试空间？")) run(async () => { await json(`/api/fnos/spaces/${space.id}`, { method: "DELETE" }); await refreshSpaces(); }); }}>删除此共享空间</button></div>
      </div></details>)}</div>}
    </section>

    <section className="settings-group" aria-label="飞牛目录授权与权限"><div className="settings-group-heading"><strong>目录授权与权限</strong><small>使用系统选择器授权，按当前用户检查读写权限。</small></div><div className="settings-card native-form-card"><div className="native-actions"><button className="native-primary" onClick={() => run(authorize)}>选择并授权目录</button><button onClick={() => run(refreshFolders)}>刷新授权状态</button></div>{folders.map((folder) => <div className="native-folder-row" key={folder}><code>{folder}</code><button onClick={() => run(async () => { recorder.action("system.acl"); const data = await json<{ permissions: Array<{ readable: boolean; writable: boolean; deletable: boolean }> }>("/api/file-acl", write({ path: folder })); setStatus(data.permissions.map(({ readable, writable, deletable }) => `读：${readable ? "允许" : "拒绝"} · 写：${writable ? "允许" : "拒绝"} · 删除：${deletable ? "允许" : "拒绝"}`).join("；")); })}>检查当前用户 ACL</button></div>)}</div></section>

    <section className="settings-group" aria-label="测试与诊断"><div className="settings-group-heading"><strong>测试与诊断</strong><small>默认关闭，不自动上传，只保留当前页面最近 200 条。</small></div>
      <div className="settings-card native-diagnostics-card"><label className="native-toggle-row"><input aria-label="开启当前页面行为记录" type="checkbox" checked={recording} onChange={(event) => { recorder.setEnabled(event.target.checked); setRecording(event.target.checked); }} /><span><strong>开启当前页面行为记录</strong><small>关闭设置后继续记录；刷新、关闭或切换账号会清空。</small></span><span className="native-chip">{recording ? "记录中" : "已关闭"}</span></label><p className="native-help">不记录正文、输入值、用户信息、目录路径、凭据或原始堆栈。测试标记仅当前页面有效。</p><div className="native-actions"><button onClick={() => { recorder.clear(); setStatus("行为记录已清空。"); }}>清空行为记录</button><button className="native-primary" onClick={exportReport}>导出诊断报告 JSON</button></div></div>
      <div className="settings-card native-checklist">{featureInventory.map((feature) => <details className="native-test" key={feature.id}><summary><span className="native-test-id">{feature.id}</span><span className="native-test-title">{feature.name}</span><span className="native-chip">{feature.status}</span></summary><div className="native-test-content"><p>{feature.detail}</p><p><strong>测试步骤</strong><br />{manualSteps[feature.id]}</p><label className="native-test-result"><span>手动结果</span><select aria-label={`${feature.id} 测试结果`} value={checks[feature.id] || "untested"} onChange={(event) => { const result = event.target.value as TestResult; testResults = { ...checks, [feature.id]: result }; setChecks(testResults); recorder.action("test.result", feature.id, result); }}>{Object.entries(resultLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div></details>)}</div>
    </section>

    {session?.user.isAdmin && <section className="settings-group" aria-label="管理员服务配置"><div className="settings-group-heading"><strong>管理员 · 服务配置</strong><small>密钥仅保存在当前 NAS，保存后不回显；空白密钥保留旧值。</small></div><div className="settings-card native-form-card"><div className="native-actions"><button onClick={() => run(async () => { const data = await json<Record<string, string | boolean>>("/api/fnos/config"); setConfig(Object.fromEntries(Object.entries(data).filter((entry): entry is [string, string] => typeof entry[1] === "string"))); setStatus(`AI 凭据：${data.aiConfigured ? "已配置" : "未配置"}；图床凭据：${data.qiniuConfigured ? "已配置" : "未配置"}`); })}>读取配置状态</button></div><div className="native-config-grid">{Object.entries(labels).map(([key, label]) => <label className="native-field" key={key}><span>{label}</span><input aria-label={key} type={/KEY/.test(key) ? "password" : "text"} autoComplete="off" value={config[key] || ""} onChange={(event) => setConfig((old) => ({ ...old, [key]: event.target.value }))} /></label>)}</div><p className="native-help">公众号 AppID / Secret 仍在原公众号设置中按账号保存。</p><div className="native-actions"><button className="native-primary" onClick={() => run(async () => { const data = await json<{ aiAvailable: boolean }>("/api/fnos/config", write(config, "PUT")); setConfig((old) => Object.fromEntries(Object.entries(old).filter(([key]) => !/KEY/.test(key)))); setStatus(`配置已保存。AI 连接：${data.aiAvailable ? "可用" : "尚不可用，请核对服务配置"}；刷新页面更新 AI 入口。`); })}>保存服务配置</button></div></div></section>}
  </div>;
}
