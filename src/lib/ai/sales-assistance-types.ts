export const SALES_ASSISTANCE_CONTENT_TYPES = [
  'text',
  'audio',
  'location',
] as const;
export const SALES_ACTIONS = [
  'reply',
  'ask_details',
  'prepare_quote',
  'request_visit',
  'review_repair',
  'wait',
] as const;
export type SalesAssistanceAnalysis = {
  summary: string;
  action: (typeof SALES_ACTIONS)[number];
  tags: { id: string; name: string; rule?: string }[];
  fields: {
    id: string;
    name: string;
    scope: string;
    value: string;
    source: string;
  }[];
  preview: boolean;
};
