"use client";

import {
  SORT_CHIPS,
  type OpCodeSortKind,
  type SortDir,
} from "./useOpCodeBrowsing";
import { tagHueVar } from "./tagHue";

// Reuses the History page's chip styling (.filter-row / .filter-chip) so the
// op code library sorts and filters with the same look and feel.
const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--fg-3)",
  fontWeight: 500,
  alignSelf: "center",
  flexShrink: 0,
};

export function OpCodeBrowseBar({
  sortBy,
  sortDir,
  onSortClick,
  allTags,
  selectedTags,
  onToggleTag,
  onClearTags,
  tagColors,
  showManualSort = true,
}: {
  sortBy: OpCodeSortKind;
  sortDir: SortDir;
  onSortClick: (kind: OpCodeSortKind) => void;
  allTags: string[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
  /** Per-tag colour overrides (settings.tagColors) for the chip dots. */
  tagColors?: Record<string, number>;
  // Guest demo has no drag order, so it can hide the "My order" option.
  showManualSort?: boolean;
}) {
  const sortChips = SORT_CHIPS.filter(
    (c) => showManualSort || c.kind !== "manual",
  );
  const selectedSet = new Set(selectedTags.map((t) => t.toLowerCase()));

  return (
    <>
      {/* Sort chips — mirrors the History page */}
      <div className="filter-row" style={{ marginBottom: 6 }}>
        <span style={labelStyle}>Sort By:</span>
        {sortChips.map((chip) => {
          const active = sortBy === chip.kind;
          // "My order" has no direction; others show the asc/desc arrow.
          const arrow =
            active && chip.kind !== "manual"
              ? sortDir === "desc"
                ? " ↓"
                : " ↑"
              : "";
          return (
            <button
              key={chip.kind}
              type="button"
              onClick={() => onSortClick(chip.kind)}
              className={`filter-chip${active ? " active" : ""}`}
            >
              {chip.label}
              {arrow}
            </button>
          );
        })}
      </div>

      {/* Tag filter chips */}
      {allTags.length > 0 && (
        <div className="filter-row" style={{ marginBottom: 6 }}>
          <span style={labelStyle}>Tags:</span>
          {allTags.map((tag) => {
            const active = selectedSet.has(tag.toLowerCase());
            return (
              <button
                key={tag}
                type="button"
                onClick={() => onToggleTag(tag)}
                aria-pressed={active}
                className={`filter-chip${active ? " active" : ""}`}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: tagHueVar(tag, tagColors),
                    marginRight: 6,
                    verticalAlign: "baseline",
                  }}
                />
                {tag}
              </button>
            );
          })}
          {selectedTags.length > 0 && (
            <button
              type="button"
              onClick={onClearTags}
              className="filter-chip"
              style={{ color: "var(--fg-3)" }}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </>
  );
}
