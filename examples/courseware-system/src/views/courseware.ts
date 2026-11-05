// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The editor and the player: <ainobi-editor> / <ainobi-player> for one courseware, signed in
 * with a one-time code minted from this app's session. The editor reports saves.
 */
import type { AinobiEmbedElement } from "@ainobi/widgets";
import { config } from "../config.ts";
import { h, widget } from "../dom.ts";
import { navigate } from "../router.ts";
import type { AppSession } from "../session.ts";

export function renderCourseware(root: HTMLElement, session: AppSession, mode: "edit" | "play", coursewareId: string): void {
  const status = h("span", { class: "status" });
  const frame = widget(mode === "edit" ? "ainobi-editor" : "ainobi-player", {
    "base-url": config.webBase,
    "courseware-id": coursewareId,
    "org-id": session.orgId,
    height: "100%",
  }) as AinobiEmbedElement;
  frame.classList.add("stage");
  frame.handoffProvider = () => session.client.mintEmbedHandoff({ coursewareId, orgId: session.orgId });
  frame.addEventListener("ainobi-saved", () => {
    status.textContent = `Saved ${new Date().toLocaleTimeString()}`;
  });
  frame.addEventListener("ainobi-error", (event) => {
    status.textContent = `Error: ${(event as CustomEvent<{ message: string }>).detail.message}`;
  });

  root.replaceChildren(
    h("header", { class: "topbar" }, [
      h("button", { class: "secondary", text: "← Coursewares", on: { click: () => navigate({ name: "home" }) } }),
      h("strong", { text: mode === "edit" ? "Editor" : "Player" }),
      h("div", { class: "topbar-right" }, [
        status,
        mode === "edit"
          ? h("button", { class: "secondary", text: "Play", on: { click: () => navigate({ name: "play", coursewareId }) } })
          : h("button", { class: "secondary", text: "Edit", on: { click: () => navigate({ name: "edit", coursewareId }) } }),
      ]),
    ]),
    h("main", { class: "workspace" }, [frame]),
  );
}
