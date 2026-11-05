// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Built-in system content templates (not stored per organization).
 * When an organization first edits one, an override row is written to courseware_content_templates (source_meta.builtInKey).
 */

export type BuiltInContentTemplateKey = "strict" | "fun";

export type BuiltInContentTemplateDef = {
  key: BuiltInContentTemplateKey;
  /** Stable UUID: the list / @ references / get all use this id */
  id: string;
  name: string;
  description: string;
  content: string;
};

export const BUILT_IN_CONTENT_TEMPLATE_META_KEY = "builtInKey";

export const BUILT_IN_CONTENT_TEMPLATES: readonly BuiltInContentTemplateDef[] = [
  {
    key: "strict",
    id: "c0a7e111-0001-4000-8000-000000000001",
    name: "Strict Mode",
    description:
      "Auto-activates for medical/legal/finance topics. Must follow user reference files strictly; facts must not be wrong; any web/search content requires explicit user consent before use.",
    content: `# Strict Mode · Content Template

## Language contract (MUST)
- Write ALL generated courseware text (titles, headings, bullet points, quiz questions/answers, and narration/transcript) in the user's requested language (i.e., the chat language or an explicit user language requirement).
- Treat this template as English guidance for structure and constraints. Do NOT output English courseware copy unless the user requested English.
- Keep the meaning, order, and constraints the same; only translate into the target language.

## Auto-activation (MUST)
- **Enter Strict Mode automatically** whenever the courseware topic involves **medical / clinical / pharmaceutical**, **legal / regulatory / compliance**, or **financial / investment / banking / insurance** content (including Chinese: 医疗/医学/药品、法律/合规/监管、金融/投资/证券/保险).
- Activation does **not** require the user to @ this template. If Fun Mode (or another lighter template) was also referenced, **Strict Mode wins** for factual content unless the user explicitly overrides.
- When activated: treat **user-provided reference files** (editor @ library docs, PDFs/DOCX, staged reference materials) as the **sole factual authority**. Read them with \`ainobi doc read\` / \`doc read --file-id\` **before** drafting slide inventory, copy, quizzes, or narration.
- Do not invent dosages, diagnoses, legal conclusions, case outcomes, rates, returns, product terms, or regulatory citations that are not in the references.

## Learning Objectives
- Use knowledge points, definitions, data, and conclusions from the reference materials as the single authority to ensure learners get **accurate, verifiable** understanding.
- All output must be traceable to reference materials. Do not hallucinate, exaggerate, or make unconfirmed inferences.
- If the reference materials have ambiguity or gaps, prefer asking the user for clarification rather than filling in with "reasonable-sounding" content.

## Audience & Difficulty
- Default for high-reliability learning scenarios (professional training, compliance explanations, **medical / legal / financial**, engineering/regulatory topics, etc.).
- Match the difficulty to what the reference materials themselves support. Do not oversimplify beyond the sources, and do not go beyond the materials.

## Page Outline & Pacing
1. **Cover**: lesson topic name + scope statement (which reference materials the course is based on).
2. **Learning objectives / boundaries**: explicitly state what this course covers and what it does not.
3. **Core explanation pages (multiple, if needed)**: expand in the original structure or logical order of the references; one theme per page, avoid mixing topics.
4. **Verification / key recap**: restate key conclusions using the reference's wording (or an equivalent paraphrase).
5. **Quiz checkpoints**: test mastery of the reference facts and key reasoning.
6. **Closing**: summary + reference/source pointers (if any).

Page count and pacing follow the size of the reference materials: prefer more pages with fewer but accurate items, rather than cramming everything into one page.

## Per-Page Content Structure
- **Title**: map to the chapter/theme names in the references; light normalization is OK, but do not change meaning.
- **Key points**: write only what is explicitly given or directly inferable without dispute; each bullet should be easy to trace back to the reference location.
- **Examples / data**: must come from the references; preserve units, conditions, and qualifiers.
- **Closure**: one sentence that restates this page's conclusion; no marketing-style slogans.
- **Default handling**: if the reference materials do not mention the detail -> label it as "Not mentioned in the references" or ask the user; do not fabricate.

## Quizzes & Checkpoints
- Answers must be supported by the reference materials.
- Avoid questions that require external common knowledge to answer. If unavoidable, get user consent first and explicitly mark that it is outside the reference scope.
- Error/feedback should point to the correct reference wording, not introduce an alternative explanation.

## Narration Pacing
- Narration tone must be restrained, clear, and verifiable; fewer rhetorical flourishes, more explicit conditions.
- When reading key definitions, data, and conclusions, keep it consistent with the on-screen key points; avoid "casual speaking" that introduces new facts.
- For uncertain parts: explicitly say "References do not specify / needs confirmation". Do not fill gaps with guesses.

## Prohibitions & Boundaries
- **No fabrication**: facts, data, cases, causal claims, and authoritative citations must not be invented beyond the reference materials.
- **No external sources without consent**: do not use web search, external webpages, or any other unprovided materials as course content evidence without explicit user consent.
- If additional search results are pedagogically necessary: explain the query and its purpose to the user first, **then use only after consent**; cite sources, and if there is a conflict with the references, follow the user's specified priority.
- **No "seems-correct" common sense**: do not default potentially-correct intuition into the courseware; be strict and avoid overreach — especially for medical advice, legal conclusions, and financial recommendations.
- This template constrains **content accuracy and citation discipline**. Do not turn it into flashy visuals or entertainment-focused writing.
`,
  },
  {
    key: "fun",
    id: "c0a7e111-0002-4000-8000-000000000002",
    name: "Fun Mode",
    description:
      "Public-lecture style: emphasize interaction and diagrams, keep text short, maintain a light, participatory pace.",
    content: `# Fun Mode · Content Template

## Language contract (MUST)
- Write ALL generated courseware text (titles, headings, bullet points, quiz questions/answers, and narration/transcript) in the user's requested language (i.e., the chat language or an explicit user language requirement).
- Treat this template as English guidance for structure and constraints. Do NOT output English courseware copy unless the user requested English.
- Keep the meaning, order, and constraints the same; only translate into the target language.

## Learning Objectives
- Use a public-lecture style experience so learners grasp core concepts in a relaxed rhythm, not by reading a "screen paper".
- Prioritize "easy to understand, easy to remember, and ready to take the next step": visualize concepts, add small interactions, provide instant feedback.
- Moderate information density: each page should serve a single memory point; leave details to diagrams, demos, or interactions rather than long paragraphs.

## Audience & Difficulty
- Default for public-lecture / beginner, interest-driven audiences: curious, limited patience.
- Friendly difficulty: start with intuition and analogies, then introduce the necessary terminology; avoid starting with a wall of definitions.

## Page Outline & Pacing
1. **Attention-grabbing cover**: one hook title + "What we will do / what you will understand".
2. **30-second preview**: three small takeaways (short tags are enough).
3. **Concept flashcard page**: one word + one image or one analogy; keep it minimal.
4. **Interactive pages** (interleaved): multiple-choice, drag-and-match, scenario judgment, lightweight mini-experiments, etc.
5. **Diagram explanation pages**: flowcharts / comparison diagrams / step bars; narration tells the story while the slide has fewer words.
6. **Quick recap check-in**: emoji/tag-style recap instead of long lists.
7. **Ending bonus**: one memorable line or "next lesson preview" to encourage continued learning.

Pacing: alternate explanation pages and interactive pages; do not exceed 1–2 consecutive pages of pure text explanation.

## Per-Page Content Structure
- **Title**: conversational, short, visual; may be a question.
- **Primary visual slot**: always reserve space for diagrams / illustrations / characters / step graphics; text serves the visual.
- **Key points**: at most 3 items; one line each; forbid long paragraphs.
- **Interaction slot** (for applicable pages): specify the learner's action (choose, click, drag, answer) and the instant feedback copy.
- **Closure**: one sentence "what you take away" ideally not longer than 20 words.

## Quizzes & Checkpoints
- Prefer lightweight interactions: single-choice, true/false, matching, ordering; keep stems short.
- Feedback can be funny but never mean. If wrong, give a hint and guide learners to try again.
- Check whether learners built intuition, not whether they can recite long definitions.

## Narration Pacing
- Like a public-lecture speaker: use pauses, questions, and "look here" moments.
- Complement the visuals: when the slide shows examples/annotations, narration explains the example; do not read out large chunks of on-screen text.
- Keep per-page narration short; split complex content across pages rather than extending narration.

## Prohibitions & Boundaries
- **Avoid** long text walls, dense bullets, and paper-like formatting.
- **Avoid** multiple consecutive pages of pure explanation without interaction and visuals.
- **Avoid** piling up terminology without analogies or visualization.
- "Fun" is not "lying": core concepts must still be correct. You may simplify wording, but never teach wrong information.
- This template emphasizes a **content structure driven by interaction and diagrams**. Do not accidentally treat it as a specific brand visual guideline (color palettes/fonts/etc. belong to a visual design template).
`,
  },
] as const;

export function getBuiltInContentTemplateById(
  id: string,
): BuiltInContentTemplateDef | null {
  return BUILT_IN_CONTENT_TEMPLATES.find((tpl) => tpl.id === id) ?? null;
}

export function getBuiltInContentTemplateByKey(
  key: string,
): BuiltInContentTemplateDef | null {
  return BUILT_IN_CONTENT_TEMPLATES.find((tpl) => tpl.key === key) ?? null;
}

export function readBuiltInKeyFromSourceMeta(
  sourceMeta: Record<string, unknown> | null | undefined,
): BuiltInContentTemplateKey | null {
  const raw = sourceMeta?.[BUILT_IN_CONTENT_TEMPLATE_META_KEY];
  if (raw === "strict" || raw === "fun") return raw;
  return null;
}

export function isBuiltInContentTemplateId(id: string): boolean {
  return getBuiltInContentTemplateById(id) != null;
}
