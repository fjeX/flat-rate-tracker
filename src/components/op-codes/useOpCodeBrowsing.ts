"use client";

import { useMemo, useState } from "react";
import type { OpCode } from "@/lib/types";

// Sort fields for the op code library.
// "manual" = the user's hand-arranged drag order (the stored sort_order);
// it has no direction toggle.
export type OpCodeSortKind = "manual" | "code" | "hours" | "recent";
export type SortDir = "asc" | "desc";

// Mirrors the History page's "Sort By:" chip row.
export const SORT_CHIPS: { kind: OpCodeSortKind; label: string }[] = [
  { kind: "manual", label: "My order" },
  { kind: "code", label: "Code" },
  { kind: "hours", label: "Hours" },
  { kind: "recent", label: "Added" },
];

// Sensible starting direction the first time a field is picked.
function defaultDir(kind: OpCodeSortKind): SortDir {
  return kind === "code" ? "asc" : "desc"; // code A→Z; hours/added high/newest first
}

// Shared search + sort + tag-filter logic for the op code library.
// Both the authed view and the guest demo run through this so they behave
// identically. The caller owns the source `items`; this hook only derives
// what's visible plus the UI state to drive the browse bar.
export function useOpCodeBrowsing(items: OpCode[]) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<OpCodeSortKind>("manual");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Tapping a chip: same field flips direction, new field resets to its
  // default. "My order" has no direction, so re-tapping it is a no-op.
  function handleSortClick(kind: OpCodeSortKind) {
    if (kind === sortBy) {
      if (kind === "manual") return;
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(kind);
      setSortDir(defaultDir(kind));
    }
  }

  // Every distinct tag in the library, de-duped case-insensitively
  // (keeping first-seen casing) and alphabetized for the chip row.
  const allTags = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const op of items) {
      for (const tag of op.tags) {
        const key = tag.toLowerCase();
        if (!byKey.has(key)) byKey.set(key, tag);
      }
    }
    return [...byKey.values()].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [items]);

  function toggleTag(tag: string) {
    setSelectedTags((curr) =>
      curr.some((t) => t.toLowerCase() === tag.toLowerCase())
        ? curr.filter((t) => t.toLowerCase() !== tag.toLowerCase())
        : [...curr, tag],
    );
  }

  function clearTags() {
    setSelectedTags([]);
  }

  const isSearching = search.trim() !== "";
  const isFiltering = selectedTags.length > 0;

  const visible = useMemo(() => {
    let list = items;

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (op) =>
          op.code.toLowerCase().includes(q) ||
          op.description.toLowerCase().includes(q) ||
          op.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    // Tag filter is a union (OR): show op codes carrying ANY selected tag.
    if (selectedTags.length > 0) {
      const sel = new Set(selectedTags.map((t) => t.toLowerCase()));
      list = list.filter((op) => op.tags.some((t) => sel.has(t.toLowerCase())));
    }

    if (sortBy !== "manual") {
      const dir = sortDir === "desc" ? -1 : 1;
      list = [...list].sort((a, b) => {
        let cmp = 0;
        if (sortBy === "code") {
          cmp = a.code.localeCompare(b.code, undefined, {
            numeric: true,
            sensitivity: "base",
          });
        } else if (sortBy === "hours") {
          cmp = a.flagHours - b.flagHours;
        } else if (sortBy === "recent") {
          // createdAt is an ISO string (empty for seed data).
          cmp = a.createdAt.localeCompare(b.createdAt);
        }
        return dir * cmp;
      });
    }

    return list;
  }, [items, search, selectedTags, sortBy, sortDir]);

  // Drag-to-reorder only makes sense in the untouched manual view — once the
  // list is searched, filtered, or sorted some other way, the on-screen order
  // no longer maps to sort_order, so we lock dragging (same idea the search
  // box already used).
  const canReorder = sortBy === "manual" && !isSearching && !isFiltering;

  return {
    search,
    setSearch,
    sortBy,
    sortDir,
    handleSortClick,
    selectedTags,
    toggleTag,
    clearTags,
    allTags,
    visible,
    isSearching,
    isFiltering,
    canReorder,
  };
}
