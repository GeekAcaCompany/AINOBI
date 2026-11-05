// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Error code scheme.
 *
 * Error code rules:
 * - First three digits: the HTTP status code
 * - Last three digits: the specific business error
 *
 * For example:
 * - 401001: Unauthorized - Invalid token
 * - 404001: Not found - User not found
 *
 * Note: the production error table allows duplicate values (the later definition wins). 403012 is used by both
 * AGENT_ONLY_ENDPOINT and CHILD_ORGANIZATION_BILLING_FORBIDDEN —
 * both constants stay exported with the same value (403012); the meaning depends on where it is used.
 */

export const ErrorCode = {
  // General error (400-499 range)
  BAD_REQUEST: 400000,
  INVALID_CAPTCHA: 400001,
  INVALID_REQUEST: 400002,
  FILE_NOT_ASSOCIATED_WITH_SECTION: 400003,
  INVALID_FILE_PAGE_NUMBER: 400004,
  AGENT_OWNER_MUST_BE_HUMAN: 400005,

  // Authentication related (403xxx range)
  UNAUTHORIZED: 403000,
  INVALID_TOKEN: 403001,
  TOKEN_EXPIRED: 403002,
  FORBIDDEN: 403003,
  PERMISSION_DENIED: 403004,
  ORGANIZATION_PERMISSION_DENIED: 403005,
  SECTION_LOCKED: 403006,
  SECTION_EXPIRED: 403007,
  INVALID_SECTION_CONDITION: 403008,
  AGENT_PASSWORD_LOGIN_FORBIDDEN: 403009,
  AGENT_GOOGLE_LOGIN_FORBIDDEN: 403010,
  HUMAN_ONLY_ENDPOINT: 403011,
  AGENT_ONLY_ENDPOINT: 403012,
  // Child organizations are funded only by parent allocations: they may not subscribe or top up (billing changes are refused at the source).
  CHILD_ORGANIZATION_BILLING_FORBIDDEN: 403012,
  // Asset ledger export refused. Deliberately distinct from ORGANIZATION_PERMISSION_DENIED:
  // console treats 403005 as a dead session and jumps to /login, which is the wrong UX for a healthy
  // session that merely may not export this organization's ledger, hence a code of its own.
  ORGANIZATION_ASSET_LEDGER_EXPORT_DENIED: 403013,
  // Enterprise account provisioned but not activated. Raised after the password checks out; the right UX is "check your email", not "wrong password".
  ACCOUNT_NOT_ACTIVATED: 403014,

  // Account related errors (401xxx range)
  AUTHENTICATION_REQUIRED: 401000,
  ACCOUNT_NOT_FOUND: 401001,
  INVALID_CREDENTIALS: 401002,
  INCORRECT_PASSWORD: 401003,
  ACCOUNT_INACTIVE: 401004,
  AGENT_CREDENTIAL_INVALID: 401005,
  AGENT_CREDENTIAL_EXPIRED: 401006,

  // Resource error (404xxx range)
  NOT_FOUND: 404000,
  USER_NOT_FOUND: 404001,
  COURSE_NOT_FOUND: 404002,
  QUESTION_NOT_FOUND: 404003,
  EXAMINATION_NOT_FOUND: 404004,
  ORGANIZATION_NOT_FOUND: 404005,
  COURSE_SECTION_NOT_FOUND: 404006,
  COURSE_CHAPTER_NOT_FOUND: 404007,
  STUDENT_SUBMISSION_NOT_FOUND: 404008,
  ATTENDANCE_NOT_FOUND: 404009,
  TEACHER_NOT_IN_COURSE: 404010,
  STUDENT_NOT_IN_COURSE: 404011,
  STUDENT_NOT_IN_ORGANIZATION: 404012,
  SUPER_ADMIN_NOT_FOUND: 404013,
  ADMIN_NOT_FOUND: 404014,
  MANAGER_NOT_FOUND: 404015,
  SHORTLINK_NOT_FOUND: 404016,
  SHORTLINK_INACTIVE: 404017,
  SHORTLINK_EXPIRED: 404018,
  TEACHER_NOT_FOUND: 404019,
  STUDENT_NOT_FOUND: 404020,
  AI_TEACHER_NOT_FOUND: 404021,
  TTS_NOT_FOUND: 404022,
  COURSE_KNOWLEDGE_NOT_FOUND: 404023,
  COURSE_KNOWLEDGE_FILE_NOT_FOUND: 404024,
  ASSET_NOT_FOUND: 404025,
  ASSET_LEDGER_NOT_FOUND: 404026,
  LIVE_CLASSROOM_NOT_FOUND: 404027,
  LIVE_CLASSROOM_RECORDING_NOT_FOUND: 404028,
  VOUCHER_NOT_FOUND: 404030,
  SERVICE_PRICE_NOT_FOUND: 404031,
  ACTIVATION_TOKEN_INVALID: 404036,
  SERVICE_PRICE_RATIO_NOT_FOUND: 404032,
  AGENT_NOT_FOUND: 404033,
  USER_FILE_NOT_FOUND: 404034,
  TTS_PRONUNCIATION_NOT_FOUND: 404035,

  // Method not allowed error (405xxx range)
  METHOD_NOT_ALLOWED: 405000,

  // Conflict error (409xxx range)
  DUPLICATE_RESOURCE: 409000,
  ACCOUNT_ALREADY_EXISTS: 409001,
  INVALID_USER_STATUS: 409002,
  MANAGER_ALREADY_EXISTS: 409003,
  ADMIN_ALREADY_EXISTS: 409004,
  SUPER_ADMIN_ALREADY_EXISTS: 409005,
  STUDENT_ALREADY_EXISTS: 409006,
  TEACHER_ALREADY_EXISTS: 409007,
  TEACHER_ALREADY_IN_COURSE: 409008,
  STUDENT_ALREADY_IN_COURSE: 409009,
  STUDENT_NOT_ENROLLED: 409010,
  ORGANIZATION_ALREADY_EXISTS: 409011,
  USER_ALREADY_HAS_ROLE: 409012,
  AI_TEACHER_ALREADY_EXISTS: 409013,
  TTS_ALREADY_EXISTS: 409014,
  COURSE_ALREADY_EXISTS: 409015,
  COURSE_CHAPTER_ALREADY_EXISTS: 409016,
  COURSE_SECTION_ALREADY_EXISTS: 409017,
  EXAMINATION_ALREADY_EXISTS: 409018,
  QUESTION_ALREADY_EXISTS: 409019,
  TTS_FORMAT_NOT_SUPPORTED: 409020,
  ASSET_ALREADY_EXISTS: 409021,
  ASR_FORMAT_NOT_SUPPORTED: 409022,
  ORGANIZATION_INVALID_OPERATION: 409023,
  COURSE_KNOWLEDGE_FILE_NAME_CONFLICT: 409024,
  VOUCHER_CODE_EXISTS: 409025,
  VOUCHER_ALREADY_EXHAUSTED: 409026,
  VOUCHER_ALREADY_REDEEMED: 409027,
  STUDENT_INTERACTION_ANSWER_ALREADY_EXISTS: 409028,
  // The organization already has an active subscription
  SUBSCRIPTION_ALREADY_ACTIVE: 409029,
  // A personal organization cannot invite members
  PERSONAL_ORGANIZATION_INVITE_NOT_SUPPORTED: 409030,
  // Restore blocked: an active organization with the same name exists
  ORGANIZATION_RESTORE_NAME_CONFLICT: 409031,
  // A platform pronunciation entry for (source_text, language) already exists
  TTS_PRONUNCIATION_ALREADY_EXISTS: 409032,
  // Activation link already used (account already activated)
  ACTIVATION_TOKEN_USED: 409033,
  // Resend refused: the account is not pending activation
  ACTIVATION_NOT_PENDING: 409034,

  // Operation errors (422xxx range)
  VALIDATION_ERROR: 422001,
  OPERATION_FAILED: 422002,
  CREATE_ORGANIZATION_FAILED: 422003,
  ADD_TEACHER_TO_COURSE_FAILED: 422004,
  ADD_STUDENT_TO_COURSE_FAILED: 422005,
  PERMISSION_INSUFFICIENT: 422006,
  NOT_IMPLEMENTED: 422007,
  SESSION_UPDATE_FAILED: 422008,
  INVITE_USER_FAILED: 422009,
  INVALID_ROLE: 422010,
  CREATE_TTS_FAILED: 422011,
  UPDATE_TTS_FAILED: 422012,
  REMOVE_TTS_FAILED: 422013,
  TTS_SERVICE_ERROR: 422014,
  FILE_UPLOAD_FAILED: 422015,
  ASSET_INSUFFICIENT_BALANCE: 422016,
  USER_PERMISSION_DENIED: 422017,
  ASR_FILE_TOO_LARGE: 422018,
  ASR_EMPTY_FILE: 422019,
  ASR_TRANSCRIPTION_FAILED: 422020,
  ASR_SERVICE_ERROR: 422021,
  LIVE_CLASSROOM_TIME_INVALID: 422022,
  VOUCHER_EXPIRED: 422023,
  VOUCHER_DISABLED: 422024,
  VOUCHER_USAGE_LIMIT_EXCEEDED: 422025,
  INTERACTION_ANSWER_TIMEOUT: 422026,
  COMPONENT_BLOCKED: 422027,
  COURSE_LIMIT_EXCEEDED: 422029,
  STORAGE_QUOTA_EXCEEDED: 422030,
  MANUAL_STUDENT_MGMT_NOT_ALLOWED: 422031,
  PRIVATE_COURSE_NOT_ALLOWED: 422032,
  TOTAL_SEAT_LIMIT_EXCEEDED: 422033,
  ADMIN_SEAT_LIMIT_EXCEEDED: 422034,
  TEACHER_SEAT_LIMIT_EXCEEDED_NEW: 422035,
  SEAT_LIMIT_BELOW_USAGE: 422036,
  ORGANIZATION_TREE_DEPTH_LIMIT_EXCEEDED: 422037,
  ORGANIZATION_DIRECT_CHILDREN_LIMIT_EXCEEDED: 422038,
  ORGANIZATION_TREE_NODE_LIMIT_EXCEEDED: 422039,

  // Gone error (410xxx range)
  ACTIVATION_TOKEN_EXPIRED: 410000,

  // Locked error (423xxx range)
  // Refused after too many failed password logins; the response carries data.retry_after_seconds.
  ACCOUNT_LOCKED: 423001,

  // Too many requests (429xxx range)
  TOO_MANY_REQUESTS: 429000,
  // Per-IP rate limit on self-service sign-up (email registration + first Google login); the response carries data.retry_after_seconds.
  REGISTRATION_RATE_LIMITED: 429001,

  // Database error (500xxx range)
  DATABASE_ERROR: 500100,
  RECORD_NOT_FOUND: 500101,
  ORGANIZATION_PATH_UNRESOLVABLE: 500102,

  // System error (500xxx range)
  SYSTEM_ERROR: 500000,
  INTERNAL_SERVER_ERROR: 500001,
  ATTRIBUTE_ERROR: 500002,
  VALUE_ERROR: 500003,
  TYPE_ERROR: 500004,
  KEY_ERROR: 500005,
  INDEX_ERROR: 500006,
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Error code -> default error message */
export const ErrorMessages: Readonly<Record<number, string>> = {
  // General error
  [ErrorCode.BAD_REQUEST]: "Request parameter error",
  [ErrorCode.INTERNAL_SERVER_ERROR]: "Internal server error",
  [ErrorCode.INVALID_CAPTCHA]: "Invalid captcha code",
  [ErrorCode.INVALID_REQUEST]: "Invalid request",
  [ErrorCode.FILE_NOT_ASSOCIATED_WITH_SECTION]: "File is not associated with this section",
  [ErrorCode.INVALID_FILE_PAGE_NUMBER]: "Invalid page number for file type",
  [ErrorCode.AGENT_OWNER_MUST_BE_HUMAN]: "Agent owner must be a human (normal) user",
  // Authentication related
  [ErrorCode.UNAUTHORIZED]: "Unauthorized access",
  [ErrorCode.INVALID_TOKEN]: "Invalid or expired access token",
  [ErrorCode.TOKEN_EXPIRED]: "Access token expired",
  [ErrorCode.FORBIDDEN]: "Forbidden",
  [ErrorCode.PERMISSION_DENIED]: "Permission denied",
  [ErrorCode.SECTION_LOCKED]: "Section is locked",
  [ErrorCode.SECTION_EXPIRED]: "Section has expired",
  [ErrorCode.INVALID_SECTION_CONDITION]: "Invalid section condition configuration",
  [ErrorCode.AGENT_PASSWORD_LOGIN_FORBIDDEN]: "Agent accounts cannot use password login",
  [ErrorCode.AGENT_GOOGLE_LOGIN_FORBIDDEN]: "Agent accounts cannot use Google login",
  [ErrorCode.HUMAN_ONLY_ENDPOINT]: "This endpoint is restricted to human users",
  // Note: CHILD_ORGANIZATION_BILLING_FORBIDDEN and AGENT_ONLY_ENDPOINT share the value 403012.
  // The later entry in the map wins — the effective 403012 message is the one below (AGENT_ONLY_ENDPOINT's
  // entry is overridden, so the same key is not declared twice here).
  [ErrorCode.CHILD_ORGANIZATION_BILLING_FORBIDDEN]:
    "Child organizations cannot manage billing directly. Please contact the parent organization's administrator to top up and allocate credits.",
  // Account related errors
  [ErrorCode.AUTHENTICATION_REQUIRED]: "Authentication required",
  [ErrorCode.ACCOUNT_NOT_FOUND]: "Account not found",
  [ErrorCode.INVALID_CREDENTIALS]: "Invalid credentials",
  [ErrorCode.INCORRECT_PASSWORD]: "Incorrect password",
  [ErrorCode.ACCOUNT_INACTIVE]: "Account status abnormal",
  [ErrorCode.AGENT_CREDENTIAL_INVALID]: "Invalid agent credential",
  [ErrorCode.AGENT_CREDENTIAL_EXPIRED]: "Agent credential expired",
  // Resource error
  [ErrorCode.NOT_FOUND]: "Resource not found",
  [ErrorCode.USER_NOT_FOUND]: "User not found",
  [ErrorCode.COURSE_NOT_FOUND]: "Course not found",
  [ErrorCode.QUESTION_NOT_FOUND]: "Question not found",
  [ErrorCode.EXAMINATION_NOT_FOUND]: "Examination not found",
  [ErrorCode.ORGANIZATION_NOT_FOUND]: "Organization not found",
  [ErrorCode.COURSE_SECTION_NOT_FOUND]: "Course section not found",
  [ErrorCode.COURSE_CHAPTER_NOT_FOUND]: "Course chapter not found",
  [ErrorCode.STUDENT_SUBMISSION_NOT_FOUND]: "Submission not found",
  [ErrorCode.ATTENDANCE_NOT_FOUND]: "Attendance not found",
  [ErrorCode.TEACHER_NOT_IN_COURSE]: "Teacher not found in course",
  [ErrorCode.STUDENT_NOT_IN_COURSE]: "Student not found in course",
  [ErrorCode.STUDENT_NOT_IN_ORGANIZATION]: "Current user is not a student in this organization",
  [ErrorCode.SUPER_ADMIN_NOT_FOUND]: "Super admin not found",
  [ErrorCode.ADMIN_NOT_FOUND]: "Admin not found",
  [ErrorCode.MANAGER_NOT_FOUND]: "Assistant not found",
  [ErrorCode.SHORTLINK_NOT_FOUND]: "Short link not found",
  [ErrorCode.SHORTLINK_INACTIVE]: "Short link is inactive",
  [ErrorCode.SHORTLINK_EXPIRED]: "Short link has expired",
  [ErrorCode.TEACHER_NOT_FOUND]: "Teacher not found",
  [ErrorCode.STUDENT_NOT_FOUND]: "Student not found",
  [ErrorCode.AI_TEACHER_NOT_FOUND]: "AI teacher not found",
  [ErrorCode.TTS_NOT_FOUND]: "TTS configuration not found",
  [ErrorCode.COURSE_KNOWLEDGE_NOT_FOUND]: "Course knowledge not found",
  [ErrorCode.COURSE_KNOWLEDGE_FILE_NOT_FOUND]: "Course knowledge file not found",
  [ErrorCode.ASSET_NOT_FOUND]: "Asset not found",
  [ErrorCode.ASSET_LEDGER_NOT_FOUND]: "Asset ledger not found",
  [ErrorCode.LIVE_CLASSROOM_RECORDING_NOT_FOUND]: "Live classroom recording not found",
  [ErrorCode.LIVE_CLASSROOM_NOT_FOUND]: "Live classroom not found",
  [ErrorCode.VOUCHER_NOT_FOUND]: "Voucher not found",
  [ErrorCode.AGENT_NOT_FOUND]: "Agent not found",
  [ErrorCode.SERVICE_PRICE_NOT_FOUND]: "Service price configuration not found",
  [ErrorCode.SERVICE_PRICE_RATIO_NOT_FOUND]: "Service price ratio not found",
  // Conflict error
  [ErrorCode.DUPLICATE_RESOURCE]: "Resource already exists",
  [ErrorCode.ACCOUNT_ALREADY_EXISTS]: "Account with this name already exists",
  [ErrorCode.INVALID_USER_STATUS]: "User status is invalid for this operation",
  [ErrorCode.MANAGER_ALREADY_EXISTS]: "Assistant with this user and organization already exists",
  [ErrorCode.ADMIN_ALREADY_EXISTS]: "Admin with this user and organization already exists",
  [ErrorCode.SUPER_ADMIN_ALREADY_EXISTS]: "Super admin with this user and organization already exists",
  [ErrorCode.STUDENT_ALREADY_EXISTS]: "Student with this user and organization already exists",
  [ErrorCode.TEACHER_ALREADY_EXISTS]: "Teacher with this user and organization already exists",
  [ErrorCode.TEACHER_ALREADY_IN_COURSE]: "Teacher may already be in the course",
  [ErrorCode.STUDENT_ALREADY_IN_COURSE]: "Student may already be in the course",
  [ErrorCode.STUDENT_NOT_ENROLLED]: "Student is not enrolled in this course",
  [ErrorCode.ORGANIZATION_ALREADY_EXISTS]: "Organization with this name already exists",
  [ErrorCode.USER_ALREADY_HAS_ROLE]: "User already has this role in the organization",
  [ErrorCode.AI_TEACHER_ALREADY_EXISTS]: "AI teacher with this name already exists in this organization",
  [ErrorCode.TTS_ALREADY_EXISTS]: "TTS configuration with this name already exists in this organization",
  [ErrorCode.COURSE_ALREADY_EXISTS]: "Course with this name already exists in this organization",
  [ErrorCode.COURSE_CHAPTER_ALREADY_EXISTS]: "Chapter with this name already exists in this course",
  [ErrorCode.COURSE_SECTION_ALREADY_EXISTS]: "Section with this name already exists in this chapter",
  [ErrorCode.EXAMINATION_ALREADY_EXISTS]: "Examination with this name already exists",
  [ErrorCode.QUESTION_ALREADY_EXISTS]: "Question already exists",
  [ErrorCode.TTS_FORMAT_NOT_SUPPORTED]: "TTS format not supported",
  [ErrorCode.ASSET_ALREADY_EXISTS]: "Asset already exists",
  [ErrorCode.ASR_FORMAT_NOT_SUPPORTED]: "ASR audio format not supported",
  [ErrorCode.ORGANIZATION_INVALID_OPERATION]: "Invalid organization operation",
  [ErrorCode.VOUCHER_CODE_EXISTS]: "Voucher code already exists",
  [ErrorCode.VOUCHER_ALREADY_EXHAUSTED]: "Voucher already exhausted",
  [ErrorCode.VOUCHER_ALREADY_REDEEMED]: "Voucher already redeemed by this user",
  [ErrorCode.STUDENT_INTERACTION_ANSWER_ALREADY_EXISTS]: "Answer already submitted",
  [ErrorCode.SUBSCRIPTION_ALREADY_ACTIVE]: "Organization already has an active subscription",
  [ErrorCode.PERSONAL_ORGANIZATION_INVITE_NOT_SUPPORTED]: "Personal organization cannot invite members",
  [ErrorCode.ORGANIZATION_RESTORE_NAME_CONFLICT]:
    "Cannot restore organization: an active organization with the same name exists",
  // Operation errors
  [ErrorCode.VALIDATION_ERROR]: "Data validation failed",
  [ErrorCode.OPERATION_FAILED]: "Operation failed",
  [ErrorCode.CREATE_ORGANIZATION_FAILED]: "Failed to create organization",
  [ErrorCode.ADD_TEACHER_TO_COURSE_FAILED]: "Failed to add teacher to course",
  [ErrorCode.ADD_STUDENT_TO_COURSE_FAILED]: "Failed to add student to course",
  [ErrorCode.PERMISSION_INSUFFICIENT]: "Permission insufficient",
  [ErrorCode.NOT_IMPLEMENTED]: "Not implemented",
  [ErrorCode.SESSION_UPDATE_FAILED]: "Failed to update user session",
  [ErrorCode.INVITE_USER_FAILED]: "Failed to invite user to organization",
  [ErrorCode.INVALID_ROLE]: "Invalid role specified",
  [ErrorCode.CREATE_TTS_FAILED]: "Failed to create TTS configuration",
  [ErrorCode.UPDATE_TTS_FAILED]: "Failed to update TTS configuration",
  [ErrorCode.REMOVE_TTS_FAILED]: "Failed to remove TTS configuration",
  [ErrorCode.TTS_SERVICE_ERROR]: "TTS service error",
  [ErrorCode.FILE_UPLOAD_FAILED]: "Failed to upload file",
  [ErrorCode.ASSET_INSUFFICIENT_BALANCE]: "Insufficient asset balance",
  [ErrorCode.USER_PERMISSION_DENIED]: "User permission denied",
  [ErrorCode.ASR_FILE_TOO_LARGE]: "Audio file is too large",
  [ErrorCode.ASR_EMPTY_FILE]: "Audio file is empty",
  [ErrorCode.ASR_TRANSCRIPTION_FAILED]: "Audio transcription failed",
  [ErrorCode.ASR_SERVICE_ERROR]: "ASR service error",
  [ErrorCode.LIVE_CLASSROOM_TIME_INVALID]: "Live classroom is not currently scheduled",
  [ErrorCode.COMPONENT_BLOCKED]: "Component progression is blocked",
  [ErrorCode.COURSE_KNOWLEDGE_FILE_NAME_CONFLICT]: "A file with the same name already exists in this section",
  [ErrorCode.VOUCHER_EXPIRED]: "Voucher has expired",
  [ErrorCode.VOUCHER_DISABLED]: "Voucher is disabled",
  [ErrorCode.VOUCHER_USAGE_LIMIT_EXCEEDED]: "Voucher usage limit exceeded",
  [ErrorCode.INTERACTION_ANSWER_TIMEOUT]: "Interaction answer timeout",
  [ErrorCode.COURSE_LIMIT_EXCEEDED]: "Course limit exceeded for current plan",
  [ErrorCode.STORAGE_QUOTA_EXCEEDED]: "Storage quota exceeded for current plan",
  [ErrorCode.MANUAL_STUDENT_MGMT_NOT_ALLOWED]: "Manual student management not allowed on current plan",
  [ErrorCode.PRIVATE_COURSE_NOT_ALLOWED]: "Private courses not allowed on current plan",
  [ErrorCode.TOTAL_SEAT_LIMIT_EXCEEDED]: "Total seat limit exceeded for current plan",
  [ErrorCode.ADMIN_SEAT_LIMIT_EXCEEDED]: "Admin seat limit exceeded for current plan",
  [ErrorCode.TEACHER_SEAT_LIMIT_EXCEEDED_NEW]: "Teacher seat limit exceeded for current plan",
  [ErrorCode.ORGANIZATION_TREE_DEPTH_LIMIT_EXCEEDED]: "Organization tree depth limit exceeded",
  [ErrorCode.ORGANIZATION_DIRECT_CHILDREN_LIMIT_EXCEEDED]: "Organization direct children limit exceeded",
  [ErrorCode.ORGANIZATION_TREE_NODE_LIMIT_EXCEEDED]: "Organization tree node limit exceeded",
  [ErrorCode.USER_FILE_NOT_FOUND]: "User file not found",
  [ErrorCode.TTS_PRONUNCIATION_NOT_FOUND]: "Pronunciation entry not found",
  [ErrorCode.TTS_PRONUNCIATION_ALREADY_EXISTS]:
    "Pronunciation entry with this source text and language already exists",
  // Enterprise account activation
  [ErrorCode.ACCOUNT_NOT_ACTIVATED]: "Account pending activation — check your email for the activation link",
  [ErrorCode.ACTIVATION_TOKEN_INVALID]: "Activation link is invalid",
  [ErrorCode.ACTIVATION_TOKEN_EXPIRED]: "Activation link has expired",
  [ErrorCode.ACTIVATION_TOKEN_USED]: "Activation link has already been used",
  [ErrorCode.ACTIVATION_NOT_PENDING]: "Account is not awaiting activation",
  [ErrorCode.ACCOUNT_LOCKED]: "Account is temporarily locked due to too many failed login attempts",
  [ErrorCode.TOO_MANY_REQUESTS]: "Too many requests, please try again later",
  [ErrorCode.REGISTRATION_RATE_LIMITED]:
    "Too many accounts registered from this network, please try again later",
  // Database error
  [ErrorCode.DATABASE_ERROR]: "Database operation error",
  [ErrorCode.RECORD_NOT_FOUND]: "Data record not found",
  [ErrorCode.ORGANIZATION_PATH_UNRESOLVABLE]:
    "Organization materialized path is missing or malformed, so the organization tree cannot be resolved",
  // System error
  [ErrorCode.SYSTEM_ERROR]: "System internal error",
  [ErrorCode.ATTRIBUTE_ERROR]: "Attribute or method not found",
  [ErrorCode.VALUE_ERROR]: "Value error",
  [ErrorCode.TYPE_ERROR]: "Type error",
  [ErrorCode.KEY_ERROR]: "Key error",
  [ErrorCode.INDEX_ERROR]: "Index error",
};

/** Default error message for an error code */
export function getErrorMessage(code: number): string {
  return ErrorMessages[code] ?? "Unknown error";
}

/**
 * Wire serialization of a business error code.
 *
 * Wire-contract quirk: INTERACTION_ANSWER_TIMEOUT serializes as its enum name string
 * ("INTERACTION_ANSWER_TIMEOUT"); every other code is numeric. The HTTP error envelope and
 * the WS ERROR frame (its code field) share this rule.
 */
export function serializeApiErrorCode(code: number): number | string {
  return code === ErrorCode.INTERACTION_ANSWER_TIMEOUT
    ? "INTERACTION_ANSWER_TIMEOUT"
    : code;
}

export interface ApiErrorOptions {
  /** Details for the server log (never sent to the client) */
  detail?: unknown;
  /** Extra HTTP headers sent with the error response */
  headers?: Record<string, string>;
  /** Structured context visible to the client (e.g. retry_after_seconds). Serialized only when set. */
  data?: Record<string, unknown>;
}

/** Base class for API business exceptions */
export class ApiError extends Error {
  readonly code: number;
  readonly message: string;
  readonly detail?: unknown;
  readonly headers?: Record<string, string>;
  readonly data?: Record<string, unknown>;
  readonly success = false;
  readonly status: number;

  constructor(code: number = ErrorCode.SYSTEM_ERROR, message?: string, statusCode?: number, options?: ApiErrorOptions) {
    super(message ?? getErrorMessage(code));
    this.name = "ApiError";
    this.code = code;
    this.message = message ?? getErrorMessage(code);
    // Without an explicit status code, take it from the first three digits of the error code
    this.status = statusCode ?? Number.parseInt(String(code).slice(0, 3), 10);
    this.detail = options?.detail;
    this.headers = options?.headers;
    this.data = options?.data;
  }
}

/** Shortcut constructor for a not-found exception */
export function raiseNotFound(entityType: string, entityId: string): never {
  if (entityType === "user") {
    throw new ApiError(ErrorCode.USER_NOT_FOUND, `User '${entityId}' not found`, 404);
  }
  if (entityType === "course") {
    throw new ApiError(ErrorCode.COURSE_NOT_FOUND, `Course '${entityId}' not found`, 404);
  }
  throw new ApiError(ErrorCode.NOT_FOUND, `${entityType} '${entityId}' not found`, 404);
}
