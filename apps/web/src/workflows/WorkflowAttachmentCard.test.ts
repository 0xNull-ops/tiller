import { describe, expect, it } from "vite-plus/test";
import { attachmentChipCounts } from "./WorkflowAttachmentCard";

describe("attachmentChipCounts", () => {
  it("counts each kind a step uses and leaves out the kinds it does not", () => {
    expect(
      attachmentChipCounts({
        credentials: 1,
        checks: 0,
        attachments: [
          { id: "github", kind: "mcp-connection", server: "github" },
          { id: "xcode", kind: "requirement", requirement: "Xcode" },
          { id: "gh", kind: "service-login", service: "gh" },
        ],
      }),
    ).toEqual([
      { kind: "credential", count: 1 },
      { kind: "mcp", count: 1 },
      { kind: "login", count: 2 },
    ]);
  });

  it("returns no chips for a step without satellites", () => {
    expect(attachmentChipCounts({ credentials: 0, checks: 0, attachments: [] })).toEqual([]);
  });
});
