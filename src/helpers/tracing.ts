import { Span, SpanStatusCode } from "@opentelemetry/api";

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function markSpanOk(span: Span, message: string) {
  span.setStatus({
    code: SpanStatusCode.OK,
    message,
  });
}

export function markSpanErrorMessage(span: Span, message: string) {
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message,
  });
}

export function markSpanError(span: Span, error: unknown, eventName: string) {
  const message = getErrorMessage(error);

  span.addEvent(eventName, {
    "error.message": message,
  });
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message,
  });
}