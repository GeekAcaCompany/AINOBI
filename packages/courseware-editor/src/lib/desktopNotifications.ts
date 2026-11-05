// SPDX-License-Identifier: AGPL-3.0-only
import { translate } from "@ainobi/courseware-player/lib/i18n/index";
import { resolveInitialUiLanguage } from "@ainobi/courseware-player/lib/i18n/ui-language-preference";

const COURSEWARE_EDITOR_AI_COMPLETE_TAG = "courseware-editor-ai-complete";

export function isDesktopNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Request permission only when it hasn't been asked yet; no prompt once granted or denied. */
export async function requestDesktopNotificationPermissionIfNeeded(): Promise<NotificationPermission | null> {
  if (!isDesktopNotificationSupported()) return null;
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function showCoursewareEditorAiCompleteNotification(): void {
  if (!isDesktopNotificationSupported()) return;
  if (Notification.permission !== "granted") return;
  try {
    // Module-scope path (no React context): resolve the UI language directly.
    const language = resolveInitialUiLanguage();
    const notification = new Notification(
      translate(language, "coursewareEditor.aiPanel.notificationTitle"),
      {
        body: translate(language, "coursewareEditor.aiPanel.notificationBody"),
        icon: "/AINOBI-Agent.svg",
        tag: COURSEWARE_EDITOR_AI_COMPLETE_TAG,
      },
    );
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Some environments may still throw with permission granted; just ignore it
  }
}
