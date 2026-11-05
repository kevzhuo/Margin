import { EditorView, type Panel, type ViewUpdate } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  gotoLine,
  replaceAll,
  replaceNext,
  search,
  searchKeymap,
  setSearchQuery,
} from "@codemirror/search";

/** Counting stops here, so a huge note with a common word stays fast. */
const COUNT_LIMIT = 1000;

const icon = (path: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

const ICONS = {
  search: icon('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  up: icon('<path d="M6 15l6-6 6 6"/>'),
  down: icon('<path d="M6 9l6 6 6-6"/>'),
  close: icon('<path d="M6 6l12 12M18 6L6 18"/>'),
  expand: icon('<path d="M9 6l6 6-6 6"/>'),
};

/**
 * How many matches there are, and which one is selected (1-based, 0 when the
 * selection isn't on a match). Null for an empty or invalid query.
 */
export function countMatches(state: EditorState, query: SearchQuery, limit = COUNT_LIMIT): { total: number; current: number; capped: boolean } | null {
  if (!query.search || !query.valid) return null;
  const { from, to } = state.selection.main;
  const cursor = query.getCursor(state) as Iterator<{ from: number; to: number }>;
  let total = 0;
  let current = 0;
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    total++;
    if (next.value.from === from && next.value.to === to) current = total;
    if (total >= limit) return { total, current, capped: true };
  }
  return { total, current, capped: false };
}

/** The text shown beside the search field. */
export function countLabel(count: ReturnType<typeof countMatches>, query: SearchQuery): string {
  if (!query.search) return "";
  if (!query.valid) return "Invalid pattern";
  if (!count || count.total === 0) return "No results";
  const total = count.capped ? `${count.total}+` : String(count.total);
  return count.current ? `${count.current} of ${total}` : `${total} ${count.total === 1 ? "result" : "results"}`;
}

function button(className: string, label: string, html: string, run: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.title = label;
  b.setAttribute("aria-label", label);
  b.innerHTML = html;
  // Keep focus in the fields; act on click.
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", run);
  return b;
}

/**
 * The find bar: a compact card floating at the top right of the note, in
 * place of CodeMirror's default form. Enter and Shift+Enter step through
 * matches, Escape closes, and the chevron reveals replace.
 */
class FindPanel implements Panel {
  readonly dom: HTMLElement;
  readonly top = true;
  private query: SearchQuery;
  private readonly searchField: HTMLInputElement;
  private readonly replaceField: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly toggles: Record<"caseSensitive" | "regexp" | "wholeWord", HTMLButtonElement>;
  private readonly expand: HTMLButtonElement;
  private countFrame = 0;

  constructor(private readonly view: EditorView) {
    this.query = getSearchQuery(view.state);
    this.dom = document.createElement("div");
    this.dom.className = "cm-find";
    this.dom.setAttribute("role", "search");

    const field = (placeholder: string, label: string) => {
      const input = document.createElement("input");
      input.className = "cm-find-field";
      input.placeholder = placeholder;
      input.setAttribute("aria-label", label);
      input.spellcheck = false;
      input.addEventListener("input", () => this.commit());
      return input;
    };
    this.searchField = field("Find", "Find");
    this.searchField.setAttribute("main-field", "true");
    this.searchField.value = this.query.search;
    this.searchField.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        (e.shiftKey ? findPrevious : findNext)(view);
      }
    });
    this.replaceField = field("Replace", "Replace with");
    this.replaceField.value = this.query.replace;
    this.replaceField.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        (e.metaKey || e.ctrlKey ? replaceAll : replaceNext)(view);
      }
    });
    this.dom.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeSearchPanel(view);
        view.focus();
      }
    });

    this.count = document.createElement("span");
    this.count.className = "cm-find-count";
    this.count.setAttribute("aria-live", "polite");

    const toggle = (key: "caseSensitive" | "regexp" | "wholeWord", label: string, text: string) => {
      const b = button("cm-find-toggle", label, text, () => {
        b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
        this.commit();
      });
      b.setAttribute("aria-pressed", String(this.query[key]));
      return b;
    };
    this.toggles = {
      caseSensitive: toggle("caseSensitive", "Match case", "Aa"),
      wholeWord: toggle("wholeWord", "Whole words", '<span class="cm-find-word">ab</span>'),
      regexp: toggle("regexp", "Regular expression", ".*"),
    };

    this.expand = button("cm-find-expand", "Show replace", ICONS.expand, () => this.setReplacing(!this.dom.classList.contains("replacing")));

    const searchRow = document.createElement("div");
    searchRow.className = "cm-find-row";
    const searchBox = document.createElement("label");
    searchBox.className = "cm-find-box";
    searchBox.innerHTML = ICONS.search;
    searchBox.append(this.searchField, this.count);
    searchRow.append(
      searchBox,
      this.toggles.caseSensitive,
      this.toggles.wholeWord,
      this.toggles.regexp,
      button("cm-find-icon", "Previous match (Shift+Enter)", ICONS.up, () => findPrevious(view)),
      button("cm-find-icon", "Next match (Enter)", ICONS.down, () => findNext(view)),
      button("cm-find-icon", "Close (Esc)", ICONS.close, () => {
        closeSearchPanel(view);
        view.focus();
      }),
    );

    const replaceRow = document.createElement("div");
    replaceRow.className = "cm-find-row cm-find-replace";
    const replaceBox = document.createElement("label");
    replaceBox.className = "cm-find-box";
    replaceBox.append(this.replaceField);
    replaceRow.append(
      replaceBox,
      button("cm-find-text", "Replace this match (Enter)", "Replace", () => replaceNext(view)),
      button("cm-find-text", "Replace every match", "All", () => replaceAll(view)),
    );

    const rows = document.createElement("div");
    rows.className = "cm-find-rows";
    rows.append(searchRow, replaceRow);
    this.dom.append(this.expand, rows);
    this.setReplacing(!!this.query.replace);
  }

  mount() {
    this.searchField.focus();
    this.searchField.select();
    this.updateCount();
  }

  update(update: ViewUpdate) {
    for (const tr of update.transactions) {
      for (const effect of tr.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) this.show(effect.value);
      }
    }
    if (update.docChanged || update.selectionSet || update.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQuery)))) {
      this.scheduleCount();
    }
  }

  destroy() {
    cancelAnimationFrame(this.countFrame);
  }

  /** Reflect a query set from elsewhere, such as ⌘F with text selected. */
  private show(query: SearchQuery) {
    this.query = query;
    this.searchField.value = query.search;
    this.replaceField.value = query.replace;
    for (const key of ["caseSensitive", "regexp", "wholeWord"] as const) this.toggles[key].setAttribute("aria-pressed", String(query[key]));
  }

  private commit() {
    const pressed = (key: keyof typeof this.toggles) => this.toggles[key].getAttribute("aria-pressed") === "true";
    const query = new SearchQuery({
      search: this.searchField.value,
      replace: this.replaceField.value,
      caseSensitive: pressed("caseSensitive"),
      regexp: pressed("regexp"),
      wholeWord: pressed("wholeWord"),
    });
    if (query.eq(this.query)) return;
    this.query = query;
    this.view.dispatch({ effects: setSearchQuery.of(query) });
  }

  private setReplacing(on: boolean) {
    this.dom.classList.toggle("replacing", on);
    this.expand.setAttribute("aria-expanded", String(on));
    this.expand.title = on ? "Hide replace" : "Show replace";
  }

  private scheduleCount() {
    cancelAnimationFrame(this.countFrame);
    this.countFrame = requestAnimationFrame(() => this.updateCount());
  }

  private updateCount() {
    const query = this.query;
    const count = countMatches(this.view.state, query);
    this.count.textContent = countLabel(count, query);
    this.searchField.classList.toggle("invalid", !!query.search && !query.valid);
    this.dom.classList.toggle("no-results", count?.total === 0);
  }
}

/**
 * Find and replace. Matches scroll into view with room above them, so the
 * floating bar never covers the one you are on.
 */
export const findAndReplace = search({
  top: true,
  createPanel: (view) => new FindPanel(view),
  scrollToMatch: (range) => EditorView.scrollIntoView(range, { y: "nearest", yMargin: 96 }),
});

/** CodeMirror's search keys (⌘F, ⌘G, ⌘D…) without go-to-line, which would open a second, unstyled form. */
export const findKeymap = searchKeymap.filter((binding) => binding.run !== gotoLine);
