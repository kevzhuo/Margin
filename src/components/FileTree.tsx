import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { stripExtension, type FileNode } from "../backend";
import { useStore } from "../state/store";
import { ChevronDown, ChevronRight, Folder } from "./icons";
import { ContextMenu, type MenuItem } from "./ContextMenu";

interface MenuState {
  x: number;
  y: number;
  node: FileNode;
}

function RenameInput({ node, onDone }: { node: FileNode; onDone: (name: string | null) => void }) {
  const initial = node.kind === "file" ? stripExtension(node.name) : node.name;
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onDone(value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onDone(null);
    }
  };
  return (
    <input
      ref={ref}
      className="rename-input"
      aria-label={`Rename ${initial}`}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKey}
      onBlur={() => onDone(value)}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function Row({ node, depth, onMenu }: { node: FileNode; depth: number; onMenu: (e: MouseEvent, node: FileNode) => void }) {
  const activePath = useStore((s) => s.activePath);
  const expanded = useStore((s) => !!s.expandedDirs[node.path]);
  const renaming = useStore((s) => s.renaming);
  const toggleDir = useStore((s) => s.toggleDir);
  const openNote = useStore((s) => s.openNote);
  const renamePath = useStore((s) => s.renamePath);
  const setRenaming = useStore((s) => s.setRenaming);

  const isDir = node.kind === "dir";
  const selected = node.path === activePath;
  const isRenaming = renaming === node.path;

  const onDone = (name: string | null) => {
    if (name === null) setRenaming(null);
    else void renamePath(node.path, name);
  };

  return (
    <>
      <button
        className={`tree-row${selected ? " selected" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => (isDir ? toggleDir(node.path) : void openNote(node.path))}
        onContextMenu={(e) => onMenu(e, node)}
        onDoubleClick={(e) => {
          e.preventDefault();
          setRenaming(node.path);
        }}
        aria-current={selected ? "page" : undefined}
        aria-expanded={isDir ? expanded : undefined}
        data-path={node.path}
        data-kind={node.kind}
        title={node.name}
      >
        {isDir ? (
          <>
            <span className="tree-chevron">{expanded ? <ChevronDown /> : <ChevronRight />}</span>
            <Folder className="tree-icon" />
          </>
        ) : (
          <span className="tree-chevron" aria-hidden="true" />
        )}
        {isRenaming ? <RenameInput node={node} onDone={onDone} /> : <span className="tree-name">{isDir ? node.name : stripExtension(node.name)}</span>}
      </button>
      {isDir && expanded && node.children?.map((child) => <Row key={child.path} node={child} depth={depth + 1} onMenu={onMenu} />)}
    </>
  );
}

export function FileTree() {
  const tree = useStore((s) => s.tree);
  const createNote = useStore((s) => s.createNote);
  const deletePath = useStore((s) => s.deletePath);
  const setRenaming = useStore((s) => s.setRenaming);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const onMenu = (e: MouseEvent, node: FileNode) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, node });
  };

  const items: MenuItem[] = menu
    ? [
        ...(menu.node.kind === "dir" ? [{ label: "New note here", onSelect: () => void createNote(menu.node.path) }] : []),
        { label: "Rename", onSelect: () => setRenaming(menu.node.path) },
        {
          label: menu.node.kind === "dir" ? "Delete folder" : "Delete note",
          danger: true,
          onSelect: () => {
            const label = menu.node.kind === "dir" ? `the folder “${menu.node.name}” and everything in it` : `“${stripExtension(menu.node.name)}”`;
            if (window.confirm(`Delete ${label}?`)) void deletePath(menu.node.path);
          },
        },
      ]
    : [];

  if (!tree.length) {
    return <div className="tree-empty">No notes yet.</div>;
  }

  return (
    <div className="tree" role="tree" aria-label="Notes">
      {tree.map((node) => (
        <Row key={node.path} node={node} depth={0} onMenu={onMenu} />
      ))}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  );
}
