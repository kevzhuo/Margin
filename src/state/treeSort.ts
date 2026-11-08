import type { FileNode } from "../backend/types";

/** How the sidebar orders notes. Folders always come first. */
export type SortBy = "name" | "modified" | "created";

export const SORT_LABELS: Record<SortBy, string> = {
  name: "Name",
  modified: "Last edited",
  created: "Date created",
};

const byName = (a: FileNode, b: FileNode) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/**
 * The tree in the chosen order. The backends list it by name already; by
 * date, the newest come first, and a folder counts as new as the newest
 * note inside it, so the folders you are working in rise to the top.
 */
export function sortTree(nodes: FileNode[], by: SortBy): FileNode[] {
  if (by === "name") return nodes;
  const newest = new Map<FileNode, number>();
  const time = (node: FileNode): number => {
    let t = newest.get(node);
    if (t !== undefined) return t;
    t = node.kind === "file" ? (node[by] ?? 0) : Math.max(node.children?.length ? 0 : (node[by] ?? 0), ...(node.children ?? []).map(time));
    newest.set(node, t);
    return t;
  };
  const sort = (list: FileNode[]): FileNode[] =>
    list
      .map((n) => (n.children ? { ...n, children: sort(n.children) } : n))
      .sort((a, b) => (a.kind !== b.kind ? (a.kind === "dir" ? -1 : 1) : time(b) - time(a) || byName(a, b)));
  return sort(nodes);
}

/** The tree with one file's modified time set, so "Last edited" order follows Margin's own saves. */
export function touchFile(nodes: FileNode[], path: string, modified: number): FileNode[] {
  let changed = false;
  const visit = (list: FileNode[]): FileNode[] =>
    list.map((n) => {
      if (n.path === path && n.kind === "file") {
        changed = true;
        return { ...n, modified };
      }
      if (!n.children || !path.startsWith(n.path + "/")) return n;
      return { ...n, children: visit(n.children) };
    });
  const next = visit(nodes);
  return changed ? next : nodes;
}
