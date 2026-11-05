// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Home: the organization's AI coursewares (via @ainobi/client) with create / edit / play,
 * and the AINOBI avatar docked beside the list (<ainobi-avatar>).
 */
import type { AinobiEmbedElement } from "@ainobi/widgets";
import type { CoursewareSummary, OrganizationInfo } from "@ainobi/client";
import { config } from "../config.ts";
import { h, widget } from "../dom.ts";
import { navigate } from "../router.ts";
import { isAuthFailure, switchOrganization, type AppSession } from "../session.ts";

export type HomeActions = { onSignOut: () => void; onSessionChange: (session: AppSession) => void };

const formatDate = (iso: string) => new Date(iso).toLocaleString();

export function renderHome(root: HTMLElement, session: AppSession, actions: HomeActions): void {
  const list = h("div", { class: "grid" });
  const status = h("p", { class: "status" });
  const orgSelect = h("select", { attrs: { "aria-label": "Organization" } });

  const card = (item: CoursewareSummary) =>
    h("article", { class: "card" }, [
      h("div", { class: "cover" }, [
        item.coverUrl ? h("img", { attrs: { src: item.coverUrl, alt: "" } }) : h("span", { text: (item.title ?? "?").slice(0, 1) }),
      ]),
      h("h3", { text: item.title?.trim() || "Untitled courseware" }),
      h("p", { class: "meta", text: `${item.sceneCount ?? 0} pages · edited ${formatDate(item.updatedAt)}` }),
      h("div", { class: "actions" }, [
        h("button", { text: "Edit", on: { click: () => navigate({ name: "edit", coursewareId: item.key }) } }),
        h("button", { class: "secondary", text: "Play", on: { click: () => navigate({ name: "play", coursewareId: item.key }) } }),
      ]),
    ]);

  const load = async () => {
    status.textContent = "Loading coursewares…";
    try {
      const page = await session.client.listCoursewares({ orgId: session.orgId, pageSize: 24 });
      list.replaceChildren(...page.items.map(card));
      status.textContent = page.totalCount === 0 ? "No coursewares yet — create the first one." : `${page.totalCount} coursewares`;
    } catch (error) {
      if (isAuthFailure(error)) return actions.onSignOut();
      status.textContent = `Could not load coursewares: ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  const fillOrganizations = (organizations: OrganizationInfo[]) => {
    orgSelect.replaceChildren(
      ...organizations.map((org) => h("option", { text: org.org_name, attrs: { value: org.org_id } })),
    );
    orgSelect.value = session.orgId;
  };
  orgSelect.addEventListener("change", () => {
    void switchOrganization(session, orgSelect.value).then((next) => {
      actions.onSessionChange(next);
    });
  });

  // The avatar signs in with a one-time code minted from this session.
  const avatar = widget("ainobi-avatar", { "base-url": config.webBase, height: "560px" }) as AinobiEmbedElement;
  avatar.handoffProvider = () => session.client.mintEmbedHandoff({ orgId: session.orgId });

  root.replaceChildren(
    h("header", { class: "topbar" }, [
      h("strong", { text: "Courseware Studio" }),
      h("div", { class: "topbar-right" }, [
        orgSelect,
        h("span", { class: "user", text: session.userName }),
        h("button", { class: "secondary", text: "Sign out", on: { click: actions.onSignOut } }),
      ]),
    ]),
    h("main", { class: "home" }, [
      h("section", { class: "library" }, [
        h("div", { class: "library-head" }, [
          h("h2", { text: "AI coursewares" }),
          // A new courseware is created by the editor itself the first time it opens a new key.
          h("button", { text: "+ New courseware", on: { click: () => navigate({ name: "edit", coursewareId: crypto.randomUUID() }) } }),
        ]),
        status,
        list,
      ]),
      h("aside", { class: "avatar" }, [h("h2", { text: "Your AI teacher" }), avatar]),
    ]),
  );

  void session.client.listOrganizations().then(fillOrganizations, () => fillOrganizations([]));
  void load();
}
