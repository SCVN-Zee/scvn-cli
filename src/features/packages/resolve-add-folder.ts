/**
 * features/packages/resolve-add-folder.ts — Resolve a picked folder to a
 * library package.
 *
 * The `add` flow no longer matches a catalog against a source project; the user
 * picks ONE folder to stage into the library. To import it back into another
 * project at its correct Unity location, the folder must live inside a Unity
 * project — anywhere in it: `Assets/...`, an embedded UPM package under
 * `Packages/...`, or a custom root-level folder. Its PROJECT-ROOT-relative path
 * becomes `relPath` — the same identity the store mirror + import key on — so
 * e.g. `.../ProjA/Assets/Plugins/Sirenix` imports to `Assets/Plugins/Sirenix`
 * and `.../ProjA/Packages/com.acme.core` imports to `Packages/com.acme.core`.
 *
 * A Unity project is recognized by `ProjectSettings/ProjectVersion.txt` — the
 * same marker `services/discover.ts` trusts for scanning — found at or above
 * the picked folder. The walk is leaf-first, so a project nested inside
 * another project's Assets/ resolves to the nested root.
 *
 * Split: `resolveAddFolderWithinRoot` is pure segment math over a known root;
 * `resolveAddFolder` adds the marker walk-up (I/O via fs-predicates).
 */

import path from "node:path";
import { isFile } from "../../util/fs-predicates.js";
import { isSafeRelPath } from "../../lib/rel-path-safety.js";

/** A package to stage: a label + its project-root-relative path. */
export interface PackageSpec {
  label: string;
  relPath: string;
}

/** A picked folder resolved to a stageable package. */
export interface ResolvedAddFolder extends PackageSpec {
  /** The Unity project root — the copy-source root exportPackages mirrors from. */
  projectRoot: string;
}

export type ResolveAddFolderResult =
  | { status: "ok"; folder: ResolvedAddFolder }
  | { status: "invalid"; message: string };

/**
 * Top-level project folders that are never stageable as a WHOLE package:
 * Unity's own contract-bearing dirs. Staging all of `Packages/` would drag
 * manifest.json and stomp a target's UPM config; `Assets/` and
 * `ProjectSettings/` are project machinery, not a package. Their children
 * (e.g. `Packages/com.acme.core`) stage fine.
 */
const BLOCKED_TOP_LEVEL: Record<string, true> = {
  Assets: true,
  Packages: true,
  ProjectSettings: true,
};

/**
 * Walk leaf-first from `start` and return the nearest ancestor (including
 * itself) that holds `ProjectSettings/ProjectVersion.txt` — the enclosing
 * Unity project root — or null when none exists up to the filesystem root.
 */
export async function findNearestProjectRoot(start: string): Promise<string | null> {
  let current = path.resolve(start);
  for (;;) {
    if (await isFile(path.join(current, "ProjectSettings", "ProjectVersion.txt"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Pure core: resolve a picked folder against a KNOWN project root to
 * `{ projectRoot, relPath, label }`, or an invalid result with a user-facing
 * reason. Rejects the project root itself (empty relPath), Unity's special
 * top-level dirs picked whole, and unsafe paths (the guard in front of
 * copyPackage's recursive delete).
 */
export function resolveAddFolderWithinRoot(
  picked: string,
  projectRoot: string,
): ResolveAddFolderResult {
  const relPath = path.relative(projectRoot, picked);
  if (relPath === "") {
    return {
      status: "invalid",
      message: "Pick a folder inside the Unity project, not the project root itself",
    };
  }
  if (!isSafeRelPath(relPath)) {
    return { status: "invalid", message: `Unsafe path: ${relPath}` };
  }

  const segments = relPath.split(/[\\/]+/);
  if (segments.length === 1 && BLOCKED_TOP_LEVEL[segments[0]!] === true) {
    return {
      status: "invalid",
      message: `Pick a specific folder inside ${segments[0]}/, not the whole ${segments[0]}/ folder`,
    };
  }

  return {
    status: "ok",
    folder: { label: path.basename(relPath), relPath, projectRoot },
  };
}

/**
 * Resolve a picked folder to a stageable package: locate the enclosing Unity
 * project (marker walk-up), then derive its root-relative identity. Rejects
 * folders outside any Unity project.
 */
export async function resolveAddFolder(picked: string): Promise<ResolveAddFolderResult> {
  const projectRoot = await findNearestProjectRoot(picked);
  if (projectRoot === null) {
    return {
      status: "invalid",
      message: `${picked} is not inside a Unity project (no ProjectSettings/ProjectVersion.txt above it)`,
    };
  }
  return resolveAddFolderWithinRoot(picked, projectRoot);
}
