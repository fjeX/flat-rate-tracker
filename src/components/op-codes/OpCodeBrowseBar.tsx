"use client";

import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/Input";
import {
  SORT_CHIPS,
  type OpCodeSortKind,
  type SortDir,
} from "./useOpCodeBrowsing";
import { tagHueVar } from "./tagHue";
import type { OpCodeLabelMode } from "./useOpCodeLabelMode";

/**
 * The library's controls (phase 5 sketch): the search well, the sort as a
 * segmented control, and the tag filters as toggling outline chips with a
 * category tick. Shared by the signed-in view and the guest mirror.
 */
export function OpCodeBrowseBar({
  search,
  onSearch,
  sortBy,
  sortDir,
  onSortClick,
  allTags,
  selectedTags,
  onToggleTag,
  onClearTags,
  tagColors,
  showManualSort = true,
  labelMode,
  onLabelMode,
}: {
  search: string;
  onSearch: (value: string) => void;
  sortBy: OpCodeSortKind;
  sortDir: SortDir;
  onSortClick: (kind: OpCodeSortKind) => void;
  allTags: string[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
  /** Per-tag colour overrides (settings.tagColors) for the chip ticks. */
  tagColors?: Record<string, number>;
  // Guest demo has no drag order, so it can hide the "My order" option.
  showManualSort?: boolean;
  /** Which field leads each row; the toggle only renders when both are passed. */
  labelMode: OpCodeLabelMode;
  onLabelMode: (mode: OpCodeLabelMode) => void;
}) {
  const sortChips = SORT_CHIPS.filter(
    (c) => showManualSort || c.kind !== "manual",
  );
  const selectedSet = new Set(selectedTags.map((t) => t.toLowerCase()));

  return (
    <div className="opl-ctl">
      <label className="search-well">
        <span className="sr-only">Search code, description, or tag</span>
        <Search aria-hidden="true" />
        <Input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search code, description, or tag"
          aria-label="Search code, description, or tag"
        />
        {search && (
          <button
            type="button"
            className="search-clear"
            onClick={() => onSearch("")}
            aria-label="Clear search"
          >
            <X size={18} />
          </button>
        )}
      </label>

      <div className="opl-ctl-row">
        <span className="opl-ctl-k">Sort</span>
        <div className="seg" role="group" aria-label="Sort by">
          {sortChips.map((chip) => {
            const active = sortBy === chip.kind;
            // "My order" has no direction; the others carry the arrow.
            const dir = active && chip.kind !== "manual" ? (sortDir === "desc" ? "↓" : "↑") : null;
            return (
              <button
                key={chip.kind}
                type="button"
                aria-pressed={active}
                onClick={() => onSortClick(chip.kind)}
                aria-label={`Sort by ${chip.label}${dir ? `, ${sortDir === "desc" ? "descending" : "ascending"}` : ""}`}
              >
                {chip.label}
                {dir && <span className="dir" aria-hidden="true">{dir}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="opl-ctl-row">
        <span className="opl-ctl-k">Show</span>
        <div className="seg opl-lead" role="group" aria-label="Lead with">
          {(["code", "description"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={labelMode === m}
              onClick={() => onLabelMode(m)}
            >
              {m === "code" ? "Code" : "Description"}
            </button>
          ))}
        </div>
      </div>

      {allTags.length > 0 && (
        <div className="opl-ctl-row">
          <span className="opl-ctl-k">Tags</span>
          <div className="fchips" role="group" aria-label="Filter by tag">
            {allTags.map((tag) => {
              const active = selectedSet.has(tag.toLowerCase());
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onToggleTag(tag)}
                  aria-pressed={active}
                  className="fchip"
                >
                  <span
                    className="hue"
                    aria-hidden="true"
                    style={{ "--tagc": tagHueVar(tag, tagColors) } as React.CSSProperties}
                  />
                  {tag}
                </button>
              );
            })}
            {selectedTags.length > 0 && (
              <button type="button" onClick={onClearTags} className="btn btn-quiet btn-sm">
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
