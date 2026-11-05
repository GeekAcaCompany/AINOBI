// SPDX-License-Identifier: AGPL-3.0-only
/** Tiny DOM helper: text is always set as text, never parsed as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { class?: string; text?: string; attrs?: Record<string, string>; on?: Record<string, (event: Event) => void> } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) el.setAttribute(name, value);
  for (const [name, listener] of Object.entries(props.on ?? {})) el.addEventListener(name, listener);
  el.append(...children);
  return el;
}

/** Create an AINOBI custom element (defined by @ainobi/widgets) with attributes. */
export function widget(tag: "ainobi-login" | "ainobi-editor" | "ainobi-player" | "ainobi-avatar", attrs: Record<string, string>): HTMLElement {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  return el;
}
