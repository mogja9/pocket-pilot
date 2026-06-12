// Card art is served by the Limitless TCG CDN, derivable from the card id
// (e.g. "a1-001" -> pocket/A1/A1_001_EN.webp).  An <img> onerror falls back to
// the card name, so an occasional missing/renamed image degrades gracefully.

// Limitless set codes keep a sub-set suffix lowercase ("a4b" -> "A4b", not
// "A4B") and uppercase a promo code whole ("p-a" -> "P-A").  Getting this wrong
// 403s the image, so derive the exact code.
export function setCodeFromId(setLower: string): string {
  if (setLower.includes('-')) return setLower.toUpperCase(); // promo: p-a -> P-A
  const m = /^([a-z]+\d+)([a-z])?$/.exec(setLower);           // a4b -> A4 + b -> A4b
  return m ? m[1]!.toUpperCase() + (m[2] ?? '') : setLower.toUpperCase();
}

export function cardImageUrl(id: string): string | null {
  // Set code is everything before the final "-<number>"; promos keep an inner
  // dash ("p-a-001" -> set "P-A", num "001").
  const m = /^(.+)-(\d+)$/.exec(id);
  if (!m) return null;
  const set = setCodeFromId(m[1]!);
  const num = m[2]!.padStart(3, '0');
  return `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/pocket/${set}/${set}_${num}_EN.webp`;
}
