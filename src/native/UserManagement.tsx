import { useCallback, useEffect, useState } from "react";
import { ChangePasswordDialog } from "../components/ChangePasswordDialog.js";
import {
  formatAccountDate,
  NativeApiError,
  nativeJson,
  nativeWrite,
  useNativeSession,
  type ManagedUser,
} from "./api.js";

interface Credential {
  password: string;
  username: string;
}

// 用户管理：飞牛托管账号（nas-<uid>）与应用自建账号（uuid）都是独立租户，
// 各自的工作区与图片目录按账号 id 隔离；管理员可建号、重置密码、停用与删除。
export function UserManagement() {
  const session = useNativeSession();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [status, setStatus] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [credential, setCredential] = useState<Credential | null>(null);
  const [busy, setBusy] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<ManagedUser | null>(null);
  // 普通账号调不动账号接口：直接不渲染这一段，而不是给用户看一个 403。
  const [isVisible, setIsVisible] = useState(true);
  const isAdmin = session?.user.isAdmin ?? false;

  const refreshUsers = useCallback(async (): Promise<void> => {
    const data = await nativeJson<{ currentUserId: string; users: ManagedUser[] }>(
      "/api/fnos/users",
    );
    setCurrentUserId(data.currentUserId);
    setUsers(data.users);
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    void refreshUsers().catch((error) => {
      if (error instanceof NativeApiError && error.status === 403) {
        setIsVisible(false);
        return;
      }

      setStatus(error instanceof Error ? error.message : "读取账号列表失败。");
    });
  }, [isAdmin, refreshUsers]);

  if (!isVisible || !isAdmin) {
    return null;
  }

  async function run(operation: () => Promise<void>): Promise<void> {
    if (busy) {
      return;
    }

    setBusy(true);

    try {
      await operation();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "操作失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  function createUser() {
    const username = newUsername.trim();

    if (!username) {
      setStatus("请输入用户名或邮箱。");
      return;
    }

    void run(async () => {
      const data = await nativeJson<{
        initialPassword: string;
        user: ManagedUser;
      }>("/api/fnos/users", nativeWrite({ username }, "POST"));
      setCredential({
        password: data.initialPassword,
        username: data.user.username,
      });
      setNewUsername("");
      await refreshUsers();
    });
  }

  function resetPassword(user: ManagedUser) {
    void run(async () => {
      const data = await nativeJson<{ temporaryPassword?: string }>(
        `/api/fnos/users/${user.id}`,
        nativeWrite({ resetPassword: true }, "PATCH"),
      );

      if (data.temporaryPassword) {
        setCredential({
          password: data.temporaryPassword,
          username: user.username,
        });
      }

      await refreshUsers();
    });
  }

  // 管理员直接给某个账号设定新密码，不必再生成一次性密码让本人自己改。
  function setDisabled(user: ManagedUser, disabled: boolean) {
    void run(async () => {
      await nativeJson(
        `/api/fnos/users/${user.id}`,
        nativeWrite({ disabled }, "PATCH"),
      );
      await refreshUsers();
    });
  }

  function removeUser(user: ManagedUser) {
    if (
      !confirm(
        `删除「${user.username}」会同时删除它名下的便签、图片和共享空间，且无法恢复。确认删除？`,
      )
    ) {
      return;
    }

    void run(async () => {
      await nativeJson(`/api/fnos/users/${user.id}`, { method: "DELETE" });
      await refreshUsers();
    });
  }

  return (
    // 必须套 .native-settings：原生设置的表单/按钮/列表样式都挂在这个作用域下，
    // 否则这一块会退回浏览器默认外观，与「账号与同步」其它卡片不一致。
    <div className="native-settings">
      <section className="settings-group" aria-label="用户管理">
        <div className="settings-group-heading">
          <strong>用户管理</strong>
          <small>
            飞牛账号首次打开应用时自动建立；也可创建与应用密码配套的独立账号。每个账号各自一份便签数据。
          </small>
        </div>
        <p className={`native-feedback${status ? " is-visible" : ""}`} role="status">
          {status}
        </p>

        <div className="settings-card native-form-card">
          <label className="native-field">
            <span>新建独立账号</span>
            <div className="native-input-action">
              <input
                aria-label="新账号用户名或邮箱"
                maxLength={254}
                placeholder="用户名或邮箱"
                value={newUsername}
                onChange={(event) => setNewUsername(event.target.value)}
              />
              <button className="native-primary" disabled={busy} onClick={createUser}>
                创建账号
              </button>
            </div>
          </label>
          <p className="native-help">
            创建后显示一次性密码，请转交本人并在「账号与同步」里改成自己的密码；密码为 8–128 位。
          </p>
        </div>

        {credential ? (
          <p className="native-credential" role="status">
            <span>
              {credential.username} 的密码：<code>{credential.password}</code>
            </span>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(credential.password);
              }}
            >
              复制
            </button>
            <button onClick={() => setCredential(null)}>我已转交，关闭</button>
          </p>
        ) : null}

        <div className="settings-card native-user-list">
          {users.length === 0 ? (
            <p className="native-help">还没有账号使用过这个应用。</p>
          ) : (
            users.map((user) => (
              <div className="native-user-row" key={user.id}>
                <span className="native-user-copy">
                  <strong>{user.username}</strong>
                  <small>
                    {user.kind === "nas" ? `飞牛账号 · UID ${user.uid}` : "独立账号"}
                    {" · "}
                    {formatAccountDate(user.createdAt)} 首次使用
                    {user.hasPassword ? " · 已设应用密码" : " · 未设应用密码"}
                    {user.disabled ? " · 已停用" : ""}
                  </small>
                </span>
                <span className="native-user-actions">
                  <button disabled={busy} onClick={() => setPasswordTarget(user)}>
                    设置密码
                  </button>
                  <button disabled={busy} onClick={() => resetPassword(user)}>
                    重置密码
                  </button>
                  <button
                    disabled={busy || user.id === currentUserId}
                    onClick={() => setDisabled(user, !user.disabled)}
                  >
                    {user.disabled ? "启用" : "停用"}
                  </button>
                  {user.kind === "app" ? (
                    <button
                      className="native-danger"
                      disabled={busy || user.id === currentUserId}
                      onClick={() => removeUser(user)}
                    >
                      删除
                    </button>
                  ) : null}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
      {passwordTarget ? (
        <ChangePasswordDialog
          initialSetup
          title={`设置「${passwordTarget.username}」的新密码`}
          description="管理员设置密码不需要旧密码。请输入新密码并再次确认；保存后该账号在其他设备上的旧登录会失效。"
          successTitle="密码已设置"
          successMessage="该账号下次登录需要使用刚设置的新密码。"
          changePassword={async (_currentPassword, newPassword) => {
            await nativeJson(
              `/api/fnos/users/${passwordTarget.id}`,
              nativeWrite({ newPassword }, "PATCH"),
            );
            setStatus(`已更新「${passwordTarget.username}」的密码。`);
            await refreshUsers();
          }}
          onClose={() => setPasswordTarget(null)}
        />
      ) : null}
    </div>
  );
}
