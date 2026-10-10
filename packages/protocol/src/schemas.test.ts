import { describe, expect, it } from "vitest";
import {
  DevServerReportSchema,
  MAX_SOURCE_LINE,
  OpenSourceRequestSchema,
} from "./schemas";

/**
 * Boundary coverage for the bidirectional-bridge schemas: the agent's
 * editor-open and dev-server-report routes reject malformed input before any
 * filesystem or project-state work happens.
 */

describe("OpenSourceRequestSchema", () => {
  it("accepts a well-formed request", () => {
    expect(
      OpenSourceRequestSchema.safeParse({
        projectId: "/proj/a",
        file: "src/pages/Dashboard.tsx",
        line: 11,
        column: 4,
      }).success,
    ).toBe(true);
  });

  it("rejects empty/oversized and non-positive positions", () => {
    expect(OpenSourceRequestSchema.safeParse({ projectId: "", file: "a.tsx", line: 1, column: 0 }).success).toBe(false);
    expect(OpenSourceRequestSchema.safeParse({ projectId: "p", file: "", line: 1, column: 0 }).success).toBe(false);
    expect(OpenSourceRequestSchema.safeParse({ projectId: "p", file: "a.tsx", line: 0, column: 0 }).success).toBe(false);
    expect(OpenSourceRequestSchema.safeParse({ projectId: "p", file: "a.tsx", line: -1, column: 0 }).success).toBe(false);
    expect(OpenSourceRequestSchema.safeParse({ projectId: "p", file: "a.tsx", line: 1.5, column: 0 }).success).toBe(false);
    expect(OpenSourceRequestSchema.safeParse({ projectId: "p", file: "a.tsx", line: 1, column: -2 }).success).toBe(false);
    expect(
      OpenSourceRequestSchema.safeParse({ projectId: "p", file: "a.tsx", line: MAX_SOURCE_LINE + 1, column: 0 }).success,
    ).toBe(false);
  });
});

describe("DevServerReportSchema", () => {
  it("accepts loopback urls as opaque strings (origin checks live in the route)", () => {
    expect(DevServerReportSchema.safeParse({ url: "http://127.0.0.1:5173" }).success).toBe(true);
  });

  it("rejects empty and missing urls", () => {
    expect(DevServerReportSchema.safeParse({ url: "" }).success).toBe(false);
    expect(DevServerReportSchema.safeParse({}).success).toBe(false);
  });
});
