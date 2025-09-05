import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { logger } from "../telemetry-cf";

export const errorHandler: ErrorHandler = (err, c) => {
  logger.error(`Error in ${c.req.method} ${c.req.path}:`, {
    error: err.message,
    stack: err.stack,
  });

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const validationErrors = err.errors
      .map((error) => `${error.path.join(".")} ${error.message}`)
      .join(", ");

    const problem = {
      type: "validation_error",
      title: "Validation Error",
      status: 400,
      detail: validationErrors,
      instance: c.req.path,
    };

    return c.json(problem, 400);
  }

  // Handle HTTP exceptions
  if (err instanceof HTTPException) {
    let problem;

    try {
      // Try to parse as RFC 7807 problem
      problem = JSON.parse(err.message);
    } catch {
      // Fallback to generic problem
      const status = err.status;
      let type = "internal_error";
      let title = "Internal Server Error";

      switch (status) {
        case 400:
          type = "validation_error";
          title = "Validation Error";
          break;
        case 401:
          type = "unauthorized";
          title = "Unauthorized";
          break;
        case 403:
          type = "forbidden";
          title = "Forbidden";
          break;
        case 404:
          type = "not_found";
          title = "Not Found";
          break;
        case 409:
          type = "conflict";
          title = "Conflict";
          break;
        default:
          type = "internal_error";
          title = "Internal Server Error";
      }

      problem = {
        type,
        title,
        status,
        detail: err.message || title,
        instance: c.req.path,
      };
    }

    return c.json(problem, err.status);
  }

  // Handle generic errors
  const problem = {
    type: "internal_error",
    title: "Internal Server Error",
    status: 500,
    detail: "An unexpected error occurred",
    instance: c.req.path,
  };

  return c.json(problem, 500);
};

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
