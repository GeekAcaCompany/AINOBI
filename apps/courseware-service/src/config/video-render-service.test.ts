// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  coursewareRenderCallbackUrl,
  isValidVideoRenderCallbackToken,
  resolveCoursewareAgentBaseUrl,
  resolveStudentViewBaseUrl,
  resolveVideoRenderInternalToken,
  resolveVideoRenderServiceBaseUrl,
  resolveVideoRenderServiceLegacyBaseUrl,
  resolveVideoRenderServiceQueryBaseUrl,
  resolveVideoRenderServiceRenderBaseUrl,
  videoRenderServiceUrl,
} from "./video-render-service.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("resolveVideoRenderServiceLegacyBaseUrl trims trailing slashes", () => {
  withEnv({ AINOBI_VIDEO_RENDER_SERVICE_URL: "http://localhost:5633/" }, () => {
    assert.equal(resolveVideoRenderServiceLegacyBaseUrl(), "http://localhost:5633");
  });
});

test("resolveVideoRenderServiceRenderBaseUrl prefers render-specific env", () => {
  withEnv(
    {
      AINOBI_VIDEO_RENDER_SERVICE_RENDER_URL: "https://render.example.com/",
      AINOBI_VIDEO_RENDER_SERVICE_QUERY_URL: "https://query.example.com/",
      AINOBI_VIDEO_RENDER_SERVICE_URL: "https://legacy.example.com/",
    },
    () => {
      assert.equal(resolveVideoRenderServiceRenderBaseUrl(), "https://render.example.com");
    },
  );
});

test("resolveVideoRenderServiceQueryBaseUrl prefers query-specific env", () => {
  withEnv(
    {
      AINOBI_VIDEO_RENDER_SERVICE_RENDER_URL: "https://render.example.com/",
      AINOBI_VIDEO_RENDER_SERVICE_QUERY_URL: "https://query.example.com/",
      AINOBI_VIDEO_RENDER_SERVICE_URL: "https://legacy.example.com/",
    },
    () => {
      assert.equal(resolveVideoRenderServiceQueryBaseUrl(), "https://query.example.com");
    },
  );
});

test("render/query base URLs fall back to legacy single URL", () => {
  withEnv(
    {
      AINOBI_VIDEO_RENDER_SERVICE_RENDER_URL: undefined,
      AINOBI_VIDEO_RENDER_SERVICE_QUERY_URL: undefined,
      AINOBI_VIDEO_RENDER_SERVICE_URL: "http://localhost:5633",
    },
    () => {
      assert.equal(resolveVideoRenderServiceRenderBaseUrl(), "http://localhost:5633");
      assert.equal(resolveVideoRenderServiceQueryBaseUrl(), "http://localhost:5633");
    },
  );
});

test("resolveVideoRenderServiceBaseUrl throws when unset", () => {
  withEnv(
    {
      AINOBI_VIDEO_RENDER_SERVICE_RENDER_URL: undefined,
      AINOBI_VIDEO_RENDER_SERVICE_QUERY_URL: undefined,
      AINOBI_VIDEO_RENDER_SERVICE_URL: undefined,
    },
    () => {
      assert.throws(() => resolveVideoRenderServiceBaseUrl());
    },
  );
});

test("videoRenderServiceUrl joins base and path per target", () => {
  withEnv(
    {
      AINOBI_VIDEO_RENDER_SERVICE_RENDER_URL: "https://render.example.com",
      AINOBI_VIDEO_RENDER_SERVICE_QUERY_URL: "https://query.example.com",
    },
    () => {
      assert.equal(
        videoRenderServiceUrl("/render/tasks", "render"),
        "https://render.example.com/render/tasks",
      );
      assert.equal(
        videoRenderServiceUrl("render/tasks", "query"),
        "https://query.example.com/render/tasks",
      );
    },
  );
});

test("resolveStudentViewBaseUrl trims trailing slashes", () => {
  withEnv({ AINOBI_STUDENT_VIEW_BASE_URL: "http://localhost:5173/" }, () => {
    assert.equal(resolveStudentViewBaseUrl(), "http://localhost:5173");
  });
});

test("resolveStudentViewBaseUrl throws when unset", () => {
  withEnv({ AINOBI_STUDENT_VIEW_BASE_URL: undefined }, () => {
    assert.throws(() => resolveStudentViewBaseUrl());
  });
});

test("resolveVideoRenderInternalToken returns the configured shared secret", () => {
  withEnv({ AINOBI_VIDEO_RENDER_INTERNAL_TOKEN: "shared-secret" }, () => {
    assert.equal(resolveVideoRenderInternalToken(), "shared-secret");
  });
});

test("resolveVideoRenderInternalToken throws when unset, failing closed rather than calling unauthenticated", () => {
  withEnv({ AINOBI_VIDEO_RENDER_INTERNAL_TOKEN: undefined }, () => {
    assert.throws(() => resolveVideoRenderInternalToken());
  });
});

test("resolveCoursewareAgentBaseUrl trims trailing slashes", () => {
  withEnv({ AINOBI_COURSEWARE_AGENT_BASE_URL: "http://localhost:5000/" }, () => {
    assert.equal(resolveCoursewareAgentBaseUrl(), "http://localhost:5000");
  });
});

test("resolveCoursewareAgentBaseUrl throws when unset", () => {
  withEnv({ AINOBI_COURSEWARE_AGENT_BASE_URL: undefined }, () => {
    assert.throws(() => resolveCoursewareAgentBaseUrl());
  });
});

test("coursewareRenderCallbackUrl appends the callback path", () => {
  withEnv({ AINOBI_COURSEWARE_AGENT_BASE_URL: "http://localhost:5000" }, () => {
    assert.equal(coursewareRenderCallbackUrl(), "http://localhost:5000/courseware/render/callback");
  });
});

test("isValidVideoRenderCallbackToken accepts a matching token", () => {
  withEnv({ AINOBI_VIDEO_RENDER_INTERNAL_TOKEN: "shared-secret" }, () => {
    assert.equal(isValidVideoRenderCallbackToken("shared-secret"), true);
  });
});

test("isValidVideoRenderCallbackToken rejects a mismatched, missing, or null token", () => {
  withEnv({ AINOBI_VIDEO_RENDER_INTERNAL_TOKEN: "shared-secret" }, () => {
    assert.equal(isValidVideoRenderCallbackToken("wrong"), false);
    assert.equal(isValidVideoRenderCallbackToken(undefined), false);
    assert.equal(isValidVideoRenderCallbackToken(null), false);
    assert.equal(isValidVideoRenderCallbackToken(""), false);
  });
});

test("isValidVideoRenderCallbackToken always fails closed when the server has no token configured", () => {
  withEnv({ AINOBI_VIDEO_RENDER_INTERNAL_TOKEN: undefined }, () => {
    assert.equal(isValidVideoRenderCallbackToken("anything"), false);
  });
});
