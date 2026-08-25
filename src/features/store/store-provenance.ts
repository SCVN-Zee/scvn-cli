/**
 * features/store/store-provenance.ts — Human-readable provenance line.
 *
 * formatPackageProvenance(pkg) → "Hub @ main, 2d ago, 142 MB"
 * Null branch omits the "@ branch" part: "Hub, 2d ago, 142 MB".
 * Library views print this per package so the user can judge each one's origin
 * and staleness before importing.
 */

import { relativeTime } from "../../util/relative-time.js";
import { formatBytes } from "../../util/format-bytes.js";
import type { StagedPackage } from "./store-meta.js";

export function formatPackageProvenance(pkg: StagedPackage): string {
  const namePart = pkg.branch ? `${pkg.sourceName} @ ${pkg.branch}` : pkg.sourceName;
  const agePart  = relativeTime(Date.parse(pkg.stagedAt));
  const sizePart = formatBytes(pkg.bytes);
  return `${namePart}, ${agePart}, ${sizePart}`;
}
