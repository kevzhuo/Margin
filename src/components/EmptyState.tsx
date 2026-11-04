import { useStore } from "../state/store";
import { FolderOpen, Plus } from "./icons";

export function EmptyState() {
  const vaultRoot = useStore((s) => s.vaultRoot);
  const openVault = useStore((s) => s.openVault);
  const createNote = useStore((s) => s.createNote);
  return (
    <div className="empty-state">
      {vaultRoot ? (
        <>
          <h2>No note open</h2>
          <p>Pick a note in the sidebar, or create one.</p>
          <button className="primary-button" onClick={() => void createNote()}>
            <Plus /> New note
          </button>
        </>
      ) : (
        <>
          <h2>Open a vault</h2>
          <p>A vault is a folder of Markdown files. Margin edits them in place and never copies them anywhere.</p>
          <button className="primary-button" onClick={() => void openVault()}>
            <FolderOpen /> Open folder
          </button>
        </>
      )}
    </div>
  );
}
