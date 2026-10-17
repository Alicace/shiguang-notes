import { appPath } from "../lib/fnos-client.js";
import { useAppUpdate } from "./AppUpdateProvider.js";

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function formatSpeed(value: number): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB/s`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB/s`;
  return `${Math.max(0, value)} B/s`;
}

function releaseNoteLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^#{1,6}\s+/.test(line))
    .map((line) =>
      line
        .replace(/^[-*]\s*/, "")
        .replace(/\*\*/g, "")
        .replace(/`/g, ""),
    )
    .slice(0, 6);
}

export function AppUpdatePrompt() {
  const update = useAppUpdate();
  if (!update.isPromptOpen || !update.latestUpdate) return null;

  const latest = update.latestUpdate;
  const busy = ["downloading", "installing", "waiting-restart"].includes(
    update.status,
  );
  const percent =
    update.status === "waiting-restart"
      ? 100
      : Math.max(0, Math.min(100, update.progress?.percent || 0));
  const notes = releaseNoteLines(latest.releaseNotes);

  return (
    <div
      className="app-update-dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) update.closePrompt();
      }}
    >
      <section
        className="app-update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-update-title"
      >
        <header className="app-update-dialog-header">
          <img src={appPath("/brand/shiguang-app-icon.png")} alt="" />
          <div>
            <span className="app-update-eyebrow">发现新版本</span>
            <h2 id="app-update-title">
              拾光便签 {latest.version}
            </h2>
          </div>
          <button
            type="button"
            aria-label="稍后更新"
            disabled={busy}
            onClick={update.dismissPrompt}
          >
            ×
          </button>
        </header>

        <p className="app-update-summary">
          当前版本 {update.currentVersion}。{update.message || "新版本已准备好下载。"}
        </p>

        <details className="app-update-release-notes">
          <summary>查看更新内容</summary>
          {notes.length ? (
            <ul>
              {notes.map((line, index) => (
                <li key={`${index}-${line}`}>{line}</li>
              ))}
            </ul>
          ) : (
            <p>本次更新包含稳定性与体验改进。</p>
          )}
          <a href={latest.releaseUrl} target="_blank" rel="noopener noreferrer">
            打开完整发布页面
          </a>
        </details>

        {["downloading", "installing", "waiting-restart", "ready"].includes(
          update.status,
        ) ? (
          <div className="app-update-progress-card" aria-live="polite">
            <div className="app-update-progress-heading">
              <strong>
                {update.status === "waiting-restart"
                  ? "正在等待安装完成"
                  : update.status === "installing"
                    ? "正在启动安装器"
                    : update.status === "ready"
                      ? "安装包已校验"
                      : "正在下载并校验"}
              </strong>
              <span>{percent}%</span>
            </div>
            <div
              className="app-update-progress-track"
              role="progressbar"
              aria-label="更新下载进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
            <div className="app-update-progress-meta">
              <span>
                {update.progress
                  ? `${formatBytes(update.progress.receivedBytes)} / ${formatBytes(update.progress.totalBytes)}`
                  : "正在准备…"}
              </span>
              <span>
                {update.progress?.source || "自动选择加速线路"}
                {update.progress?.speedBytesPerSecond
                  ? ` · ${formatSpeed(update.progress.speedBytesPerSecond)}`
                  : ""}
              </span>
            </div>
          </div>
        ) : null}

        {update.status === "error" && update.message ? (
          <p className="app-update-error" role="alert">
            {update.message}
          </p>
        ) : null}

        <footer className="app-update-dialog-actions">
          <button type="button" disabled={busy} onClick={update.dismissPrompt}>
            稍后
          </button>
          {update.status === "ready" && update.installerPath ? (
            <button
              type="button"
              className="is-primary"
              onClick={() => void update.openInstaller()}
            >
              重新打开安装器
            </button>
          ) : update.isAdmin && latest.asset ? (
            <button
              type="button"
              className="is-primary"
              disabled={busy || update.status === "checking"}
              onClick={() => void update.downloadAndInstallUpdate()}
            >
              {update.status === "error"
                ? "重新下载"
                : busy
                  ? "正在更新…"
                  : `下载并更新到 ${latest.version}`}
            </button>
          ) : (
            <a href={latest.releaseUrl} target="_blank" rel="noopener noreferrer">
              查看发布页
            </a>
          )}
        </footer>
      </section>
    </div>
  );
}
