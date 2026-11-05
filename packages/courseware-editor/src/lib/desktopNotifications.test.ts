// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ainobi/courseware-player/lib/i18n/ui-language-preference", () => ({
  resolveInitialUiLanguage: vi.fn(() => "ja"),
}));

import { resolveInitialUiLanguage } from "@ainobi/courseware-player/lib/i18n/ui-language-preference";
import { translate } from "@ainobi/courseware-player/lib/i18n/index";
import {
  isDesktopNotificationSupported,
  requestDesktopNotificationPermissionIfNeeded,
  showCoursewareEditorAiCompleteNotification,
} from "./desktopNotifications.ts";

function setNotificationPermission(permission: NotificationPermission) {
  Object.defineProperty(Notification, "permission", {
    configurable: true,
    value: permission,
  });
}

describe("desktopNotifications", () => {
  const requestPermission = vi.fn();

  beforeEach(() => {
    requestPermission.mockReset();
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: Object.assign(
        vi.fn().mockImplementation((title: string, options?: NotificationOptions) => ({
          title,
          ...options,
          close: vi.fn(),
        })),
        {
          permission: "default" as NotificationPermission,
          requestPermission,
        },
      ),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects Notification API support", () => {
    expect(isDesktopNotificationSupported()).toBe(true);
  });

  it("requests permission only while still default", async () => {
    requestPermission.mockResolvedValue("granted");
    await expect(requestDesktopNotificationPermissionIfNeeded()).resolves.toBe("granted");
    expect(requestPermission).toHaveBeenCalledOnce();

    setNotificationPermission("granted");
    requestPermission.mockClear();
    await expect(requestDesktopNotificationPermissionIfNeeded()).resolves.toBe("granted");
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("shows completion notification localized to the resolved UI language", () => {
    setNotificationPermission("granted");
    showCoursewareEditorAiCompleteNotification();
    expect(Notification).toHaveBeenCalledWith(
      translate("ja", "coursewareEditor.aiPanel.notificationTitle"),
      expect.objectContaining({
        body: translate("ja", "coursewareEditor.aiPanel.notificationBody"),
        icon: "/AINOBI-Agent.svg",
      }),
    );
    expect(vi.mocked(resolveInitialUiLanguage)).toHaveBeenCalled();
  });

  it("skips notification when permission is not granted", () => {
    setNotificationPermission("denied");
    showCoursewareEditorAiCompleteNotification();
    expect(Notification).not.toHaveBeenCalled();
  });
});
