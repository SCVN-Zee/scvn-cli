/**
 * features/packages/resolve-add-folder.ts — Resolve a picked folder to a
 * library package.
 *
 * The `add` flow no longer matches a catalog against a source project; the user
 * picks ONE folder to stage into the library. To import it back into another
 * project at its correct Unity location, the folder must live inside a project's
 * `Assets/` tree: its Assets-relative path becomes `relPath` — the same identity
 * the store mirror + import already key on — so e.g.
 * `.../ProjA/Assets/Plugins/Sirenix` imports to `Assets/Plugins/Sirenix`.
 *
 * Pure: segment inspection only, no I/O. The caller supplies a real folder path
 * (native dialog / dir prompt); existence is the picker's concern.
 */

import path from "node:path";
import { resolveAssetsDir } from "../../util/paths.js";
import { isSafeRelPath } from "../../lib/rel-path-safety.js";

/** A package to stage: a label + its Assets-relative path. */
export interface PackageSpec {
  label: string;
  relPath: string;
}

/** A picked folder resolved to a stageable package. */
export interface ResolvedAddFolder extends PackageSpec {
  /** The project's Assets dir — the copy-source root exportPackages mirrors from. */
  assetsDir: string;
}

export type ResolveAddFolderResult =
  | { status: "ok"; folder: ResolvedAddFolder }
  | { status: "invalid"; message: string };

/**
 * Resolve a picked folder to `{ assetsDir, relPath, label }`, or an invalid
 * result with a user-facing reason. Rejects folders outside an `Assets/` tree,
 * the `Assets/` dir itself (empty relPath), and unsafe paths (the guard in front
 * of copyPackage's recursive delete).
 */
export function resolveAddFolder(picked: string): ResolveAddFolderResult {
  const assetsDir = resolveAssetsDir(picked);
  if (assetsDir === null) {
    return {
      status: "invalid",
      message: `${picked} is not inside a Unity project's Assets/ folder`,
    };
  }

  const relPath = path.relative(assetsDir, picked);
  if (relPath === "") {
    return {
      status: "invalid",
      message: "Pick a folder inside Assets/, not the Assets/ folder itself",
    };
  }
  if (!isSafeRelPath(relPath)) {
    return { status: "invalid", message: `Unsafe path: ${relPath}` };
  }

  return {
    status: "ok",
    folder: { label: path.basename(relPath), relPath, assetsDir },
  };
}
