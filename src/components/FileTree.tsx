import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { dirname, isWithin, platform, stripExtension, type FileNode } from "../backend";
import { useStore } from "../state/store";
import { confirmAndDelete, formatShortcut } from "../state/appCommands";
import { ChevronRight, Folder } from "./icons";
import { ContextMenu, type MenuItem } from "./ContextMenu";

interface MenuState {
  x: number;
  y: number;
  node: FileNode | null;
}

const DRAG_TYPE = "application/x-margin-path";
/** Hovering a collapsed folder this long while dragging opens it. */
const SPRING_OPEN_MS = 600;

function RenameInput({ node, onDone }: { node: FileNode; onDone: (name: string | null) => void }) {
  const initial = node.kind === "file" ? stripExtension(node.name) : node.name;
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      finish(value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(null);
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
      onBlur={() => finish(value)}
      onClick={(e) => e.stopPropagation()}
      spellCheck={false}
    />
  );
}

interface RowProps {
  node: FileNode;
  depth: number;
  onMenu: (e: MouseEvent, node: FileNode) => void;
  dropTarget: string | null;
  onDragStart: (node: FileNode) => void;
}

function Row({ node, depth, onMenu, dropTarget, onDragStart }: RowProps) {
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

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (isRenaming) return;
    if (e.key === "F2") {
      e.preventDefault();
      e.stopPropagation();
      setRenaming(node.path);
    } else if ((e.metaKey || e.ctrlKey) && (e.key === "Backspace" || e.key === "Delete")) {
      e.preventDefault();
      void confirmAndDelete(node.path, node.kind);
    } else if (isDir && e.key === "ArrowRight" && !expanded) {
      e.preventDefault();
      toggleDir(node.path);
    } else if (isDir && e.key === "ArrowLeft" && expanded) {
      e.preventDefault();
      toggleDir(node.path);
    }
  };

  const Tag = isRenaming ? "div" : "button";

  return (
    <div className="tree-node">
      <Tag
        className={`tree-row${selected ? " selected" : ""}${dropTarget === node.path ? " drop-target" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => (isRenaming ? undefined : isDir ? toggleDir(node.path) : void openNote(node.path))}
        onContextMenu={(e: MouseEvent) => onMenu(e, node)}
        onDoubleClick={(e: MouseEvent) => {
          e.preventDefault();
          setRenaming(node.path);
        }}
        onKeyDown={onKeyDown}
        draggable={!isRenaming}
        onDragStart={(e: DragEvent) => {
          e.dataTransfer.setData(DRAG_TYPE, node.path);
          e.dataTransfer.setData("text/plain", node.path);
          e.dataTransfer.effectAllowed = "move";
          onDragStart(node);
        }}
        aria-current={selected ? "page" : undefined}
        aria-expanded={isDir ? expanded : undefined}
        data-path={node.path}
        data-kind={node.kind}
        title={node.name}
      >
        {isDir ? (
          <>
            <span className={`tree-chevron${expanded ? " open" : ""}`}>
              <ChevronRight />
            </span>
            <Folder className="tree-icon" />
          </>
        ) : (
          <span className="tree-chevron" aria-hidden="true" />
        )}
        {isRenaming ? <RenameInput node={node} onDone={onDone} /> : <span className="tree-name">{isDir ? node.name : stripExtension(node.name)}</span>}
      </Tag>
      {isDir && (
        <div className="tree-children" data-open={expanded} inert={!expanded || undefined} role="group">
          <div className="tree-children-inner">
            {node.children?.map((child) => (
              <Row key={child.path} node={child} depth={depth + 1} onMenu={onMenu} dropTarget={dropTarget} onDragStart={onDragStart} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const fileManagerLabel = () => (platform() === "macos" ? "Show in Finder" : platform() === "windows" ? "Show in Explorer" : "Show in file manager");

export function FileTree() {
  const tree = useStore((s) => s.tree);
  const vaultRoot = useStore((s) => s.vaultRoot);
  const backend = useStore((s) => s.backend);
  const expandedDirs = useStore((s) => s.expandedDirs);
  const createNote = useStore((s) => s.createNote);
  const createFolder = useStore((s) => s.createFolder);
  const setRenaming = useStore((s) => s.setRenaming);
  const copyPath = useStore((s) => s.copyPath);
  const revealPath = useStore((s) => s.revealPath);
  const movePath = useStore((s) => s.movePath);
  const toggleDir = useStore((s) => s.toggleDir);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dragging, setDragging] = useState<FileNode | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const springTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onMenu = (e: MouseEvent, node: FileNode | null) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, node });
  };

  const items = (node: FileNode | null): MenuItem[] => {
    const reveal: MenuItem[] = node && backend?.revealPath ? [{ label: fileManagerLabel(), onSelect: () => void revealPath(node.path) }] : [];
    if (!node) {
      return [
        { label: "New note", hint: formatShortcut("Mod+N"), onSelect: () => void createNote() },
        { label: "New folder", hint: formatShortcut("Mod+Shift+N"), onSelect: () => void createFolder() },
      ];
    }
    if (node.kind === "dir") {
      return [
        { label: "New note here", onSelect: () => void createNote(node.path) },
        { label: "New folder here", onSelect: () => void createFolder(node.path) },
        { separator: true },
        { label: "Rename", hint: "F2", onSelect: () => setRenaming(node.path) },
        { label: "Copy path", onSelect: () => void copyPath(node.path) },
        ...reveal,
        { separator: true },
        { label: "Delete folder", danger: true, onSelect: () => void confirmAndDelete(node.path, "dir") },
      ];
    }
    return [
      { label: "Rename", hint: "F2", onSelect: () => setRenaming(node.path) },
      { label: "Copy path", onSelect: () => void copyPath(node.path) },
      ...reveal,
      { separator: true },
      { label: "Delete note", danger: true, onSelect: () => void confirmAndDelete(node.path, "file") },
    ];
  };

  // ---- drag and drop -------------------------------------------------------

  const targetFor = (el: EventTarget | null): string | null => {
    if (!dragging || !vaultRoot) return null;
    const row = (el as Element | null)?.closest?.<HTMLElement>("[data-path]");
    let target = vaultRoot;
    if (row?.dataset.path) target = row.dataset.kind === "dir" ? row.dataset.path : dirname(row.dataset.path);
    if (target === dirname(dragging.path)) return null;
    if (dragging.kind === "dir" && isWithin(target, dragging.path)) return null;
    return target;
  };

  const clearSpring = () => {
    if (springTimer.current) clearTimeout(springTimer.current);
    springTimer.current = null;
  };

  const resetDrag = () => {
    clearSpring();
    setDragging(null);
    setDropTarget(null);
  };

  const onDragOver = (e: DragEvent) => {
    if (!dragging) return;
    const target = targetFor(e.target);
    if (!target) {
      e.dataTransfer.dropEffect = "none";
      if (dropTarget !== null) {
        clearSpring();
        setDropTarget(null);
      }
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (target !== dropTarget) {
      clearSpring();
      setDropTarget(target);
      if (target !== vaultRoot && !expandedDirs[target]) {
        springTimer.current = setTimeout(() => toggleDir(target), SPRING_OPEN_MS);
      }
    }
  };

  const onDrop = (e: DragEvent) => {
    if (!dragging) return;
    e.preventDefault();
    const target = targetFor(e.target);
    const from = dragging.path;
    resetDrag();
    if (target) void movePath(from, target);
  };

  if (!tree.length) {
    return (
      <div className="tree-empty" onContextMenu={(e) => onMenu(e, null)}>
        No notes yet.
        {menu && <ContextMenu x={menu.x} y={menu.y} items={items(menu.node)} onClose={() => setMenu(null)} />}
      </div>
    );
  }

  return (
    <div
      className={`tree${dropTarget && dropTarget === vaultRoot ? " drop-root" : ""}${dragging ? " dragging" : ""}`}
      role="tree"
      aria-label="Notes"
      onContextMenu={(e) => onMenu(e, null)}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          clearSpring();
          setDropTarget(null);
        }
      }}
      onDragEnd={resetDrag}
    >
      {tree.map((node) => (
        <Row key={node.path} node={node} depth={0} onMenu={onMenu} dropTarget={dropTarget} onDragStart={setDragging} />
      ))}
      <div className="tree-spacer" aria-hidden="true" />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items(menu.node)} onClose={() => setMenu(null)} />}
    </div>
  );
}
