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
