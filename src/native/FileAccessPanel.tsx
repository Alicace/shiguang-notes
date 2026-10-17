import { useEffect, useState } from "react";
import { appPath } from "../lib/fnos-client.js";
import { recorder } from "../../fnos/m0/ui/diagnostics.js";
import { AUTH_STATE_KEY } from "../../fnos/m0/ui/api.js";
import { nativeJson, nativeWrite, useNativeSession } from "./api.js";

interface FolderPermissions {
  deletable: boolean;
  readable: boolean;
  writable: boolean;
}

type TrimAppInstance = InstanceType<
  typeof import("@trimjs/web-app").TrimApp
>;

// 目录授权与权限：用飞牛系统选择器授权目录，再用系统 API 复核当前用户的读写删权限。
export function FileAccessPanel() {
  const session = useNativeSession();
  const [folders, setFolders] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  // 宿主凭据可以在打开面板时自动补齐；就绪后就不再显示"未配置"警告。
  const [apiConfigured, setApiConfigured] = useState(false);

  async function loadTrimApp(): Promise<TrimAppInstance> {
    const { TrimApp } = await import("@trimjs/web-app");
    const app = new TrimApp();
    await app.ready();
    return app;
  }

  // 宿主凭据是所有系统文件接口的前提。拿到后登记进应用数据目录，
  // 重启应用或刷新页面都能直接复用，不必让用户反复授权同一个目录。
  async function registerHostCredential(app: TrimAppInstance): Promise<boolean> {
    const credentials = await app.getSessionCredentials().catch(() => null);

    if (!credentials || credentials.code !== 0) {
      return false;
    }

    const result = await nativeJson<{ configured: boolean }>(
      "/api/fnos/system-credential",
      nativeWrite({ secret: credentials.data.secret }, "POST"),
    );
    return result.configured;
  }

  async function refreshFolders(): Promise<string[]> {
    recorder.action("system.refresh");
    const data = await nativeJson<{ configured?: boolean; paths: string[] }>(
      "/api/authorized-folders",
    );
    setFolders(data.paths);
    setApiConfigured(data.configured !== false);
    return data.paths;
  }

  // 选择器只会在回调里带回是否成功，不带回路径；这里把当前用户的授权目录写进
  // 应用数据目录，刷新页面或从共享空间返回后仍能读回同一个列表。
  async function rememberFolders(paths: string[]): Promise<string[]> {
    if (!paths.length) return [];
    const data = await nativeJson<{ paths: string[] }>(
      "/api/authorized-folders",
      {
        ...nativeWrite({ paths }, "POST"),
        headers: {
          "Content-Type": "application/json",
          "X-Fnnotes-Host-Picker": "1",
        },
      },
    );
    return data.paths;
  }

  useEffect(() => {
    if (session?.simulation) {
      return;
    }

    let active = true;

    void (async () => {
      try {
        const app = await loadTrimApp();
        await registerHostCredential(app);
        if (active) await refreshFolders();
      } catch (error) {
        if (active) {
          setStatus(error instanceof Error ? error.message : "读取授权目录失败。");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [session?.simulation]);

  function run(operation: () => Promise<void>): void {
    void operation().catch((error) => {
      recorder.error(error instanceof Error ? error.name : "Error");
      setStatus(error instanceof Error ? error.message : "操作失败。");
    });
  }

  async function authorize(): Promise<void> {
    recorder.action("system.authorize");

    if (session?.simulation) {
      throw new Error(
        "当前是开发机模拟网关，无法代替 NAS 的系统目录选择器；请在 NAS 上授权目录。",
      );
    }

    const app = await loadTrimApp();
    const configured = await registerHostCredential(app);
    if (configured) setApiConfigured(true);

    if (app.isStandaloneWeb) {
      const state = Array.from(
        crypto.getRandomValues(new Uint8Array(32)),
        (value) => value.toString(16).padStart(2, "0"),
      ).join("");
      sessionStorage.setItem(
        AUTH_STATE_KEY,
        JSON.stringify({ state, uid: session!.user.uid }),
      );
      await app.openAppAuth(
        "pickUserFile",
        {
          appName: "fnnotes-m0",
          directory: true,
          redirectUri: appPath("/auth-callback.html"),
          state,
        },
        { target: "_self" },
      );
      return;
    }

    const picked = await app.pickUserFile({
      directory: true,
      title: "选择要授权给拾光便签的目录",
    });
    const pickedPaths = Array.isArray(picked?.data) ? picked!.data : [];
    if (!pickedPaths.length) {
      setStatus("已取消目录授权。");
      return;
    }
    const stored = await rememberFolders(pickedPaths);
    setStatus(
      stored.length
        ? `已授权：${stored.join("、")}`
        : "宿主已返回目录，但应用没有保存成功。",
    );
    await refreshFolders();
  }

  return (
    <div className="native-settings">
      <header className="settings-pane-header">
        <h3>文件授权</h3>
        <p>通过飞牛系统选择器授权目录，并按当前账号复核读写权限。</p>
      </header>

      <section className="settings-group" aria-label="飞牛目录授权与权限">
        <div className="settings-card native-form-card">
          {session && !apiConfigured ? (
            <p className="native-warning" role="alert">
              ACL 自动检查接口还没拿到飞牛的系统凭据；目录选择器返回的宿主授权路径仍会保存。
              若需要进一步自动复核文件 ACL，可在应用数据目录放 <code>api-token</code>，或设置环境变量{" "}
              <code>TRIM_API_TOKEN</code>。
            </p>
          ) : null}
          <div className="native-actions">
            <button
              className="native-primary"
              onClick={() =>
                run(async () => {
                  setStatus("正在打开系统目录选择器…");
                  await authorize();
                  await refreshFolders().catch(() => undefined);
                })
              }
            >
              选择并授权目录
            </button>
            <button
              onClick={() =>
                run(async () => {
                  const paths = await refreshFolders();
                  setStatus(
                    paths.length > 0
                      ? `当前已授权 ${paths.length} 个目录。`
                      : "当前没有可用的授权目录。",
                  );
                })
              }
            >
              刷新授权状态
            </button>
          </div>
          <p
            className={`native-feedback${status ? " is-visible" : ""}`}
            role="status"
          >
            {status}
          </p>
          {folders.map((folder) => (
            <div className="native-folder-row" key={folder}>
              <code>{folder}</code>
              <button
                onClick={() =>
                  run(async () => {
                    recorder.action("system.acl");
                    setStatus(`正在检查 ${folder} 的权限…`);
                    const data = await nativeJson<{
                      permissions: FolderPermissions[];
                    }>("/api/file-acl", nativeWrite({ path: folder }));
                    setStatus(
                      data.permissions
                        .map(
                          ({ readable, writable, deletable }) =>
                            `读：${readable ? "允许" : "拒绝"} · 写：${writable ? "允许" : "拒绝"} · 删除：${deletable ? "允许" : "拒绝"}`,
                        )
                        .join("；"),
                    );
                  })
                }
              >
                检查当前用户 ACL
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
