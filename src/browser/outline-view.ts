export interface OutlineParagraph {
  start: number;
  end: number;
  text: string;
  safe: boolean;
}

export interface OutlineHeading {
  start: number;
  end: number;
  text: string;
  title: string;
  level: number;
}

interface OutlineState {
  headings: readonly OutlineHeading[];
  paragraphs: readonly OutlineParagraph[];
  selected: number;
  unavailable: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readOutlineHeadings(value: unknown, source: string): OutlineHeading[] {
  if (!Array.isArray(value)) throw new Error("Invalid service response.");
  return value.map((entry: unknown) => {
    if (!isRecord(entry)) throw new Error("Invalid service response.");
    const data = entry;
    const { start, end, level, text } = data;
    if (
      typeof start !== "number" ||
      !Number.isSafeInteger(start) ||
      start < 0 ||
      typeof end !== "number" ||
      !Number.isSafeInteger(end) ||
      end <= start ||
      end > source.length ||
      typeof level !== "number" ||
      !Number.isSafeInteger(level) ||
      level < 1 ||
      level > 6 ||
      typeof text !== "string" ||
      source.slice(start, end) !== text ||
      (data.title !== undefined && typeof data.title !== "string")
    )
      throw new Error("Invalid heading range in service response.");
    return { start, end, level, text, title: data.title ?? text };
  });
}

export function createFeedbackView(elements: {
  selection: HTMLElement;
  purpose: HTMLElement;
  tips: HTMLElement;
  showSource: HTMLElement;
  language: HTMLElement;
  clarity: HTMLElement;
}) {
  return (state: {
    index: number;
    paragraph: OutlineParagraph | undefined;
    purpose: string | null;
    tips: readonly string[];
    unavailable: boolean;
  }): void => {
    elements.selection.textContent = state.paragraph ? `Paragraph ${state.index + 1}` : "";
    elements.purpose.textContent =
      state.purpose ?? (state.paragraph ? "No current purpose available." : "Select a paragraph to see its purpose.");
    elements.tips.replaceChildren(
      ...state.tips.map((tip) => {
        const item = document.createElement("li");
        item.textContent = tip;
        return item;
      }),
    );
    const disabled = !state.paragraph?.safe || state.unavailable;
    elements.showSource.toggleAttribute("disabled", !state.paragraph || state.unavailable);
    elements.language.toggleAttribute("disabled", disabled);
    elements.clarity.toggleAttribute("disabled", disabled);
  };
}

/** Render source structure without owning the selected target or reading position. */
export function createOutlineView(options: {
  root: HTMLElement;
  follow: HTMLInputElement;
  showCurrent: HTMLElement;
  selectParagraph(index: number): void;
  navigateHeading(heading: OutlineHeading): void;
}) {
  let paragraphButtons: HTMLButtonElement[] = [];
  let visibleIndex: number | null = null;
  let currentButton: HTMLButtonElement | null = null;
  let key = "";

  function revealCurrent(): void {
    if (!currentButton) return;
    const container = options.root.getBoundingClientRect();
    const item = currentButton.getBoundingClientRect();
    if (item.top < container.top) options.root.scrollTop += item.top - container.top;
    else if (item.bottom > container.bottom) options.root.scrollTop += item.bottom - container.bottom;
  }

  function setVisible(index: number | null): void {
    visibleIndex = index;
    const button = index === null ? null : (paragraphButtons[index] ?? null);
    if (button === currentButton) return;
    currentButton?.removeAttribute("aria-current");
    currentButton = button;
    currentButton?.setAttribute("aria-current", "location");
    if (options.follow.checked) revealCurrent();
  }

  options.showCurrent.addEventListener("click", revealCurrent);

  function render(state: OutlineState): void {
    const nextKey = JSON.stringify(state);
    if (nextKey === key) return;
    key = nextKey;
    currentButton?.removeAttribute("aria-current");
    currentButton = null;
    paragraphButtons = [];
    const list = document.createElement("ol");
    list.className = "outline-tree";
    const stack: { level: number; children: HTMLOListElement }[] = [];
    const entries = [
      ...state.headings.map((heading) => ({ kind: "heading" as const, start: heading.start, heading })),
      ...state.paragraphs.map((paragraph, index) => ({ kind: "paragraph" as const, start: paragraph.start, paragraph, index })),
    ].sort((left, right) => left.start - right.start || (left.kind === "heading" ? -1 : 1));

    for (const entry of entries) {
      if (entry.kind === "heading") {
        while (stack.length && (stack.at(-1)?.level ?? 0) >= entry.heading.level) stack.pop();
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "outline-heading";
        button.textContent = entry.heading.title || "Untitled section";
        button.disabled = state.unavailable;
        button.addEventListener("click", () => options.navigateHeading(entry.heading));
        const children = document.createElement("ol");
        children.className = "outline-tree";
        item.append(button, children);
        (stack.at(-1)?.children ?? list).append(item);
        stack.push({ level: entry.heading.level, children });
      } else {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "outline-item";
        button.disabled = state.unavailable;
        button.setAttribute("aria-pressed", String(entry.index === state.selected));
        const label = document.createElement("span");
        label.className = "outline-label";
        label.textContent = `Paragraph ${entry.index + 1}`;
        const summary = document.createElement("span");
        summary.className = "outline-summary";
        summary.textContent = entry.paragraph.safe ? entry.paragraph.text.slice(0, 100) : "Unsupported syntax";
        button.append(label, summary);
        button.addEventListener("click", () => options.selectParagraph(entry.index));
        paragraphButtons[entry.index] = button;
        item.append(button);
        (stack.at(-1)?.children ?? list).append(item);
      }
    }
    options.root.replaceChildren(list);
    setVisible(visibleIndex);
  }

  return { render, setVisible };
}
