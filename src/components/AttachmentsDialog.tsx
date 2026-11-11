import { useEffect, useMemo, useState } from "react";
import { basename, fileManagerLabel, stripExtension } from "../backend";
import { useStore, type AttachmentScan } from "../state/store";
import type { ImageUse } from "../state/attachmentUsage";
import { usePresence } from "./usePresence";
import { Segmented } from "./Segmented";
import { FolderOpen, Image, Trash, X } from "./icons";

type Filter = "all" | "unused";

/** Notes listed under an image before the rest collapse into "and N more". */
const USES_SHOWN = 3;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });

/**
 * Every image in the vault, which notes use each, and a way to move the ones
 * no note uses to the Trash.
 */
export function AttachmentsDialog() {
  const open = useStore((s) => s.attachmentsOpen);
  const setOpen = useStore((s) => s.setAttachmentsOpen);
  const backend = useStore((s) => s.backend);
  const revealable = !!backend?.revealPath;
  const { mounted, closing } = usePresence(open, 140);
  const [scan, setScan] = useState<AttachmentScan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [scanCount, setScanCount] = useState(0);

  // Look through the vault each time the window opens (or after Try again).
  useEffect(() => {
    if (!open) return;
    let current = true;
    setScan(null);
    setError(null);
    useStore
      .getState()
      .scanAttachments()
      .then((result) => current && setScan(result))
      .catch((e) => current && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      current = false;
    };
  }, [open, scanCount]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // The confirmation on top handles its own Escape.
      if (e.key === "Escape" && !e.defaultPrevented && !useStore.getState().confirmRequest) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const unused = useMemo(() => scan?.images.filter((img) => !scan.usage.get(img.path)?.length) ?? [], [scan]);
  const unusedBytes = unused.reduce((sum, img) => sum + img.size, 0);
  const shown = filter === "unused" ? unused : (scan?.images ?? []);

  if (!mounted) return null;

  const close = () => setOpen(false);
  const forget = (paths: string[]) =>
    setScan((s) => (s ? { images: s.images.filter((img) => !paths.includes(img.path)), usage: s.usage } : s));

  const trashOne = async (path: string, uses: ImageUse[]) => {
    const s = useStore.getState();
    if (uses.length) {
      const notes = new Set(uses.map((u) => u.notePath)).size;
      const ok = await s.askConfirm({
        title: `Move “${basename(path)}” to the trash?`,
        message: `${notes === 1 ? "A note uses it" : `${notes} notes use it`}, and will show a missing image instead.`,
        confirmLabel: "Move to Trash",
        danger: true,
      });
      if (!ok) return;
    }
    forget(await s.trashImages([path]));
  };

  const cleanUp = async () => {
    const s = useStore.getState();
    const count = unused.length;
    const ok = await s.askConfirm({
      title: `Move ${count === 1 ? "1 unused image" : `${count} unused images`} to the trash?`,
      message: `No note uses ${count === 1 ? "it" : "them"}. This frees ${formatBytes(unusedBytes)}, and you can get ${count === 1 ? "it" : "them"} back from the Trash.`,
      confirmLabel: "Move to Trash",
      danger: true,
    });
    if (!ok) return;
    forget(await s.trashImages(unused.map((img) => img.path)));
    setFilter("all");
  };

  const openUse = (use: ImageUse) => {
    close();
    void useStore.getState().openNote(use.notePath, { jump: { line: use.line } });
  };

  return (
    <div className="modal-backdrop centered" data-closing={closing || undefined} onMouseDown={close}>
      <div
        className="attachments"
        role="dialog"
        aria-modal="true"
        aria-labelledby="attachments-title"
        data-closing={closing || undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="attachments-head">
          <h2 id="attachments-title">Attachments</h2>
          {scan && scan.images.length > 0 && (
            <Segmented
              label="Show"
              value={filter}
              onChange={setFilter}
              options={[
                ["all", <>All <span className="count">{scan.images.length}</span></>],
                ["unused", <>Unused <span className="count">{unused.length}</span></>],
              ]}
            />
          )}
          <button className="icon-button" onClick={close} aria-label="Close" title="Close">
            <X />
          </button>
        </header>

        {scan && unused.length > 0 && (
          <div className="attachments-cleanup">
            <span>
              {unused.length === 1 ? "1 image isn’t" : `${unused.length} images aren’t`} used in any note ({formatBytes(unusedBytes)}).
            </span>
            <button className="button danger" onClick={() => void cleanUp()}>
              Clean up unused…
            </button>
          </div>
        )}

        <div className="attachments-body">
          {error ? (
            <div className="attachments-empty">
              <p>Couldn’t look through the vault: {error}</p>
              <button className="button" onClick={() => setScanCount((n) => n + 1)}>
                Try again
              </button>
            </div>
          ) : !scan ? (
            <div className="attachments-empty">Looking through your notes…</div>
          ) : scan.images.length === 0 ? (
            <div className="attachments-empty">
              <Image size={28} />
              <p>No images in this vault yet. Paste or drop one into a note.</p>
            </div>
          ) : shown.length === 0 ? (
            <div className="attachments-empty">Every image is used in a note.</div>
          ) : (
            <ul className="attachments-grid">
              {shown.map((img) => {
                const uses = scan.usage.get(img.path) ?? [];
                const notes = [...new Map(uses.map((u) => [u.notePath, u])).values()];
                return (
                  <li key={img.path} className="attachment" data-unused={uses.length === 0 || undefined}>
                    <div className="attachment-thumb">
                      <img src={backend?.assetUrl(img.path)} alt="" loading="lazy" draggable={false} />
                    </div>
                    <div className="attachment-info">
                      <div className="attachment-name" title={img.path}>
                        {basename(img.path)}
                      </div>
                      <div className="attachment-meta">
                        {formatBytes(img.size)}
                        {img.modified ? ` · ${dateFormat.format(img.modified)}` : ""}
                      </div>
                      <div className="attachment-uses">
                        {notes.length === 0 ? (
                          <span className="attachment-unused">Not used in any note</span>
                        ) : (
                          <>
                            In{" "}
                            {notes.slice(0, USES_SHOWN).map((u, i) => (
                              <span key={u.notePath}>
                                {i > 0 && ", "}
                                <button className="attachment-note" onClick={() => openUse(u)} title={`Open ${stripExtension(basename(u.notePath))}`}>
                                  {stripExtension(basename(u.notePath))}
                                </button>
                              </span>
                            ))}
                            {notes.length > USES_SHOWN && ` and ${notes.length - USES_SHOWN} more`}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="attachment-actions">
                      {revealable && (
                        <button
                          className="icon-button small"
                          onClick={() => void useStore.getState().revealPath(img.path)}
                          aria-label={`${fileManagerLabel()}: ${basename(img.path)}`}
                          title={fileManagerLabel()}
                        >
                          <FolderOpen size={14} />
                        </button>
                      )}
                      <button
                        className="icon-button small danger"
                        onClick={() => void trashOne(img.path, uses)}
                        aria-label={`Move ${basename(img.path)} to the trash`}
                        title="Move to Trash"
                      >
                        <Trash size={14} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
