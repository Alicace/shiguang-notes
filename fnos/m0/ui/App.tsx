import { useEffect, useRef, useState } from "react";
import { TrimApp } from "@trimjs/web-app";
import { MarkdownText } from "../../../src/components/MarkdownText.js";
import { api, ApiError, AUTH_STATE_KEY, BASE, writeOptions, type Session, type Workspace } from "./api";
import { renderPng, savePng, type PngPage } from "./png";

const sample = "# 我的第一篇便签\n\n这是拾光便签的原生预检版。\n\n- 使用当前 NAS 用户保存正文\n- 在应用内生成 PNG\n- 图片直接保存到本机\n\n> 先验证平台能力，再接入完整便签与共享空间。";
const message = (error: unknown) => error instanceof Error ? error.message : "操作失败，请重试。";

function Note({ text, theme, id }: { text: string; theme: string; id?: string }) {
  return <article id={id} className={`note-card ${theme}`}>
    <div className="note-content"><MarkdownText>{text || "开始写下你的便签。"}</MarkdownText></div>
    <footer className="note-footer"><img src={BASE + "note-icon.png"} alt="" width="24" height="24" /><span>拾光便签 · M0</span></footer>
  </article>;
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [text, setText] = useState("");
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [theme, setTheme] = useState("paper");
  const [status, setStatus] = useState("正在确认飞牛身份…");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pages, setPages] = useState<PngPage[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [fileStatus, setFileStatus] = useState("尚未查询文件授权。");
  const [platform, setPlatform] = useState("系统 SDK 尚未初始化。");
  const sessionRef = useRef<Session | null>(null);
  const hydratedUid = useRef<number | null>(null);
  const exportNode = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  const sdk = useRef<TrimApp | null>(null);

  const clearImages = () => { controller.current?.abort(); setPages([]); };
  useEffect(() => () => pages.forEach((page) => URL.revokeObjectURL(page.url)), [pages]);
  useEffect(() => {
    let disposed = false;
    async function refresh() {
      try {
        const next = await api<Session>("session");
        if (disposed) return;
        if (hydratedUid.current !== next.user.uid) {
          controller.current?.abort();
          setPages([]); setFolders([]); setText(""); setDirty(false); setLoaded(false);
          const uid = next.user.uid;
          sessionRef.current = next; setSession(next);
          const saved = await api<Workspace>("workspace");
          const check = await api<Session>("session");
          if (disposed || check.user.uid !== uid) return;
          hydratedUid.current = uid;
          setText(saved.revision ? saved.text : sample); setRevision(saved.revision); setLoaded(true);
          setStatus(saved.revision ? "已加载当前用户便签。" : "尚未保存；示例仅用于预检。");
        } else { sessionRef.current = next; setSession(next); }
      } catch (error) {
        if (disposed) return;
        if (error instanceof ApiError && error.status === 401) { controller.current?.abort(); sessionRef.current = null; hydratedUid.current = null; setSession(null); setText(""); setPages([]); setLoaded(false); }
        setStatus(message(error));
      }
    }
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 15_000);
    return () => { disposed = true; clearInterval(timer); controller.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!session) return;
    if (session.simulation) { setPlatform("开发机模拟：系统 SDK 和文件授权待 NAS 验证。"); return; }
    const app = new TrimApp(); sdk.current = app;
    let active = true;
    const timer = setTimeout(() => { if (active) setPlatform("SDK 初始化暂未完成，可在 NAS 中检查入口和 micro_app 配置。"); }, 5000);
    void app.getPlatformConfig().then((config) => {
      if (!active) return;
      clearTimeout(timer);
      setPlatform(`系统 ${config.systemVersion} · ${config.language} · ${app.isStandaloneWeb ? "独立浏览器" : app.isWeb ? "桌面宿主" : "移动宿主"}`);
      setTheme(config.theme === "dark" ? "night" : "paper");
    }).catch(() => { if (active) setPlatform("系统 SDK 暂不可用，请检查飞牛入口配置。"); });
    return () => { active = false; clearTimeout(timer); };
  }, [session?.simulation]);

  async function currentSession() {
    let next: Session;
    try { next = await api<Session>("session"); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) { clearImages(); sessionRef.current = null; hydratedUid.current = null; setSession(null); setText(""); setLoaded(false); }
      throw error;
    }
    if (!sessionRef.current || next.user.uid !== sessionRef.current.user.uid) {
      clearImages(); sessionRef.current = null; hydratedUid.current = null; setSession(null); setText(""); setFolders([]); setDirty(false); setLoaded(false);
      throw new Error("账号已变化，请重新加载便签。");
    }
    sessionRef.current = next; setSession(next);
    return next;
  }

  async function save() {
    setBusy(true);
    try {
      const active = await currentSession();
      const snapshot = text;
      const result = await api<Workspace>("workspace", writeOptions(active, { text: snapshot, revision }));
      if (sessionRef.current?.user.uid !== active.user.uid) return;
      setRevision(result.revision); setDirty(false); setStatus(`已保存 · 版本 ${result.revision}`);
    } catch (error) { setStatus(message(error)); throw error; }
    finally { setBusy(false); }
  }

  async function generate() {
    clearImages();
    const abort = new AbortController(); controller.current = abort;
    setExporting(true);
    try {
      await currentSession();
      const node = exportNode.current?.querySelector<HTMLElement>(".note-card");
      if (!node) throw new Error("预览尚未就绪。");
      const result = await renderPng(node, abort.signal);
      setPages(result); setStatus(`PNG 已在本机生成，共 ${result.length} 张。`);
    } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(message(error)); }
    finally { setExporting(false); }
  }

  async function refreshFolders() {
    try {
      const result = await api<{ paths: string[] }>("authorized-folders");
      if (!Array.isArray(result.paths) || result.paths.some((value) => typeof value !== "string")) throw new Error("系统授权响应格式不正确。");
      setFolders(result.paths); setFileStatus(result.paths.length ? "当前用户的授权目录已刷新。" : "当前用户尚无授权目录。");
    }
    catch (error) { setFileStatus(message(error)); }
  }
  async function authorize() {
    if (session?.simulation) { setFileStatus("开发机不能模拟真实系统授权，请在 NAS 安装后验证。"); return; }
    try {
      if (dirty) await save();
      const active = await currentSession();
      const app = sdk.current || new TrimApp(); sdk.current = app;
      await app.ready();
      if (app.isStandaloneWeb) {
        const state = Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) => value.toString(16).padStart(2, "0")).join("");
        sessionStorage.setItem(AUTH_STATE_KEY, JSON.stringify({ state, uid: active.user.uid }));
        await app.openAppAuth("pickUserFile", { appName: "fnnotes-m0", directory: true, redirectUri: BASE + "auth-callback.html", state }, { target: "_self" });
      } else {
        const result = await app.pickUserFile({ directory: true, title: "为拾光便签授权目录" });
        if (result && result.code !== 0) throw new Error("文件授权未完成。");
        await refreshFolders();
      }
    } catch (error) { setFileStatus(message(error)); }
  }
  async function checkAcl(folder: string) {
    try {
      const active = await currentSession();
      const result = await api<{ permissions: Array<{ readable: boolean; writable: boolean; deletable: boolean }> }>("file-acl", writeOptions(active, { path: folder }, "POST"));
      const acl = result.permissions[0];
      setFileStatus(acl ? `读：${acl.readable ? "允许" : "拒绝"}；写：${acl.writable ? "允许" : "拒绝"}；删除：${acl.deletable ? "允许" : "拒绝"}` : "系统未返回该目录权限。");
    } catch (error) { setFileStatus(message(error)); }
  }

  return <main>
    <header className="app-header"><img src={BASE + "note-icon.png"} width="42" height="42" alt="" /><div><h1>拾光便签</h1><p>原生预检版 · M0</p></div><span className="identity">{session ? `${session.user.username} · UID ${session.user.uid}${session.user.isAdmin ? " · 管理员" : ""}` : "等待系统身份"}</span></header>
    <aside className="notice">{session?.simulation ? "当前使用开发机模拟网关，不代表飞牛登录或授权已经通过验证。" : "此版本用于验证系统身份、用户保存、文件授权和本机 PNG；完整便签与共享空间尚未接入。"}</aside>
    <div className="toolbar"><button onClick={() => { void save().catch(() => {}); }} disabled={!loaded || busy || exporting}>{busy ? "正在保存…" : "保存便签"}</button><button onClick={() => { void generate(); }} disabled={!loaded || busy || exporting}>{exporting ? "正在生成…" : "生成 PNG"}</button><label>便签主题<select value={theme} onChange={(event) => { clearImages(); setTheme(event.target.value); }}><option value="paper">暖白纸面</option><option value="night">深色便签</option></select></label><span role="status">{status}{dirty ? " · 有未保存修改" : ""}</span></div>
    {session ? <div className="workspace"><section className="editor"><h2>编辑便签</h2><textarea aria-label="便签正文" value={text} maxLength={50_000} disabled={!loaded || busy || exporting} onChange={(event) => { clearImages(); setText(event.target.value); setDirty(true); }} /></section><section className="preview"><h2>便签预览</h2><Note text={text} theme={theme} /></section></div> : <section className="empty"><p>请通过飞牛桌面入口打开应用。预检版不提供独立密码登录。</p></section>}
    {pages.length > 0 && <section className="png-result"><h2>导出预览 · {pages.length} 张</h2><p>PNG 已在当前设备生成。选择图片保存，取消保存不会改变便签。</p><div className="png-grid">{pages.map((page, i) => <div key={page.filename}><img src={page.url} alt={`导出预览第 ${i + 1} 张`} /><button onClick={() => { void savePng(page).catch((error) => setStatus(message(error))); }}>保存第 {i + 1} 张 PNG</button></div>)}</div></section>}
    <section className="system-panel"><h2>系统能力预检</h2><p>{platform}</p><p>当前后端系统 API：{session?.systemApiConfigured ? "已注入运行凭据，实际调用仍需验证" : "尚未配置"}</p><div className="actions"><button disabled={!session || busy} onClick={() => { void authorize(); }}>选择并授权目录</button><button disabled={!session} onClick={() => { void refreshFolders(); }}>刷新授权状态</button></div><p role="status">{fileStatus}</p>{folders.map((folder) => <div className="folder" key={folder}><code>{folder}</code><button onClick={() => { void checkAcl(folder); }}>检查当前用户权限</button></div>)}</section>
    <div className="export-root" ref={exportNode} aria-hidden="true"><Note text={text} theme={theme} /></div>
  </main>;
}
