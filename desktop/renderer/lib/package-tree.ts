/**
 * lib/package-tree.ts — Group staged packages by their project-root-relative
 * path.
 *
 * The library is a flat list of { label, relPath }. Import and remove key on
 * relPath; this module only shapes that list into a directory tree so the
 * Packages page can show where each package lives (Assets/Plugins/Sirenix vs
 * Packages/com.acme.core).
 */

export interface TreePackage {
  label: string;
  relPath: string;
}

export interface PackageTreeNode<T extends TreePackage = TreePackage> {
  /** Last path segment (folder or package name). */
  name: string;
  /** Project-root-relative path of this node (`Assets/Plugins/Demigiant`). */
  path: string;
  pkg?: T;
  children: PackageTreeNode<T>[];
}

/** Split a project-root-relative path on `/` or `\` and drop empty segments. */
export function splitRelPath(relPath: string): string[] {
  return relPath.split(/[/\\]/).filter((segment) => segment.length > 0);
}

function compareName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function sortTree<T extends TreePackage>(node: PackageTreeNode<T>): void {
  node.children.sort((a, b) => compareName(a.name, b.name));
  for (const child of node.children) sortTree(child);
}

/**
 * Build a directory tree from staged packages. Root children are top-level
 * project entries (`Assets`, `Packages`, custom root folders, …). A node may
 * be a grouping folder, a package, or both (a package with nested packages).
 */
export function buildPackageTree<T extends TreePackage>(
  rows: readonly T[],
): PackageTreeNode<T>[] {
  const root: PackageTreeNode<T> = { name: "", path: "", children: [] };

  for (const row of rows) {
    const segments = splitRelPath(row.relPath);
    if (segments.length === 0) continue;

    let current = root;
    let acc = "";
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      acc = acc === "" ? seg : `${acc}/${seg}`;
      let child = current.children.find((c) => c.name === seg);
      if (!child) {
        child = { name: seg, path: acc, children: [] };
        current.children.push(child);
      }
      if (i === segments.length - 1) child.pkg = row;
      current = child;
    }
  }

  sortTree(root);
  return root.children;
}

/** relPaths of every package in this subtree, including the node itself. */
export function collectPackageRelPaths<T extends TreePackage>(
  node: PackageTreeNode<T>,
): string[] {
  const relPaths: string[] = [];
  const visit = (n: PackageTreeNode<T>): void => {
    if (n.pkg) relPaths.push(n.pkg.relPath);
    for (const child of n.children) visit(child);
  };
  visit(node);
  return relPaths;
}

/** @deprecated Use collectPackageRelPaths — selection keys on relPath, not label. */
export const collectPackageLabels = collectPackageRelPaths;

/** Paths of all nodes that have children — the default expanded set. */
export function allFolderPaths<T extends TreePackage>(
  nodes: readonly PackageTreeNode<T>[],
): string[] {
  const paths: string[] = [];
  const visit = (node: PackageTreeNode<T>): void => {
    if (node.children.length === 0) return;
    paths.push(node.path);
    for (const child of node.children) visit(child);
  };
  for (const node of nodes) visit(node);
  return paths;
}
