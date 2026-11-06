/** Choose the paragraph containing the top of the viewport, including the last at the bottom. */
export function paragraphAtScroll(
  positions: readonly number[],
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): number | null {
  if (positions.length === 0) return null;
  const maxScroll = Math.max(0, scrollHeight - clientHeight);
  const top = Math.max(0, Math.min(scrollTop, maxScroll));
  if (maxScroll > 0 && maxScroll - top <= 1) return positions.length - 1;
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((positions[middle] ?? 0) <= top) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

type Paragraph = { start: number; end: number };

/** Track visible source without changing the editor's caret or revision selection. */
export function createScrollSync(
  source: HTMLTextAreaElement,
  onVisible: (index: number | null) => void,
): {
  update(text: string, paragraphs: readonly Paragraph[]): void;
  clear(): void;
  destroy(): void;
} {
  const mirror = document.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  Object.assign(mirror.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    height: "auto",
    overflow: "hidden",
    visibility: "hidden",
    pointerEvents: "none",
    border: "0",
    margin: "0",
    boxSizing: "border-box",
  });
  document.body.append(mirror);
  let text = "";
  let paragraphs: readonly Paragraph[] = [];
  let positions: number[] = [];
  let dirty = false;
  let frame: number | null = null;
  let previous: number | null | undefined;
  let destroyed = false;

  function emit(index: number | null): void {
    if (previous !== index) {
      previous = index;
      onVisible(index);
    }
  }

  function measure(): void {
    const style = getComputedStyle(source);
    const properties = [
      "font-family",
      "font-size",
      "font-style",
      "font-weight",
      "font-stretch",
      "font-variant",
      "font-kerning",
      "font-feature-settings",
      "font-variation-settings",
      "line-height",
      "letter-spacing",
      "word-spacing",
      "text-indent",
      "text-transform",
      "text-align",
      "text-rendering",
      "white-space",
      "word-break",
      "overflow-wrap",
      "tab-size",
      "direction",
      "unicode-bidi",
      "padding-top",
      "padding-right",
      "padding-bottom",
      "padding-left",
    ];
    for (const property of properties) mirror.style.setProperty(property, style.getPropertyValue(property));
    mirror.style.width = `${source.clientWidth}px`;
    const fragment = document.createDocumentFragment();
    const markers: HTMLSpanElement[] = [];
    let cursor = 0;
    for (const paragraph of paragraphs) {
      fragment.append(document.createTextNode(text.slice(cursor, paragraph.start)));
      const marker = document.createElement("span");
      // Keep surrogate pairs together, so the browser wraps the original characters.
      const first = text.codePointAt(paragraph.start);
      const length = first !== undefined && first > 0xffff ? 2 : first === undefined ? 0 : 1;
      marker.textContent = text.slice(paragraph.start, paragraph.start + length);
      fragment.append(marker);
      markers.push(marker);
      cursor = paragraph.start + length;
    }
    fragment.append(document.createTextNode(text.slice(cursor)));
    mirror.replaceChildren(fragment);
    const mirrorTop = mirror.getBoundingClientRect().top;
    positions = markers.map((marker) => marker.getBoundingClientRect().top - mirrorTop);
    dirty = false;
  }

  function refresh(): void {
    frame = null;
    if (destroyed) return;
    if (paragraphs.length === 0) {
      emit(null);
      return;
    }
    // Hidden editors have no layout; defer the first measurement until they are visible.
    if (source.clientWidth === 0 || source.clientHeight === 0) return;
    if (dirty) measure();
    emit(paragraphAtScroll(positions, source.scrollTop, source.clientHeight, source.scrollHeight));
  }

  function schedule(): void {
    if (frame === null && !destroyed) frame = requestAnimationFrame(refresh);
  }
  function resized(): void {
    dirty = true;
    schedule();
  }
  source.addEventListener("scroll", schedule, { passive: true });
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resized);
  if (observer) observer.observe(source);
  else window.addEventListener("resize", resized);

  return {
    update(nextText, nextParagraphs) {
      const valid = nextParagraphs.every(
        (paragraph, index) =>
          Number.isInteger(paragraph.start) &&
          Number.isInteger(paragraph.end) &&
          paragraph.start >= 0 &&
          paragraph.start < paragraph.end &&
          paragraph.end <= nextText.length &&
          (index === 0 || paragraph.start >= (nextParagraphs[index - 1]?.end ?? 0)),
      );
      if (!valid) {
        this.clear();
        return;
      }
      if (
        text === nextText &&
        paragraphs.length === nextParagraphs.length &&
        paragraphs.every(
          (paragraph, index) => paragraph.start === nextParagraphs[index]?.start && paragraph.end === nextParagraphs[index]?.end,
        )
      )
        return;
      text = nextText;
      paragraphs = nextParagraphs.map(({ start, end }) => ({ start, end }));
      dirty = true;
      schedule();
    },
    clear() {
      text = "";
      paragraphs = [];
      positions = [];
      mirror.replaceChildren();
      emit(null);
    },
    destroy() {
      destroyed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      source.removeEventListener("scroll", schedule);
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", resized);
      mirror.remove();
    },
  };
}
