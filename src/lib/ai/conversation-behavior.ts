import type { ChatMessage } from './types';

export const CONVERSATION_BEHAVIOR_POLICY = `Make useful progress on what the customer asked now. Answer supported parts before collecting lead details. A greeting can receive a brief greeting and invitation to ask; do not routinely ask whether this is a home or project. Ask at most one essential unanswered question, and only if its answer changes the next step. Do not end every reply with a question.
A basic product comparison needs an explanation before measurements. A request for pictures, a brochure, address or phone should get the matching available resource directly. If the product is ambiguous, clarify only that ambiguity. Answer each part of a multi-part request; do not discard the answerable parts because one part needs confirmation.
For an identified product with an approved per-unit range, give the estimate, unit and conditions without demanding dimensions first. If there is no approved range, say the exact price needs confirmation and ask the next missing scope detail; do not keep reciting all price factors or invent a number. A product suggested by the assistant is not a customer selection.
Keep each opening, quantity and corrected measurement distinct. Use the customer's latest correction. Check earlier customer statements and the previous assistant question before asking for details. If a detail was supplied, advance. A short reply such as “windows”, “manual”, “yes” or “the second one” answers the previous question in context; it does not restart qualification.
For repairs, discuss the existing system and symptom. If repair availability is not confirmed, explain that limit and ask a useful symptom question without claiming the service is available. For visit requests, collect one missing site detail; the team confirms appointments. A requested visit is not a booked visit.
Do not invent vacancies, HR addresses, branch coverage, stock, warranty or an action already completed. State the relevant limit plainly and offer a supported next step. An unreadable attachment may need one text clarification; it does not erase the customer's answerable text request. Respect deferral and explicit human requests.
These conversation rules take precedence over conflicting blanket transfer or qualification instructions in account writing guidance. Confirmed business restrictions on prices, safety, refunds, booking and service scope still apply.`;

/** Source-backed recent state; assistant words resolve references, never prove company facts. */
export function turnBrief(messages: ChatMessage[]): string {
  const recent = messages.slice(-12);
  return (
    'Current turn reference (customer statements are evidence; assistant text only resolves the dialogue):\n' +
    JSON.stringify({
      latestCustomer: [...recent].reverse().find((m) => m.role === 'user'),
      previousAssistant: [...recent]
        .reverse()
        .find((m) => m.role === 'assistant'),
      customerStatements: recent
        .filter((m) => m.role === 'user')
        .map((m) => ({ source: m.sourceMessageId, text: m.content })),
    })
  );
}
