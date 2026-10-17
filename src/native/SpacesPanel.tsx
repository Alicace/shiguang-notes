import { useCallback, useEffect, useState } from "react";
import { currentSpace } from "../lib/fnos-client.js";
import { recorder } from "../../fnos/m0/ui/diagnostics.js";
import {
  nativeJson,
  nativeWrite,
  useNativeSession,
  type ManagedUser,
  type Space,
} from "./api.js";

interface SpacesPanelProps {
  onSpaceChange: (scope: string) => Promise<void>;
}

// 共享空间：创建工作区、按账号授权成员、切换与删除。成员既可从账号列表挑，
// 也可以直接填 NAS UID 先邀请（对方首次登录后再生效）。
export function SpacesPanel({ onSpaceChange }: SpacesPanelProps) {
  const session = useNativeSession();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [uid, setUid] = useState("");
  const [role, setRole] = useState("viewer");
  const [memberUserId, setMemberUserId] = useState("");
  const [status, setStatus] = useState("");

  const refreshSpaces = useCallback(async () => {
    const data = await nativeJson<{ privateScope: string; spaces: Space[] }>(
      "/api/fnos/spaces",
    );
    setUserId(data.privateScope);
    setSpaces(data.spaces);
  }, []);

  useEffect(() => {
    let active = true;
    const isAdmin = session?.user.isAdmin ?? false;

    void (async () => {
      try {
        await refreshSpaces();
        // 账号列表只有管理员能读：普通账号直接按 NAS UID 邀请，不发这个必定 403 的请求。
        const data = isAdmin
          ? await nativeJson<{ users: ManagedUser[] }>("/api/fnos/users").catch(
              () => ({ users: [] }),
            )
          : { users: [] };
        if (active) setUsers(data.users);
      } catch (error) {
        if (active) {
          setStatus(error instanceof Error ? error.message : "读取共享空间失败。");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [refreshSpaces, session?.user.isAdmin]);

  function run(operation: () => Promise<void>): void {
    void operation().catch((error) => {
      recorder.error(error instanceof Error ? error.name : "Error");
      setStatus(error instanceof Error ? error.message : "操作失败。");
    });
  }

  const owned = spaces.filter((space) => space.ownerId === userId);

  return (
    <div className="native-settings">
      <header className="settings-pane-header">
        <h3>共享空间</h3>
        <p>把便签放进共享工作区，按成员分配可编辑或只读权限。</p>
      </header>
      <p className={`native-feedback${status ? " is-visible" : ""}`} role="status">
        {status}
      </p>

      <div className="settings-card native-form-card">
        <label className="native-field">
          <span>当前工作区</span>
          <select
            aria-label="选择共享空间"
            value={currentSpace()}
            onChange={(event) => {
              const value = event.target.value;
              run(() => onSpaceChange(value));
            }}
          >
            <option value="">私有便签</option>
            {spaces.map((space) => (
              <option key={space.id} value={`space-${space.id}`}>
                {space.name} ·{" "}
                {space.ownerId === userId
                  ? "所有者"
                  : space.members[userId] === "editor"
                    ? "可编辑"
                    : "只读"}
              </option>
            ))}
          </select>
        </label>
        {/* 已经在私有便签时这个按钮没有意义，只在共享空间里出现。 */}
        {currentSpace() ? (
          <div className="native-actions">
            <button onClick={() => run(() => onSpaceChange(""))}>返回私有便签</button>
          </div>
        ) : null}
        <label className="native-field">
          <span>创建共享空间</span>
          <div className="native-input-action">
            <input
              aria-label="新共享空间名称"
              maxLength={60}
              placeholder="输入空间名称"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button
              className="native-primary"
              onClick={() =>
                run(async () => {
                  recorder.action("space.create");
                  await nativeJson("/api/fnos/spaces", nativeWrite({ name }));
                  setName("");
                  await refreshSpaces();
                })
              }
            >
              创建共享空间
            </button>
          </div>
        </label>
      </div>

      {owned.map((space) => {
        // 所有者本人不需要被加成成员（服务端会拒绝），因此不列进成员账号选择器。
        const memberCandidates = users.filter((user) => user.id !== space.ownerId);

        return (
          <div className="settings-card native-space-list" key={space.id}>
            <details className="native-space">
              <summary>{space.name} · 管理成员</summary>
              <div className="native-space-content">
                <p className="native-help">
                  所有者管理成员；编辑成员可修改，只读成员可查看和导出。
                </p>
                {memberCandidates.length === 0 ? (
                  <p className="native-help">
                    还没有其他账号可以加入：可以按下面的 NAS UID 邀请，或在「账号与同步 → 用户管理」里新建独立账号。
                  </p>
                ) : null}
                {/* 常用路径：直接从已有账号里勾人，不再要求手填 NAS UID。 */}
                {memberCandidates.length > 0 ? (
                  <div className="native-member-candidates">
                    {memberCandidates.map((user) => {
                      const already = Object.hasOwn(space.members, user.id);

                      return (
                        <button
                          key={user.id}
                          type="button"
                          className={`native-candidate${memberUserId === user.id ? " is-selected" : ""}${already ? " is-member" : ""}`}
                          aria-pressed={memberUserId === user.id}
                          onClick={() => {
                            setMemberUserId(memberUserId === user.id ? "" : user.id);
                            setUid("");
                          }}
                        >
                          <strong>{user.username}</strong>
                          <small>
                            {user.kind === "nas" ? `飞牛账号 · UID ${user.uid}` : "独立账号"}
                            {already ? " · 已在空间内" : ""}
                          </small>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                <div className="native-fields-grid">
                  <label className="native-field">
                    <span>成员权限</span>
                    <select
                      aria-label="成员权限"
                      value={role}
                      onChange={(event) => setRole(event.target.value)}
                    >
                      <option value="viewer">只读</option>
                      <option value="editor">可编辑</option>
                    </select>
                  </label>
                </div>
                <details className="native-invite-uid">
                  <summary>邀请还没用过本应用的 NAS 用户</summary>
                  <label className="native-field">
                    <span>成员 NAS UID</span>
                    <input
                      aria-label="成员 NAS UID"
                      inputMode="numeric"
                      placeholder="从 NAS 用户信息确认"
                      value={uid}
                      onChange={(event) => {
                        setUid(event.target.value);
                        if (event.target.value) setMemberUserId("");
                      }}
                    />
                  </label>
                </details>
                <div className="native-actions">
                  <button
                    className="native-primary"
                    onClick={() =>
                      run(async () => {
                        recorder.action("space.members");
                        await nativeJson(
                          `/api/fnos/spaces/${space.id}/members`,
                          nativeWrite(
                            memberUserId
                              ? { role, userId: memberUserId }
                              : { role, uid },
                            "PUT",
                          ),
                        );
                        await refreshSpaces();
                      })
                    }
                  >
                    为此空间添加/更新成员
                  </button>
                </div>
                {Object.entries(space.members).map(([id, permission]) => {
                  const account = users.find((user) => user.id === id);

                  return (
                    <div className="native-member-row" key={id}>
                      <span>
                        <strong>{account ? account.username : `UID ${id.slice(4)}`}</strong>
                        <small>{permission === "editor" ? "可编辑" : "只读"}</small>
                      </span>
                      <button
                        onClick={() =>
                          run(async () => {
                            await nativeJson(
                              `/api/fnos/spaces/${space.id}/members`,
                              nativeWrite({ role: "remove", userId: id }, "PUT"),
                            );
                            await refreshSpaces();
                          })
                        }
                      >
                        撤销成员权限
                      </button>
                    </div>
                  );
                })}
                <div className="native-actions">
                  <button
                    className="native-danger"
                    onClick={() => {
                      if (
                        !confirm(
                          "删除共享空间后，成员无法继续访问。确认删除这个共享空间？",
                        )
                      ) {
                        return;
                      }

                      run(async () => {
                        await nativeJson(`/api/fnos/spaces/${space.id}`, {
                          method: "DELETE",
                        });
                        await refreshSpaces();
                      });
                    }}
                  >
                    删除此共享空间
                  </button>
                </div>
              </div>
            </details>
          </div>
        );
      })}
    </div>
  );
}
