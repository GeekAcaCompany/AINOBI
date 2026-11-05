// SPDX-License-Identifier: AGPL-3.0-only
<QuizContainer
  padding={48}
  gap={24}
  style={{
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    backgroundColor: "#faf9f6",
    color: "#2c2c2a",
    fontFamily: "'Hiragino Sans', 'Noto Sans SC', system-ui, sans-serif",
  }}
>
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      paddingBottom: 12,
      borderBottom: "1px solid #e0ddd6",
    }}
  >
    <span style={{ width: 3, height: 18, backgroundColor: "#8b4a42", display: "inline-block" }} />
    <span style={{ fontSize: 12, letterSpacing: 6, color: "#8b4a42", fontWeight: 500 }}>填空</span>
  </div>
  <div
    style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      padding: "24px 8px",
    }}
  >
    <QuizTitle
      style={{
        fontSize: 28,
        lineHeight: 2.2,
        fontWeight: 400,
        letterSpacing: 2,
        color: "#2c2c2a",
      }}
    />
  </div>
  <div
    style={{
      display: "flex",
      justifyContent: "center",
      paddingTop: 16,
      borderTop: "1px solid #eceae4",
    }}
  >
    <QuizSubmitButton
      style={{
        padding: "12px 56px",
        borderRadius: 0,
        backgroundColor: "#2c2c2a",
        color: "#faf9f6",
        border: "none",
        fontSize: 14,
        letterSpacing: 4,
      }}
    >
      確認
    </QuizSubmitButton>
  </div>
  <QuizExplanation>
    <p
      style={{
        marginTop: 20,
        padding: "16px 20px",
        fontSize: 15,
        lineHeight: 1.85,
        color: "#5a5854",
        backgroundColor: "#f3f1ec",
        borderLeft: "3px solid #b8b4aa",
      }}
    >
      {$explanation}
    </p>
  </QuizExplanation>
  <QuizFeedback>
    <div style={{ marginTop: 8, fontSize: 14, color: "#6a6760" }}>
      <QuizScore />
    </div>
  </QuizFeedback>
  <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 12 }}>
    <QuizResubmitButton
      style={{
        padding: "8px 28px",
        borderRadius: 0,
        backgroundColor: "transparent",
        color: "#8a8680",
        border: "1px solid #d8d4cc",
        fontSize: 13,
        letterSpacing: 2,
      }}
    >
      再答
    </QuizResubmitButton>
    <QuizContinueButton
      style={{
        padding: "8px 28px",
        borderRadius: 0,
        backgroundColor: "transparent",
        color: "#8a8680",
        border: "1px solid #d8d4cc",
        fontSize: 13,
        letterSpacing: 2,
      }}
    >
      続く
    </QuizContinueButton>
  </div>
</QuizContainer>
