import { splitRelPath } from "./package-tree.js";

export interface InitLayoutTreeNode {
  name: string;
  path: string;
  explicit: boolean;
  children: InitLayoutTreeNode[];
}

function compareNodes(a: InitLayoutTreeNode, b: InitLayoutTreeNode): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}

export function buildInitLayoutTree(paths: readonly string[]): InitLayoutTreeNode[] {
  const root: InitLayoutTreeNode = { name: "", path: "", explicit: false, children: [] };
  for (const relativePath of paths) {
    const segments = splitRelPath(relativePath);
    let current = root;
    let currentPath = "";
    for (let index = 0; index < segments.length; index++) {
      const name = segments[index]!;
      currentPath = currentPath ? `${currentPath}/${name}` : name;
      let child = current.children.find((candidate) => candidate.name === name);
      if (!child) {
        child = { name, path: currentPath, explicit: false, children: [] };
        current.children.push(child);
      }
      if (index === segments.length - 1) child.explicit = true;
      current = child;
    }
  }

  const sort = (nodes: InitLayoutTreeNode[]): void => {
    nodes.sort(compareNodes);
    for (const node of nodes) sort(node.children);
  };
  sort(root.children);
  return root.children;
}

export function renameInitTreePath(paths: readonly string[], fromPath: string, nextName: string): string[] {
  const parent = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
  const nextPath = parent ? `${parent}/${nextName}` : nextName;
  return paths.map((value) => value === fromPath
    ? nextPath
    : value.startsWith(`${fromPath}/`)
      ? `${nextPath}${value.slice(fromPath.length)}`
      : value);
}

export function removeInitTreePath(paths: readonly string[], removedPath: string): string[] {
  return paths.filter((value) => value !== removedPath && !value.startsWith(`${removedPath}/`));
}
