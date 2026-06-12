// Card art is served by the Limitless TCG CDN, derivable from the card id
// (e.g. "a1-001" -> pocket/A1/A1_001_EN.webp).  An <img> onerror falls back to
// the card name, so an occasional missing/renamed image degrades gracefully.

export function cardImageUrl(id: string): string | null {
  // Set code is everything before the final "-<number>"; promos keep an inner
  // dash ("p-a-001" -> set "P-A", num "001").
  const m = /^(.+)-(\d+)$/.exec(id);
  if (!m) return null;
  const set = m[1]!.toUpperCase();
  const num = m[2]!.padStart(3, '0');
  return `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/pocket/${set}/${set}_${num}_EN.webp`;
}
