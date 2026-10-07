export interface RowSelection {
  readonly ids: ReadonlySet<string>;
  readonly anchor: string | null;
}

export type RowSelectionAction =
  | { type: 'replace' | 'toggle' | 'range' | 'collapse'; id: string }
  | { type: 'all' }
  | { type: 'reset' };

/** Pure reducer. IDs identify rows; playlist entries may share a track ID. */
export function selectRows(state: RowSelection, visibleIds: readonly string[], action: RowSelectionAction): RowSelection {
  const visible = new Set(visibleIds);
  const ids = new Set([...state.ids].filter((id) => visible.has(id)));
  const anchor = state.anchor && visible.has(state.anchor) ? state.anchor : null;
  if (action.type === 'reset') return { ids: new Set(), anchor: null };
  if (action.type === 'all') return { ids: visible, anchor: anchor ?? visibleIds[0] ?? null };
  if (!visible.has(action.id)) return { ids, anchor };
  if (action.type === 'toggle') {
    if (ids.has(action.id) && ids.size > 1) ids.delete(action.id);
    else ids.add(action.id);
    return { ids, anchor: action.id };
  }
  if (action.type === 'range') {
    const start = visibleIds.indexOf(anchor ?? action.id);
    const end = visibleIds.indexOf(action.id);
    return {
      ids: new Set(visibleIds.slice(Math.min(start, end), Math.max(start, end) + 1)),
      anchor: anchor ?? action.id,
    };
  }
  return { ids: new Set([action.id]), anchor: action.id };
}

/** Project onto visible rows, falling back to the active row when none survive. */
export function visibleRowSelection(state: RowSelection, visibleIds: readonly string[], activeId: string | null): RowSelection {
  const visible = new Set(visibleIds);
  const ids = new Set([...state.ids].filter((id) => visible.has(id)));
  const fallback = activeId && visible.has(activeId) ? activeId : visibleIds[0];
  const anchor = state.anchor && visible.has(state.anchor) ? state.anchor : null;
  return ids.size || !fallback ? { ids, anchor } : { ids: new Set([fallback]), anchor: anchor ?? fallback };
}
