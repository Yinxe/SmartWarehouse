/**
 * 领域层基础错误与 Result 模式。
 *
 * Domain 方法不抛异常，而是返回 Result 以便 Application 层处理恢复策略。
 */

export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<E = string>(error: E): Result<never, E> {
  return { ok: false, error };
}

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}
