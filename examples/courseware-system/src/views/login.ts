// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sign-in and sign-up: the platform's own login page, embedded with <ainobi-login>. It has
 * the sign-up, password reset and Google tabs; once signed in it hands back a one-time code
 * (`ainobi-signed-in`) that becomes this app's session.
 */
import { config } from "../config.ts";
import { h, widget } from "../dom.ts";
import { completeSignIn, type AppSession } from "../session.ts";

export function renderLogin(root: HTMLElement, onSignedIn: (session: AppSession) => void): void {
  const status = h("p", { class: "status" });
  const login = widget("ainobi-login", { "base-url": config.webBase, height: "760px" });
  login.addEventListener("ainobi-signed-in", (event) => {
    const { handoff } = (event as CustomEvent<{ handoff: string }>).detail;
    status.textContent = "Signing in…";
    status.className = "status";
    completeSignIn(handoff)
      .then(onSignedIn)
      .catch((error: unknown) => {
        status.textContent = `Sign-in failed: ${error instanceof Error ? error.message : String(error)}`;
        status.className = "status error";
      });
  });
  root.replaceChildren(
    h("main", { class: "login" }, [
      h("header", { class: "login-intro" }, [
        h("h1", { text: "Courseware Studio" }),
        h("p", { text: "An AINOBI example: AI courseware with the editor, the player and the avatar — built only from the public packages." }),
      ]),
      h("section", { class: "login-card" }, [login, status]),
    ]),
  );
}
