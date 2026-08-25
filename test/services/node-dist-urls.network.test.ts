/**
 * test/services/node-dist-urls.network.test.ts — CI-only live-URL guard for the pinned Node.
 *
 * SKIPPED by default (no network in the normal suite). Enable in CI with SCVN_NETWORK_TESTS=1 to
 * catch a yanked/typo'd `PINNED_NODE_VERSION` before it fails a real `make pack`: HEADs the tarball
 * + SHASUMS256.txt for both arches.
 */

import { describe, it, expect } from "vitest";
import { PINNED_NODE_VERSION, tarballUrl } from "../../src/services/node-dist.js";

const enabled = Boolean(process.env["SCVN_NETWORK_TESTS"]);

describe.runIf(enabled)("node-dist pinned URLs are live (network)", () => {
  const shasums = `https://nodejs.org/dist/v${PINNED_NODE_VERSION}/SHASUMS256.txt`;

  it("SHASUMS256.txt resolves for the pinned version", async () => {
    const res = await fetch(shasums, { method: "HEAD" });
    expect(res.ok).toBe(true);
  });

  it.each(["arm64", "x64"] as const)("the %s tarball resolves", async (arch) => {
    const res = await fetch(tarballUrl(PINNED_NODE_VERSION, arch), { method: "HEAD" });
    expect(res.ok).toBe(true);
  });
});
