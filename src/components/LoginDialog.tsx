import { appPath } from "../lib/fnos-client.js";
import { useState, type FormEvent } from "react";
import type { AuthUser } from "../lib/auth.js";

interface LoginDialogProps {
  error?: string;
  isAdmin?: boolean;
  nasLogin?: {
    isBusy?: boolean;
    onAuthorize: () => void;
  };
  note?: string;
  title?: string;
  login: (
    username: string,
    password: string,
    remember: boolean,
  ) => Promise<AuthUser>;
  onAuthenticated: (user: AuthUser) => void | Promise<void>;
  onClose?: () => void;
}

export function LoginDialog({
  error: externalError,
  isAdmin = false,
  nasLogin,
  note,
  title,
  login,
  onAuthenticated,
  onClose,
}: LoginDialogProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    try {
      setIsSubmitting(true);
      setError("");
      const user = await login(username, password, remember);
      await onAuthenticated(user);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className={`login-dialog-backdrop${isAdmin ? " is-admin" : ""}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose?.();
        }
      }}
    >
      <section
        className="login-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-dialog-title"
      >
        {onClose ? (
          <button
            type="button"
            className="login-dialog-close"
            aria-label="关闭登录窗口"
            onClick={onClose}
          >
            ×
          </button>
        ) : null}

        <img
          className="login-dialog-logo"
          src={appPath("/brand/shiguang-app-icon.png")}
          alt="拾光便签"
          width="72"
          height="72"
        />
        <h1 id="login-dialog-title">
          {isAdmin ? `${title ?? "拾光便签"}后台` : (title ?? "拾光便签")}
        </h1>

        <div className="login-dialog-tabs" aria-hidden="true">
          <span className="is-active">
            {isAdmin ? "管理员登录" : "账号密码登录"}
          </span>
        </div>

        <form className="login-dialog-form" onSubmit={handleSubmit}>
          <label>
            <span className="visually-hidden">用户名或邮箱</span>
            <input
              type="text"
              name="username"
              autoComplete="username"
              placeholder="用户名或邮箱"
              value={username}
              required
              autoFocus
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>

          <label className="login-dialog-password-field">
            <span className="visually-hidden">密码</span>
            <input
              type={isPasswordVisible ? "text" : "password"}
              name="password"
              autoComplete="current-password"
              placeholder="密码"
              value={password}
              required
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              className="login-dialog-password-toggle"
              aria-label={isPasswordVisible ? "隐藏密码" : "显示密码"}
              aria-pressed={isPasswordVisible}
              title={isPasswordVisible ? "隐藏密码" : "显示密码"}
              onClick={() => setIsPasswordVisible((isVisible) => !isVisible)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2.2 12s3.5-6 9.8-6 9.8 6 9.8 6-3.5 6-9.8 6-9.8-6-9.8-6Z" />
                <circle cx="12" cy="12" r="2.8" />
                {isPasswordVisible ? null : (
                  <path className="login-dialog-eye-slash" d="m4 4 16 16" />
                )}
              </svg>
            </button>
          </label>

          <label className="login-dialog-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <span>记住密码</span>
          </label>

          {error || externalError ? (
            <p className="login-dialog-error" role="alert">
              {error || externalError}
            </p>
          ) : null}

          <button
            type="submit"
            className="login-dialog-submit"
            disabled={isSubmitting || !username.trim() || !password}
          >
            {isSubmitting ? "登录中..." : "登录"}
          </button>
        </form>

        {nasLogin ? (
          <div className="login-dialog-nas">
            <button
              type="button"
              className="login-dialog-nas-button"
              disabled={nasLogin.isBusy}
              onClick={nasLogin.onAuthorize}
            >
              {nasLogin.isBusy ? "正在授权…" : "使用 NAS 登录"}
            </button>
            <p className="login-dialog-nas-hint">
              从飞牛桌面进入时可用，免密授权，不收集 NAS 密码。
            </p>
          </div>
        ) : null}

        <p className="login-dialog-note">
          {note ??
            (isAdmin
              ? "管理员凭据由服务端环境变量提供。"
              : "登录后便签自动保存到云端，并支持跨设备同步。")}
        </p>
      </section>
    </div>
  );
}
