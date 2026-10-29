import type { ProductPromptItem } from './media-library';
import type { ChatMessage } from './types';
const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[\u064B-\u065F\u0640]/g, '');
/** Retrieval narrows context, never approves products or establishes a customer selection. */
export function productContext(
  products: ProductPromptItem[],
  knowledge: string[],
  messages: ChatMessage[]
): ProductPromptItem[] {
  const ids = new Set(
    knowledge.flatMap((k) =>
      [...k.matchAll(/\[source product=([0-9a-f-]+)/gi)].map((m) => m[1])
    )
  );
  const customer = normalize(
    messages
      .filter((m) => m.role === 'user')
      .slice(-6)
      .map((m) => m.content)
      .join('\n')
  );
  const customerWords = new Set(
    customer.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  );
  for (const p of products)
    if (
      [p.name, ...(p.catalog?.aliases ?? [])].some(
        (n) =>
          (n.trim().length >= 4 && customer.includes(normalize(n))) ||
          normalize(n)
            .split(/[^\p{L}\p{N}]+/u)
            .some((word) => word.length >= 4 && customerWords.has(word))
      )
    )
      ids.add(p.id);
  if (!ids.size) return products;
  // Include parents only for category explanation; their prices never inherit.
  for (const id of [...ids]) {
    let p = products.find((p) => p.id === id);
    const seen = new Set<string>();
    while (p?.catalog?.parent_id && !seen.has(p.id)) {
      seen.add(p.id);
      ids.add(p.catalog.parent_id);
      p = products.find((x) => x.id === p!.catalog!.parent_id);
    }
  }
  return products.filter((p) => ids.has(p.id));
}
