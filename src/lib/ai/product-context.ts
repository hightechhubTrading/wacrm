import type { ProductPromptItem } from './media-library';
import type { ChatMessage } from './types';
const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[\u064B-\u065F\u0640]/g, '');

/** Full product records are bounded; an unrecognized query must never load the
 * entire inventory into generation/verification. Records are selected whole so
 * limitations and pricing conditions cannot be lost through field truncation. */
export const MAX_CONTEXT_PRODUCTS = 8;
const greetingOnly = (messages: ChatMessage[]) =>
  messages.length === 1 &&
  messages[0].role === 'user' &&
  /^(?:مرحبا|مرحبا بكم|اهلا|اهلا وسهلا|هلا|السلام عليكم|السلام عليكم ورحمة الله(?: وبركاته)?|hi|hello|hey|good morning|good afternoon|good evening)$/.test(
    normalize(messages[0].content)
      .replace(/[!！?؟.,،؛\s]+/gu, ' ')
      .trim()
  );

/** Retrieval narrows context, never approves products or establishes a selection. */
export function productContext(
  products: ProductPromptItem[],
  knowledge: string[],
  messages: ChatMessage[]
): ProductPromptItem[] {
  if (greetingOnly(messages)) return [];
  const scores = new Map<string, number>();
  for (const [index, excerpt] of knowledge.entries())
    for (const match of excerpt.matchAll(/\[source product=([0-9a-f-]+)/gi))
      scores.set(match[1], Math.max(scores.get(match[1]) ?? 0, 1500 - index));
  const customer = normalize(
    messages
      .filter((m) => m.role === 'user')
      .slice(-6)
      .map((m) => m.content)
      .join('\n')
  );
  const latestCustomer = normalize(
    messages.findLast((m) => m.role === 'user')?.content ?? ''
  );
  const customerWords = new Set(
    customer.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  );
  for (const p of products) {
    for (const name of [p.name, ...(p.catalog?.aliases ?? [])]) {
      const n = normalize(name).trim();
      const exact = n.length >= 4 && customer.includes(n);
      const words = n
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length >= 4 && customerWords.has(word));
      if (exact || words.length)
        scores.set(
          p.id,
          Math.max(
            scores.get(p.id) ?? 0,
            exact
              ? (latestCustomer.includes(n) ? 10000 : 1000) + n.length
              : words.length
          )
        );
    }
  }
  const matches = products
    .filter((p) => scores.has(p.id))
    .sort((a, b) => scores.get(b.id)! - scores.get(a.id)!);
  if (!matches.length) {
    // Broad discovery gets approved categories first, rather than every variant.
    // Small catalogues retain their original discovery coverage.
    const categories = products.filter((p) => p.catalog?.kind === 'family');
    return (categories.length ? categories : products).slice(
      0,
      MAX_CONTEXT_PRODUCTS
    );
  }
  const selected = matches.slice(0, MAX_CONTEXT_PRODUCTS);
  const ids = new Set(selected.map((p) => p.id));
  // Add parents only when there is room; exact matches always take priority.
  for (const child of [...selected]) {
    let p: ProductPromptItem | undefined = child;
    const seen = new Set<string>();
    while (
      p?.catalog?.parent_id &&
      !seen.has(p.id) &&
      selected.length < MAX_CONTEXT_PRODUCTS
    ) {
      seen.add(p.id);
      p = products.find((candidate) => candidate.id === p!.catalog!.parent_id);
      if (p && !ids.has(p.id)) {
        ids.add(p.id);
        selected.push(p);
      }
    }
  }
  return selected;
}
