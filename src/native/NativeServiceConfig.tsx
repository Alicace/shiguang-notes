import { useState } from "react";
import { nativeJson, nativeWrite, useNativeSession } from "./api.js";
import { recorder } from "../../fnos/m0/ui/diagnostics.js";

const CONFIG_LABELS: Record<string, string> = {
  OPENAI_API_KEY: "AI API Key",
  OPENAI_BASE_URL: "AI 服务地址",
  OPENAI_MODEL: "模型名称",
  QINIU_ACCESS_KEY: "七牛 Access Key",
  QINIU_BUCKET: "存储空间名称",
  QINIU_DOMAIN: "图片访问域名",
  QINIU_PREFIX: "图片目录前缀",
  QINIU_SECRET_KEY: "七牛 Secret Key",
};

const AI_KEYS = ["OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_API_KEY"];
const QINIU_KEYS = [
  "QINIU_ACCESS_KEY",
  "QINIU_SECRET_KEY",
  "QINIU_BUCKET",
  "QINIU_DOMAIN",
  "QINIU_PREFIX",
];

export function NativeServiceConfig() {
  const session = useNativeSession();
  const [status, setStatus] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});

  if (!session?.user.isAdmin) {
    return null;
  }

  function run(operation: () => Promise<void>): void {
    void operation().catch((error) => {
      recorder.error(error instanceof Error ? error.name : "Error");
      setStatus(error instanceof Error ? error.message : "操作失败。");
    });
  }

  function renderFields(keys: string[]) {
    return keys.map((key) => (
      <label className="native-field" key={key}>
        <span>{CONFIG_LABELS[key]}</span>
        <input
          aria-label={key}
          autoComplete="off"
          type={/KEY/.test(key) ? "password" : "text"}
          value={config[key] || ""}
          onChange={(event) =>
            setConfig((old) => ({ ...old, [key]: event.target.value }))
          }
        />
      </label>
    ));
  }

  return (
    <div className="native-settings">
      <section className="settings-group" aria-label="管理员服务配置">
        <div className="settings-group-heading">
          <strong>可选云端服务</strong>
          <small>
            这些配置会被真实功能调用，但对普通便签不是必需的。密钥只保存在当前 NAS，
            保存后不回显。
          </small>
        </div>
        <div className="settings-card native-form-card">
          <div className="native-actions">
            <button
              onClick={() =>
                run(async () => {
                  const data = await nativeJson<Record<string, string | boolean>>(
                    "/api/fnos/config",
                  );
                  setConfig(
                    Object.fromEntries(
                      Object.entries(data).filter(
                        (entry): entry is [string, string] =>
                          typeof entry[1] === "string",
                      ),
                    ),
                  );
                  setStatus(
                    `AI：${data.aiConfigured ? "已配置" : "未配置"}；公众号图片上传：${data.qiniuConfigured ? "已配置" : "未配置"}`,
                  );
                })
              }
            >
              读取配置状态
            </button>
          </div>

          <div className="native-service-section">
            <strong>AI 审阅</strong>
            <p className="native-help">
              供便签编辑器的「AI 审阅」调用。未配置时，AI 按钮不会出现；记便签、预览和
              导出 PNG 不受影响。
            </p>
            <div className="native-config-grid">{renderFields(AI_KEYS)}</div>
          </div>

          <div className="native-service-section">
            <strong>公众号图片上传</strong>
            <p className="native-help">
              仅在「复制到公众号 / 发布为公众号草稿」且便签含图片或自定义页脚时使用，
              用于把图片上传到七牛。纯文字公众号内容、普通便签和 PNG 不需要这里。
            </p>
            <div className="native-config-grid">{renderFields(QINIU_KEYS)}</div>
          </div>

          <p className="native-help">
            公众号 AppID / Secret 不属于全局服务配置，仍在「工具与扩展」里按登录账号保存。
          </p>
          <div className="native-actions">
            <button
              className="native-primary"
              onClick={() =>
                run(async () => {
                  const data = await nativeJson<{ aiAvailable: boolean }>(
                    "/api/fnos/config",
                    nativeWrite(config, "PUT"),
                  );
                  setConfig((old) =>
                    Object.fromEntries(
                      Object.entries(old).filter(([key]) => !/KEY/.test(key)),
                    ),
                  );
                  setStatus(
                    `配置已保存。AI 连接：${data.aiAvailable ? "可用" : "尚不可用，请核对配置"}；刷新页面后更新 AI 入口。`,
                  );
                })
              }
            >
              保存服务配置
            </button>
          </div>
          <p
            className={`native-feedback${status ? " is-visible" : ""}`}
            role="status"
          >
            {status}
          </p>
        </div>
      </section>
    </div>
  );
}
