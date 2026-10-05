/** Returns a bounded row index for navigation keys, without reading the DOM. */
export function nextRowIndex(key: string, current: number, count: number, pageSize: number): number | null {
  if (count <= 0) return null;

  const last = count - 1;
  const index = Math.max(0, Math.min(current, last));
  const page = Math.max(1, Math.floor(pageSize));

  switch (key) {
    case 'ArrowUp': return Math.max(0, index - 1);
    case 'ArrowDown': return Math.min(last, index + 1);
    case 'Home': return 0;
    case 'End': return last;
    case 'PageUp': return Math.max(0, index - page);
    case 'PageDown': return Math.min(last, index + page);
    default: return null;
  }
}

/** Focus a list item or its control, then reveal the item with its scroll margin. */
export function focusListItem(
  container: HTMLElement | null | undefined,
  dataAttribute: 'data-track-id' | 'data-entry-id',
  id: string,
  descendantSelector?: string,
): HTMLElement | null {
  const item = container?.querySelector<HTMLElement>('[' + dataAttribute + '="' + CSS.escape(id) + '"]');
  const target = descendantSelector ? item?.querySelector<HTMLElement>(descendantSelector) : item;
  if (!item || !target) return null;
  target.focus({ preventScroll: true });
  item.scrollIntoView({ block: 'nearest' });
  return target;
}
