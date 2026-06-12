// Touch-drag plumbing.  Board slots tag themselves with data-side / data-idx, so
// a drop can be resolved from the element under the finger.  The resolution is a
// pure DOM read, kept here (separate from the app side-effects in main.ts) so it
// is unit-testable.

export type SlotTarget = { side: 'mine' | 'opp'; idx: number };

// Resolve the board slot an element belongs to (walking up to the nearest
// `.slot`), or null if the element is not over a slot.
export function slotTargetFromEl(el: Element | null | undefined): SlotTarget | null {
  const slot = el?.closest?.('.slot') as HTMLElement | null | undefined;
  if (!slot) return null;
  const side = slot.getAttribute('data-side');
  const idx = Number(slot.getAttribute('data-idx'));
  if ((side !== 'mine' && side !== 'opp') || Number.isNaN(idx)) return null;
  return { side, idx };
}

// Same, for a viewport point (the finger position on touchend).
export function slotTargetFromPoint(x: number, y: number): SlotTarget | null {
  return slotTargetFromEl(document.elementFromPoint(x, y));
}
