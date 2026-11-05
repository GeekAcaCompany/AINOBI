// SPDX-License-Identifier: AGPL-3.0-only
{/* Rich Japanese minimal fill_blank — ONE empty <QuizTitle />; CLI injects stem from question.title (must contain ___). */}
<QuizContainer
  padding={0}
  gap={0}
  style={{
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    backgroundColor: "#f7f5f0",
    backgroundImage: "linear-gradient(165deg, #faf8f4 0%, #f0ebe3 48%, #e8e2d8 100%)",
    fontFamily: "'Hiragino Mincho ProN', 'Yu Mincho', 'Noto Serif SC', serif",
    color: "#2a2824",
  }}
>
  <div
    style={{
      display: "flex",
      alignItems: "stretch",
      justifyContent: "space-between",
      padding: "28px 40px 20px",
      borderBottom: "1px solid rgba(42, 40, 36, 0.12)",
    }}
  >
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontSize: 11,
          letterSpacing: 8,
          textTransform: "uppercase",
          color: "#8b4a42",
          fontFamily: "'Hiragino Sans', 'Noto Sans SC', sans-serif",
        }}
      >
        填空
      </span>
      <span style={{ fontSize: 13, color: "#6a6560", letterSpacing: 2 }}>日本の美学</span>
    </div>
    <div
      style={{
        width: 1,
        alignSelf: "stretch",
        backgroundColor: "rgba(139, 74, 66, 0.35)",
        margin: "0 24px",
      }}
    />
    <div style={{ textAlign: "right", fontSize: 12, color: "#9a948c", letterSpacing: 1 }}>
      <div>問</div>
      <div style={{ fontSize: 22, color: "#2a2824", marginTop: 4, fontWeight: 500 }}>01</div>
    </div>
  </div>

  <div
    style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      padding: "32px 56px 24px",
      position: "relative",
    }}
  >
    <div
      style={{
        position: "absolute",
        top: 24,
        left: 40,
        fontSize: 120,
        lineHeight: 1,
        color: "rgba(139, 74, 66, 0.06)",
        fontWeight: 600,
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      寂
    </div>
    <div
      style={{
        padding: "28px 32px",
        backgroundColor: "rgba(255, 255, 255, 0.55)",
        backdropFilter: "blur(8px)",
        boxShadow: "0 12px 40px rgba(42, 40, 36, 0.06)",
        border: "1px solid rgba(255, 255, 255, 0.8)",
      }}
    >
      <QuizTitle
        style={{
          fontSize: 26,
          lineHeight: 2.1,
          fontWeight: 400,
          letterSpacing: 1.5,
          color: "#2a2824",
          margin: 0,
        }}
      />
    </div>
    <p
      style={{
        marginTop: 20,
        fontSize: 13,
        color: "#8a847c",
        letterSpacing: 1,
        textAlign: "center",
        fontFamily: "'Hiragino Sans', sans-serif",
      }}
    >
      不完全さの中に見出す美 — ひと言で答えてください
    </p>
  </div>

  <div
    style={{
      padding: "20px 40px 28px",
      borderTop: "1px solid rgba(42, 40, 36, 0.1)",
      backgroundColor: "rgba(255, 255, 255, 0.35)",
    }}
  >
    <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
      <QuizSubmitButton
        style={{
          padding: "14px 64px",
          borderRadius: 2,
          backgroundColor: "#2a2824",
          color: "#faf8f4",
          border: "none",
          fontSize: 14,
          letterSpacing: 6,
          boxShadow: "0 4px 14px rgba(42, 40, 36, 0.18)",
          fontFamily: "'Hiragino Sans', sans-serif",
        }}
      >
        確認する
      </QuizSubmitButton>
    </div>
    <QuizExplanation>
      <div
        style={{
          padding: "18px 22px",
          backgroundColor: "rgba(243, 240, 234, 0.9)",
          borderLeft: "3px solid #8b4a42",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: 4,
            color: "#8b4a42",
            marginBottom: 8,
            fontFamily: "'Hiragino Sans', sans-serif",
          }}
        >
          解説
        </div>
        <p style={{ fontSize: 15, lineHeight: 1.85, color: "#4a4640", margin: 0 }}>{$explanation}</p>
      </div>
    </QuizExplanation>
    <QuizFeedback>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 14,
          color: "#6a6560",
          fontFamily: "'Hiragino Sans', sans-serif",
        }}
      >
        <span>得点</span>
        <QuizScore />
      </div>
    </QuizFeedback>
    <div
      style={{
        display: "flex",
        gap: 12,
        justifyContent: "flex-end",
        marginTop: 14,
      }}
    >
      <QuizResubmitButton
        style={{
          padding: "9px 28px",
          borderRadius: 2,
          backgroundColor: "transparent",
          color: "#7a756e",
          border: "1px solid #c8c2b8",
          fontSize: 13,
          letterSpacing: 2,
        }}
      >
        もう一度
      </QuizResubmitButton>
      <QuizContinueButton
        style={{
          padding: "9px 28px",
          borderRadius: 2,
          backgroundColor: "transparent",
          color: "#7a756e",
          border: "1px solid #c8c2b8",
          fontSize: 13,
          letterSpacing: 2,
        }}
      >
        次へ
      </QuizContinueButton>
    </div>
  </div>
</QuizContainer>
