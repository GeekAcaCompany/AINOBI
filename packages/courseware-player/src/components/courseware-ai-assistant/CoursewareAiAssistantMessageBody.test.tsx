// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../hooks/useI18nNew.tsx", () => ({
  useI18nNew: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../host/auth.ts", () => ({
  useAuth: () => ({ session: null }),
}));

vi.mock("../../host/config.ts", () => ({
  default: {
    origin: {
      manage: "https://manage.example.com",
    },
    modules: {
      interaction: {
        allowAssistantToolDetailsExpand: false,
      },
    },
  },
}));

import { CoursewareAiAssistantMessageBody } from "./CoursewareAiAssistantMessageBody.tsx";

describe("CoursewareAiAssistantMessageBody", () => {
  it("does not expand tool details when disabled by config", async () => {
    const user = userEvent.setup();
    render(
      <CoursewareAiAssistantMessageBody
        content=""
        isLive={false}
        blocks={[
          {
            type: "tool",
            id: "tool-1",
            toolName: "Read",
            title: "Read app/routes/courseware-preview.tsx",
            command: "app/routes/courseware-preview.tsx",
            output: "file contents",
          },
        ]}
      />,
    );

    expect(screen.getByText("Read app/routes/courseware-preview.tsx")).toBeInTheDocument();
    expect(screen.queryByText("file contents")).not.toBeInTheDocument();

    await user.click(screen.getByText("Read app/routes/courseware-preview.tsx"));

    expect(screen.queryByText("file contents")).not.toBeInTheDocument();
  });
});
