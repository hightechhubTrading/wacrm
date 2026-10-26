import { Fragment } from 'react';

/** Keep numeric runs in their original order inside Arabic and mixed text. */
export function MessageText({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return text.split(/([+＋]?[\d٠-٩۰-۹]+(?:[ \t\u00a0()./\-–]+[\d٠-٩۰-۹]+)*)/u).map((part, index) =>
    index % 2 === 1
      ? <bdi dir="ltr" key={index}>{part}</bdi>
      : <Fragment key={index}>{part}</Fragment>
  );
}
