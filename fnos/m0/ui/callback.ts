import { TrimApp } from "@trimjs/web-app";
import { api, AUTH_STATE_KEY, BASE, writeOptions, type Session } from "./api";

const status = document.getElementById("status")!;
async function callback() {
  try {
    const result = new TrimApp().parseAppAuthCallback(location.href);
    const pending = JSON.parse(sessionStorage.getItem(AUTH_STATE_KEY) || "null");
    sessionStorage.removeItem(AUTH_STATE_KEY);
    const session = await api<Session>("auth/session");
    if (!pending || result.state !== pending.state || pending.uid !== session.user.uid || result.appName !== "fnnotes-m0" || result.method !== "pickUserFile" || !["success", "cancel", "error"].includes(result.status || "")) throw new Error("授权回调校验失败，请重新发起授权。");
    if (result.status === "error") throw new Error("系统没有完成文件授权。");
    // 系统选择器返回的目录要立刻写回应用数据目录：页面跳回后、刷新后、
    // 或从共享空间返回时都还能读回同一份授权列表。
    const paths = (result.path || []).filter((item) => typeof item === "string" && item.startsWith("/"));
    if (result.status === "success" && paths.length) {
      await api(
        "authorized-folders",
        writeOptions(session, { paths }, "POST"),
      ).catch(() => undefined);
    }
    status.textContent = result.status === "cancel" ? "已取消授权，正在返回。" : "授权回调已校验，正在返回便签。";
    location.replace(BASE);
  } catch (error) { status.textContent = error instanceof Error ? error.message : "授权回调失败。"; }
}
void callback();
