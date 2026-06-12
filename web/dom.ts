// Tiny safe DOM builder.  `append(string)` creates a TEXT node, so user/card
// strings can never be interpreted as HTML (no innerHTML, no XSS).

type Props = Record<string, unknown>;
type Child = Node | string | null | undefined;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Props = {}, ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k in node) {
      // Some DOM properties are read-only (e.g. input.list); assigning throws
      // in strict mode, so fall back to setting the attribute.
      try { (node as Record<string, unknown>)[k] = v; }
      catch { node.setAttribute(k, String(v)); }
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}
