// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AINOBI example: a minimal courseware system built only from the public packages —
 * @ainobi/widgets (embedded login, editor, player, avatar) and @ainobi/client (session,
 * organizations, courseware list, sign-in codes for the embedded pages).
 */
import { defineAinobiElements } from "@ainobi/widgets";
import { navigate, parseRoute } from "./router.ts";
import { clearSession, loadSession, type AppSession } from "./session.ts";
import { renderCourseware } from "./views/courseware.ts";
import { renderHome } from "./views/home.ts";
import { renderLogin } from "./views/login.ts";
import "./style.css";

defineAinobiElements();

const root = document.getElementById("app")!;
let session: AppSession | null = loadSession();

function signOut(): void {
  const ending = session;
  session = null;
  clearSession();
  void ending?.client.signOut().catch(() => {});
  navigate({ name: "login" });
  render();
}

function render(): void {
  const route = parseRoute(window.location.hash);
  if (!session) {
    if (route.name !== "login") return navigate({ name: "login" });
    return renderLogin(root, (signedIn) => {
      session = signedIn;
      navigate({ name: "home" });
    });
  }
  switch (route.name) {
    case "login":
      return navigate({ name: "home" });
    case "home":
      return renderHome(root, session, {
        onSignOut: signOut,
        onSessionChange: (next) => {
          session = next;
          render();
        },
      });
    case "edit":
    case "play":
      return renderCourseware(root, session, route.name, route.coursewareId);
  }
}

window.addEventListener("hashchange", render);
render();
