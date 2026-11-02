/** Presentation cleanup only: retains recorded ranges, milestones and qualifications. */
export function cleanTerm(value: string): string {
  return value
    .trim()
    .replace(/^(?:Warranty|Delivery\s*(?:\/\s*installation)?)\s*:\s*/i, '')
    .replace(/\bOne year\b/gi, '1 year')
    .replace(/\bTwo years\b/gi, '2 years')
    .replace(/(\d)\s*[-–]\s*(\d)/g, '$1–$2')
    .replace(/\.+$/, '')
    .trim();
}
export function termKey(value: string): string {
  return cleanTerm(value).toLowerCase().replace(/\s+/g, ' ');
}
export function termChoices(values: string[]): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const text = cleanTerm(value),
      key = termKey(text);
    if (!text || seen.has(key)) return [];
    seen.add(key);
    return [text];
  });
}
