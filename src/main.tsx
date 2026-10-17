import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import changelogMarkdown from "../CHANGELOG.md?raw";
import App from "./App";
import { ChangelogPage } from "./components/ChangelogPage";
import { PromoStudioPage } from "./components/PromoStudioPage";
import { SuperAdminPage } from "./components/SuperAdminPage";
import { installAutoHideScrollbars } from "./lib/auto-hide-scrollbars";
import { getPageTitle } from "./lib/page-title";
import nativeMetadata from "./native/metadata.json";
import "./styles.css";
import { isNative, nativeBase } from "./lib/fnos-client";
import "./native/styles.css";
import {
  AppUpdateProvider,
} from "./updates/AppUpdateProvider";
import { AppUpdatePrompt } from "./updates/AppUpdatePrompt";
import "./updates/update.css";

document.title = isNative ? "拾光便签" : getPageTitle(window.location.hostname);
installAutoHideScrollbars();

const pathname = (isNative ? window.location.pathname.slice(nativeBase.length) : window.location.pathname).replace(/\/+$/, "") || "/";
const rootPage =
  pathname === "/superadmin" && !isNative ? (
    <SuperAdminPage />
  ) : pathname === "/changelog" ? (
    <ChangelogPage markdown={changelogMarkdown} />
  ) : pathname === "/promo/editor" ? (
    <PromoStudioPage mode="editor" />
  ) : pathname === "/promo/pages" ? (
    <PromoStudioPage mode="pages" />
  ) : (
    <App />
  );

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppUpdateProvider appVersion={isNative ? nativeMetadata.appVersion : ""}>
      {rootPage}
      {isNative ? <AppUpdatePrompt /> : null}
    </AppUpdateProvider>
  </StrictMode>,
);
