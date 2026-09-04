import { describe, expect, it, vi } from "vitest";

const mcpMock = vi.hoisted(() => ({
  runMcp: vi.fn(async () => {}),
}));

vi.mock("../../src/commands/mcp.js", () => mcpMock);

import { capabilities } from "../../desktop/host/capabilities.js";

const session = {} as never;

describe("MCP desktop host payload", () => {
  it("preserves an explicitly empty extension selection", async () => {
    await capabilities.mcp(session, {
      verb: "install",
      target: "/project/Assets",
      extensions: [],
    });

    expect(mcpMock.runMcp).toHaveBeenCalledWith(
      expect.objectContaining({ addons: "" }),
      expect.anything(),
      expect.anything(),
    );
  });
});
