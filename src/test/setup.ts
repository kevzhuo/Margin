/**
 * jsdom does no layout, so a text Range has no geometry. CodeMirror measures
 * text on a timer after an editor is created, which would throw after the
 * test that made the editor has finished. Empty rectangles let it measure.
 */
if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  const noRects = { length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] } as unknown as DOMRectList;
  Range.prototype.getClientRects = () => noRects;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}
