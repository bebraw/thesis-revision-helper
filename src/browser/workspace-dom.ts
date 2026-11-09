export function element(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing workspace element: ${id}`);
  return node;
}

export function input(id: string): HTMLInputElement {
  const node = element(id);
  if (!(node instanceof HTMLInputElement)) throw new Error(`Invalid workspace input: ${id}`);
  return node;
}

export function editor(id: string): HTMLTextAreaElement {
  const node = element(id);
  if (!(node instanceof HTMLTextAreaElement)) throw new Error(`Invalid workspace editor: ${id}`);
  return node;
}
