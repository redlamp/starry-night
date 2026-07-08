// Writing-lab UI persistence: sidebar expand/collapse, the selected pool, and
// column widths. Kept in its own localStorage key — separate from
// labStore.ts's content overrides/metadata — because this is presentation
// state the ship-it export (exportLabStateAsJson) has no business seeing.

export type LabUiColumnWidths = {
  author: number;
  status: number;
};

export type LabUiState = {
  // Keyed by group name ("Story"), or "<group>::Hooks" for the nested Story
  // subsection. A key absent from the map reads as COLLAPSED (user
  // 2026-07-08) — the sidebar toolbar's Expand All opens everything.
  expandedGroups: Record<string, boolean>;
  selectedPoolId: string | null;
  columnWidths: LabUiColumnWidths;
  // Pools column width — draggable via the divider (user 2026-07-08).
  sidebarWidth: number;
};

const KEY = "starry-night.writing-lab.ui.v1";

export const DEFAULT_COLUMN_WIDTHS: LabUiColumnWidths = { author: 112, status: 120 };

export const DEFAULT_SIDEBAR_WIDTH = 256;

export const DEFAULT_UI_STATE: LabUiState = {
  expandedGroups: {},
  selectedPoolId: null,
  columnWidths: DEFAULT_COLUMN_WIDTHS,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
};

export function loadLabUiState(): LabUiState {
  if (typeof window === "undefined") return DEFAULT_UI_STATE;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_UI_STATE;
    const parsed = JSON.parse(raw) as Partial<LabUiState>;
    return {
      expandedGroups: parsed.expandedGroups ?? {},
      selectedPoolId: parsed.selectedPoolId ?? null,
      columnWidths: { ...DEFAULT_COLUMN_WIDTHS, ...parsed.columnWidths },
      sidebarWidth: parsed.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH,
    };
  } catch {
    return DEFAULT_UI_STATE;
  }
}

export function saveLabUiState(state: LabUiState): void {
  window.localStorage.setItem(KEY, JSON.stringify(state));
}

export function isGroupExpanded(state: LabUiState, key: string): boolean {
  return state.expandedGroups[key] ?? false;
}

export function setGroupExpanded(state: LabUiState, key: string, open: boolean): LabUiState {
  return { ...state, expandedGroups: { ...state.expandedGroups, [key]: open } };
}

export function setSelectedPoolId(state: LabUiState, poolId: string): LabUiState {
  return { ...state, selectedPoolId: poolId };
}

const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 320;
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 440;

export function resizeSidebar(state: LabUiState, deltaPx: number): LabUiState {
  const next = Math.min(
    MAX_SIDEBAR_WIDTH,
    Math.max(MIN_SIDEBAR_WIDTH, state.sidebarWidth + deltaPx),
  );
  return { ...state, sidebarWidth: next };
}

export function resizeColumn(
  state: LabUiState,
  column: keyof LabUiColumnWidths,
  deltaPx: number,
): LabUiState {
  const next = Math.min(
    MAX_COLUMN_WIDTH,
    Math.max(MIN_COLUMN_WIDTH, state.columnWidths[column] + deltaPx),
  );
  return { ...state, columnWidths: { ...state.columnWidths, [column]: next } };
}
