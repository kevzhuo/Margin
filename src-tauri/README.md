# Margin desktop shell

The Rust side of Margin is deliberately small: a handful of file-system
commands, a folder watcher, and the window configuration that gives the app
its macOS chrome. Everything the user sees lives in the web frontend.

## Command contract

All commands return `Result<_, String>`; the frontend adapter is
`src/backend/tauri.ts`.

| Command                     | Arguments                       | Returns     | Notes                                                        |
| --------------------------- | ------------------------------- | ----------- | ------------------------------------------------------------ |
| `list_tree`                 | `root`                          | `FileNode[]`| Sets the current vault root. Dirs first, natural order.      |
| `read_note`                 | `path`                          | `string`    |                                                              |
| `write_note`                | `path`, `content`               | –           | Temp file + rename. Suppresses the watcher for 1.5 s.        |
| `create_note`               | `dir`, `name`                   | `string`    | `Name.md`, `Name 2.md`, … Returns the new absolute path.     |
| `rename_path`               | `from`, `to`                    | –           | Refuses to overwrite.                                        |
| `delete_path`               | `path`                          | –           | Moves to the system trash.                                   |
| `watch_vault`               | `root`                          | –           | Starts (or replaces) the recursive watcher.                  |
| `unwatch_vault`             |                                 | –           |                                                              |

The watcher emits `vault://changed` with `{ kind, paths }`, where `kind` is
one of `create`, `modify`, `remove`, `rename`, `any`. Bursts are coalesced
over 200 ms; temp files, hidden entries, `node_modules`, and paths Margin
itself just wrote are filtered out.

Every path argument must resolve inside the current vault root. Anything
else, including `..` segments, is rejected.

## Window configuration

`tauri.conf.json` holds the cross-platform window. `tauri.macos.conf.json`
is merged on macOS and turns on the overlay title bar, inset traffic lights,
a transparent window, and the `sidebar` vibrancy material (which needs
`macOSPrivateApi`). The frontend paints the editor surface opaque and leaves
the sidebar transparent so only that column shows the material.

## Working on it

```bash
npm run tauri dev
```

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

```bash
npm run tauri build
```

Linux needs `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`,
`patchelf`, `build-essential`, `libssl-dev` and `libxdo-dev`.
