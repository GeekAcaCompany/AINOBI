// SPDX-License-Identifier: AGPL-3.0-only
/** A hash router: #/login, #/ (home), #/edit/<courseware>, #/play/<courseware>. */

export type Route =
  | { name: "login" }
  | { name: "home" }
  | { name: "edit"; coursewareId: string }
  | { name: "play"; coursewareId: string };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "") || "/";
  const [, section, id] = path.split("/");
  if (section === "login") return { name: "login" };
  if ((section === "edit" || section === "play") && id) {
    return { name: section, coursewareId: decodeURIComponent(id) };
  }
  return { name: "home" };
}

export function routeHash(route: Route): string {
  switch (route.name) {
    case "login":
      return "#/login";
    case "home":
      return "#/";
    default:
      return `#/${route.name}/${encodeURIComponent(route.coursewareId)}`;
  }
}

export function navigate(route: Route): void {
  window.location.hash = routeHash(route);
}
