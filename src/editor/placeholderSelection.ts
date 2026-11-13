import { Annotation } from "@codemirror/state";

/**
 * Marks a selection Margin made for you to type over (a new table's first
 * column name, the cell Tab moved to). The formatting toolbar stays away from
 * it; a selection you make yourself shows the toolbar as usual.
 */
export const placeholderSelection = Annotation.define<boolean>();
