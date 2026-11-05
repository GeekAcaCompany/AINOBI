// SPDX-License-Identifier: AGPL-3.0-only
<QuizContainer
  style={{
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    padding: 48,
    gap: 28,
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#2c2c28",
    backgroundColor: "#ffffff",
    borderRadius: 24,
    boxSizing: "border-box",
  }}
>
  <QuizTitle
    style={{
      margin: 0,
      fontSize: 22,
      fontWeight: 600,
      letterSpacing: 0.2,
      color: "#6b6b65",
    }}
  >
    {$title}
  </QuizTitle>
  <div
    style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      gap: 48,
      marginTop: 8,
    }}
  >
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <QuizShadowingControl
        style={{
          width: 100,
          height: 100,
          minWidth: 100,
          minHeight: 100,
          borderRadius: 50,
          border: "2px solid #ccc5b8",
          background: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          boxSizing: "border-box",
        }}
      >
        <QuizStateView when="idle">
          <img
            src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none'%3E%3Crect x='9' y='3' width='6' height='11' rx='3' fill='%23c9a96e'/%3E%3Cpath d='M6 11a6 6 0 0 0 12 0' stroke='%23c9a96e' stroke-width='1.8' fill='none'/%3E%3Cpath d='M12 17v3M8.5 20h7' stroke='%23c9a96e' stroke-width='1.8'/%3E%3C/svg%3E"
            alt=""
            style={{ width: 36, height: 36, pointerEvents: "none" }}
          />
        </QuizStateView>
        <QuizStateView
          when="recording"
          style={{
            background: "#e53e3e",
            border: "2px solid #c53030",
            color: "#ffffff",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <img
            src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none'%3E%3Crect x='9' y='3' width='6' height='11' rx='3' fill='%23ffffff'/%3E%3Cpath d='M6 11a6 6 0 0 0 12 0' stroke='%23ffffff' stroke-width='1.8' fill='none'/%3E%3Cpath d='M12 17v3M8.5 20h7' stroke='%23ffffff' stroke-width='1.8'/%3E%3C/svg%3E"
            alt=""
            style={{ width: 36, height: 36, pointerEvents: "none" }}
          />
          <QuizRecordingTimer style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.05em" }}>
            {$recording_elapsed}
          </QuizRecordingTimer>
        </QuizStateView>
      </QuizShadowingControl>
      <span style={{ fontSize: 12, fontWeight: 500, color: "#b8a07a", letterSpacing: "0.08em" }}>
        点击录音
      </span>
    </div>
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <QuizSubmitButton
        style={{
          width: 100,
          height: 100,
          minWidth: 100,
          minHeight: 100,
          borderRadius: 50,
          border: "none",
          background: "#c9a96e",
          color: "#ffffff",
          fontSize: 15,
          fontWeight: 600,
          padding: 0,
          boxShadow: "0 4px 20px rgba(201,169,110,0.3)",
        }}
      >
        提交
      </QuizSubmitButton>
      <span style={{ fontSize: 12, fontWeight: 500, color: "#b8a07a", letterSpacing: "0.08em" }}>
        提交评分
      </span>
    </div>
  </div>
  <QuizRecordingPlayback style={{ marginTop: 8, alignSelf: "center" }} />
  <QuizFeedback style={{ marginTop: 8 }}>
    <p style={{ margin: 0, fontSize: 14, color: "#6b6b65" }}>
      得分：<QuizScore />
    </p>
  </QuizFeedback>
</QuizContainer>
