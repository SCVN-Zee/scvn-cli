/**
 * test/services/zip.test.ts — createZip shells out to `zip` (execa mocked) and publishes atomically.
 *
 * The execa mock simulates `zip` by creating the requested (.tmp) archive file, so the real
 * rename-onto-final + cleanup paths are exercised on tmp dirs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "../helpers/tmp-dir.js";

const execaMock = vi.hoisted(() => vi.fn());
vi.mock("execa", () => ({ execa: execaMock }));

import { createZip } from "../../src/services/zip.js";

describe("createZip", () => {
  // Simulate `zip`: write the requested (tmp) archive path so the subsequent rename has a source.
  beforeEach(() =>
    execaMock.mockReset().mockImplementation(async (_cmd?: string, args?: string[]) => {
      // Simulate `zip` by creating the requested (tmp) archive so the rename has a source.
      // Tolerant of stray zero-arg invocations from the mock proxy.
      if (Array.isArray(args) && typeof args[2] === "string") {
        await writeFile(args[2], "ZIPPED", "utf8");
      }
      return { exitCode: 0 };
    }),
  );

  it("zips into a .tmp sibling with staging as cwd, then renames onto the final archive", async () => {
    const dir = await tmpDir("scvn-zip-");
    const archive = path.join(dir, "bundle.zip");

    await createZip("/tmp/staging", archive);

    const [cmd, args, opts] = execaMock.mock.calls[0]!;
    expect(cmd).toBe("zip");
    expect(args).toEqual(["-r", "-q", `${archive}.tmp.${process.pid}`, "."]);
    expect(opts).toEqual({ cwd: "/tmp/staging" });
    expect(await readFile(archive, "utf8")).toBe("ZIPPED");
    await expect(access(`${archive}.tmp.${process.pid}`)).rejects.toThrow(); // tmp renamed away
  });

  it("rethrows on non-zero zip and leaves no partial archive or tmp", async () => {
    const dir = await tmpDir("scvn-zip-");
    const archive = path.join(dir, "a.zip");
    execaMock.mockRejectedValueOnce(new Error("zip: command not found"));

    await expect(createZip("/tmp/s", archive)).rejects.toThrow("command not found");
    await expect(access(archive)).rejects.toThrow();
    await expect(access(`${archive}.tmp.${process.pid}`)).rejects.toThrow();
  });

  it("replaces a stale archive (never updates in place)", async () => {
    const dir = await tmpDir("scvn-zip-");
    const archive = path.join(dir, "bundle.zip");
    await writeFile(archive, "stale bytes", "utf8");

    await createZip("/tmp/staging", archive);

    expect(await readFile(archive, "utf8")).toBe("ZIPPED");
  });
});
