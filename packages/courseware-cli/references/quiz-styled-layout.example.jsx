// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Example `quiz update --jsx-file` for a single-choice question.
 *
 * Before authoring:
 *   ainobi quiz list --pretty
 * Copy each `options[].option_id` from the bound question into `QuizOption value="…"`.
 *
 * Usage:
 *   ainobi quiz update <slide> <quiz_element_id> --jsx-file references/quiz-styled-layout.example.jsx
 */
<QuizContainer padding={32} gap={20} style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", backgroundColor: "rgba(255,255,255,0.97)", borderRadius: 16, boxSizing: "border-box" }}>
  <QuizTitle style={{ fontSize: 32, fontWeight: 600, lineHeight: 1.35 }}>{$title}</QuizTitle>
  <QuizOptionGroup style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
    <QuizOption value="REPLACE_WITH_qz_op_1" style={{ padding: 14, fontSize: 18, borderRadius: 12, border: "2px solid #cbd5e1", backgroundColor: "#fff", width: "100%", textAlign: "left" }}>
      选项 A
    </QuizOption>
    <QuizOption value="REPLACE_WITH_qz_op_2" style={{ padding: 14, fontSize: 18, borderRadius: 12, border: "2px solid #cbd5e1", backgroundColor: "#fff", width: "100%", textAlign: "left" }}>
      选项 B
    </QuizOption>
  </QuizOptionGroup>
  <QuizSubmitButton style={{ marginTop: 12, padding: "12px 28px", fontSize: 18, fontWeight: 600, borderRadius: 10, border: "none", backgroundColor: "#2563eb", color: "#fff" }}>
    提交
  </QuizSubmitButton>
  <QuizExplanation style={{ marginTop: 16, padding: 16, borderRadius: 12, backgroundColor: "#f1f5f9" }}>
    <p style={{ fontSize: 15, lineHeight: 1.5 }}>{$explanation}</p>
  </QuizExplanation>
  <QuizFeedback style={{ marginTop: 12 }}>
    <QuizScore />
  </QuizFeedback>
  <QuizResubmitButton style={{ marginTop: 8 }}>重新作答</QuizResubmitButton>
  <QuizSkipButton style={{ marginTop: 8 }}>跳过</QuizSkipButton>
  <QuizContinueButton style={{ marginTop: 8 }}>继续</QuizContinueButton>
</QuizContainer>
