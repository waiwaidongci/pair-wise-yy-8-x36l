// 业务错误类型：路由层据此映射 HTTP 状态码
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "批次不存在") {
    super(message);
    this.name = "NotFoundError";
    this.code = "not_found";
  }
}

export class ConflictError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ConflictError";
    this.code = code;
    Object.assign(this, details);
  }
}
