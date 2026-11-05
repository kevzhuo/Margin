import appIcon from "../../src-tauri/icons/128x128@2x.png";
import { basename, dirname } from "../backend";
import { useStore } from "../state/store";
import { Folder, FolderOpen, FolderPlus, Plus, X } from "./icons";

/** What fills the editor area when no note is open. */
export function EmptyState() {
  const vaultRoot = useStore((s) => s.vaultRoot);
  return vaultRoot ? <NoNoteOpen /> : <Welcome />;
}

function NoNoteOpen() {
  const createNote = useStore((s) => s.createNote);
  return (
    <div className="empty-state">
      <h2>No note open</h2>
      <p>Pick a note in the sidebar, or create one.</p>
      <button className="primary-button" onClick={() => void createNote()}>
        <Plus /> New note
      </button>
    </div>
  );
}

/** A home folder shown as "~", so recent vaults read like Finder paths. */
export function tildify(path: string): string {
  return path.replace(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=[\\/]|$)/, "~");
}

function Welcome() {
  const recentVaults = useStore((s) => s.recentVaults);
  const openVault = useStore((s) => s.openVault);
  const openRecentVault = useStore((s) => s.openRecentVault);
  const createVault = useStore((s) => s.createVault);
  const forgetVault = useStore((s) => s.forgetVault);
  return (
    <div className="empty-state welcome">
      <img className="welcome-icon" src={appIcon} alt="" width={88} height={88} draggable={false} />
      <h1>Margin</h1>
      <p>Your notes are plain Markdown files in a folder you choose. Margin edits them in place and never copies them anywhere.</p>
      <div className="welcome-actions">
        <button className="primary-button" onClick={() => void openVault()}>
          <FolderOpen /> Open folder…
        </button>
        <button className="secondary-button" onClick={() => void createVault()}>
          <FolderPlus /> Create a vault…
        </button>
      </div>
      {recentVaults.length > 0 && (
        <section className="welcome-recent" aria-label="Recent vaults">
          <h2>Recent</h2>
          <ul>
            {recentVaults.map((path) => (
              <li key={path}>
                <button className="welcome-vault" onClick={() => void openRecentVault(path)} title={path}>
                  <Folder />
                  <span className="welcome-vault-name">{basename(path) || path}</span>
                  <span className="welcome-vault-path">{tildify(dirname(path))}</span>
                </button>
                <button
                  className="icon-button small welcome-forget"
                  onClick={() => forgetVault(path)}
                  aria-label={`Remove ${basename(path) || path} from recent vaults`}
                  title="Remove from list"
                >
                  <X />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
