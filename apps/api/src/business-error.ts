import {
  fail,
  type BusinessErrorCodeType,
  type FailureResponse,
  type JsonValue,
} from '@gc/contracts';

export type BusinessHttpStatus = 400 | 403 | 404 | 409 | 503;

export const BusinessErrorHttpStatusMap: Readonly<
  Record<BusinessErrorCodeType, BusinessHttpStatus>
> = Object.freeze({
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  WORK_ORDER_NUMBER_EXISTS: 409,
  ACCOUNT_USERNAME_EXISTS: 409,
  INVALID_CREDENTIALS: 403,
  ACCOUNT_LAST_ADMIN: 409,
  SOURCE_UNAVAILABLE: 503,
});

export class BusinessException extends Error {
  readonly code: BusinessErrorCodeType;
  readonly status: BusinessHttpStatus;
  readonly details?: JsonValue | undefined;

  constructor(
    code: BusinessErrorCodeType,
    message: string,
    details?: JsonValue,
  ) {
    const trimmed = message.trim();
    const resolvedMessage =
      trimmed.length > 0
        ? trimmed
        : `Business operation failed with code '${code}'`;
    super(resolvedMessage);
    this.name = 'BusinessException';
    this.code = code;
    this.status = BusinessErrorHttpStatusMap[code];
    this.details = details;
  }

  toResponse(timestamp: string): FailureResponse {
    return fail(this.code, this.message, this.details, timestamp);
  }
}
