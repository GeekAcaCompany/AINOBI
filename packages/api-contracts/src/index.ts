// SPDX-License-Identifier: AGPL-3.0-only
// The platform contract kernel (generated index — do not hand-edit; the
// module list mirrors src/schemas/ and src/enums/ and is asserted by the
// parity test). Schemas and enums are re-exported namespace-per-module so
// consumers import the same names the backend declares.
export * as errors from './core/errors.ts';
export * as envelope from './envelope.ts';
export * as zonedTime from './utils/zoned_time.ts';

export * from './envelope.ts';

// Flat re-exports of the shared agent base symbols that multiple consumers
// (provider implementations, the backend) import by name.
export { MessageRole } from './schemas/base_agent.ts';
export type {
  ChatCompletionMessage,
  CompletionResult,
  StreamOptions,
  ThinkingOptions,
} from './schemas/base_agent.ts';

export * as adminSchema from './schemas/admin.ts';
export * as agentSchema from './schemas/agent.ts';
export * as aiTeacherSchema from './schemas/ai_teacher.ts';
export * as asrSchema from './schemas/asr.ts';
export * as baseAgentSchema from './schemas/base_agent.ts';
export * as chatAgentSchema from './schemas/chat_agent.ts';
export * as communitySchema from './schemas/community.ts';
export * as companionPersonaSchema from './schemas/companion_persona.ts';
export * as courseSchema from './schemas/course.ts';
export * as courseChapterSchema from './schemas/course_chapter.ts';
export * as courseKnowledgeFileSchema from './schemas/course_knowledge_file.ts';
export * as courseSectionSchema from './schemas/course_section.ts';
export * as courseTreeSchema from './schemas/course_tree.ts';
export * as coursewareSchema from './schemas/courseware.ts';
export * as creditsSchema from './schemas/credits.ts';
export * as enterpriseMemberSchema from './schemas/enterprise_member.ts';
export * as fileSchema from './schemas/file.ts';
export * as geminiLiveMessageSchema from './schemas/gemini_live_message.ts';
export * as helpersSchema from './schemas/helpers.ts';
export * as interactionSectionSchema from './schemas/interaction_section.ts';
export * as interactionSessionSchema from './schemas/interaction_session.ts';
export * as learningSchema from './schemas/learning.ts';
export * as liveClassroomSchema from './schemas/live_classroom.ts';
export * as managerSchema from './schemas/manager.ts';
export * as organizationSchema from './schemas/organization.ts';
export * as platformAdminSchema from './schemas/platform_admin.ts';
export * as promptTemplateSchema from './schemas/prompt_template.ts';
export * as servicePriceSchema from './schemas/service_price.ts';
export * as shortlinkSchema from './schemas/shortlink.ts';
export * as stripeSchema from './schemas/stripe.ts';
export * as studentSchema from './schemas/student.ts';
export * as studentHomeConversationSchema from './schemas/student_home_conversation.ts';
export * as teacherSchema from './schemas/teacher.ts';
export * as teachingAgentSchema from './schemas/teaching_agent.ts';
export * as ttsSchema from './schemas/tts.ts';
export * as userSchema from './schemas/user.ts';
export * as userFileSchema from './schemas/user_file.ts';
export * as voucherSchema from './schemas/voucher.ts';
export * as websocketMessageSchema from './schemas/websocket_message.ts';

export * as adminEnum from './enums/admin.ts';
export * as aiTeacherEnum from './enums/ai_teacher.ts';
export * as assetEnum from './enums/asset.ts';
export * as chatSessionEnum from './enums/chat_session.ts';
export * as companionPersonaEnum from './enums/companion_persona.ts';
export * as courseEnum from './enums/course.ts';
export * as courseChapterEnum from './enums/course_chapter.ts';
export * as courseKnowledgeFileEnum from './enums/course_knowledge_file.ts';
export * as courseSectionEnum from './enums/course_section.ts';
export * as creditsEnum from './enums/credits.ts';
export * as examinationEnum from './enums/examination.ts';
export * as homeworkEnum from './enums/homework.ts';
export * as interactionEnum from './enums/interaction.ts';
export * as liveClassroomEnum from './enums/live_classroom.ts';
export * as llmEnum from './enums/llm.ts';
export * as llmExplanationGenerationEnum from './enums/llm_explanation_generation.ts';
export * as managerEnum from './enums/manager.ts';
export * as organizationEnum from './enums/organization.ts';
export * as recurringAllocationEnum from './enums/recurring_allocation.ts';
export * as sectionConditionEnum from './enums/section_condition.ts';
export * as servicePriceEnum from './enums/service_price.ts';
export * as shortlinkEnum from './enums/shortlink.ts';
export * as stripeEnum from './enums/stripe.ts';
export * as studentEnum from './enums/student.ts';
export * as studentCourseEnum from './enums/student_course.ts';
export * as superAdminEnum from './enums/super_admin.ts';
export * as teacherEnum from './enums/teacher.ts';
export * as teacherFeedbackEnum from './enums/teacher_feedback.ts';
export * as ttsEnum from './enums/tts.ts';
export * as uploadSessionEnum from './enums/upload_session.ts';
export * as userEnum from './enums/user.ts';
export * as userFileEnum from './enums/user_file.ts';
export * as voucherEnum from './enums/voucher.ts';

