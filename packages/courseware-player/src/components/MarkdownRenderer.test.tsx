// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ChatMarkdownRenderer } from "./MarkdownRenderer.tsx";

describe("ChatMarkdownRenderer", () => {
  it("renders inline code inside a paragraph without a nested pre", async () => {
    const { container } = render(
      <ChatMarkdownRenderer content="The `size` field uses `width` and `height`." />,
    );

    await waitFor(() => {
      expect(container.querySelector("code")).toBeTruthy();
    });

    const paragraph = container.querySelector("p");
    expect(paragraph).toBeTruthy();
    expect(paragraph?.querySelectorAll("code")).toHaveLength(3);
    expect(paragraph?.querySelector("pre")).toBeNull();
    expect(screen.getByText("size")).toBeInTheDocument();
  });

  it("renders fenced code blocks with pre wrapper", async () => {
    const { container } = render(
      <ChatMarkdownRenderer content={"```ts\nconst x = 1;\n```"} />,
    );

    await waitFor(() => {
      expect(container.querySelector("pre")).toBeTruthy();
    });

    const pre = container.querySelector("pre");
    expect(pre?.querySelector("code")).toBeTruthy();
    expect(pre?.textContent).toContain("const x = 1;");
  });
});
