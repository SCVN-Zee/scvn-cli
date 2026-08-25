/**
 * test/features/mcp-verify-tarball.test.ts — Tarball integrity, the security boundary.
 *
 * The bash original verified NOTHING. Every tarball is now checked against the
 * packument's `dist.integrity` (sha512, base64) BEFORE it touches disk, so a
 * poisoned download can never be extracted into a Unity project.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { integrityOf, verifyIntegrity } from "../../src/features/mcp/verify-tarball.js";

const BODY = Buffer.from("pretend this is a .tgz");
const GOOD = `sha512-${createHash("sha512").update(BODY).digest("base64")}`;

describe("integrityOf", () => {
  it("computes the sha512-base64 form the registry publishes", () => {
    expect(integrityOf(BODY)).toBe(GOOD);
  });
});

describe("verifyIntegrity", () => {
  it("accepts a buffer matching its published integrity", () => {
    expect(() => verifyIntegrity(BODY, GOOD, "pkg@1.0.0")).not.toThrow();
  });

  it("rejects a tampered payload", () => {
    const tampered = Buffer.from("pretend this is a .tgz!");
    expect(() => verifyIntegrity(tampered, GOOD, "pkg@1.0.0")).toThrow(/integrity/i);
    expect(() => verifyIntegrity(tampered, GOOD, "pkg@1.0.0")).toThrow(/pkg@1\.0\.0/);
  });

  it("rejects a tampered integrity string (one flipped base64 char)", () => {
    const flipped = GOOD[8] === "A" ? `sha512-B${GOOD.slice(8)}` : `sha512-A${GOOD.slice(8)}`;
    expect(() => verifyIntegrity(BODY, flipped, "pkg@1.0.0")).toThrow(/integrity/i);
  });

  it("refuses a non-sha512 algorithm rather than skipping the check", () => {
    const sha1 = `sha1-${createHash("sha1").update(BODY).digest("base64")}`;
    expect(() => verifyIntegrity(BODY, sha1, "pkg@1.0.0")).toThrow(/sha512/);
  });

  it("refuses a missing integrity rather than trusting the payload", () => {
    expect(() => verifyIntegrity(BODY, undefined, "pkg@1.0.0")).toThrow(/no integrity/i);
    expect(() => verifyIntegrity(BODY, "", "pkg@1.0.0")).toThrow(/no integrity/i);
  });

  it("tolerates a multi-hash integrity string containing a sha512 entry", () => {
    // npm may publish "sha512-… sha1-…" — a space-separated set.
    const sha1 = `sha1-${createHash("sha1").update(BODY).digest("base64")}`;
    expect(() => verifyIntegrity(BODY, `${sha1} ${GOOD}`, "pkg@1.0.0")).not.toThrow();
  });
});
