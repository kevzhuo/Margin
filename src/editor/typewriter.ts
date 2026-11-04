import { ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { scrollToPos } from "./scroll";

/**
 * Typewriter mode: keep the caret near the middle of the window while writing.
 * Mouse clicks are left alone so text never jumps out from under the pointer.
 */
export function typewriter(isOn: () => boolean): Extension {
  return ViewPlugin.fromClass(
    class {
      update(u: ViewUpdate) {
        if (!isOn() || !u.view.hasFocus) return;
        if (!u.docChanged && !u.selectionSet) return;
        if (u.transactions.some((tr) => tr.isUserEvent("select.pointer"))) return;
        scrollToPos(u.view, u.state.selection.main.head, { align: "center", smooth: true });
      }
    },
  );
}
