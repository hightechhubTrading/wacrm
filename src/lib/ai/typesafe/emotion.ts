import type { ChatMessage } from '../types';
import { isArabicText } from '../defaults';
import {
  customerLanguageScript,
  latestCustomerAuthoredMessage,
} from '../query';

export const EMOTIONS = {
  neutral: 'Matter-of-fact request with no clear emotional signal.',
  positive: 'Expresses satisfaction, enthusiasm or appreciation.',
  confused: 'Unsure what an answer means or how to proceed.',
  concerned:
    'Worried about cost, suitability, reliability or timing without expressing dissatisfaction.',
  sad: 'Expresses sadness or distress without anger or dissatisfaction with this interaction.',
  disappointed:
    'Expresses disappointment or dissatisfaction with the business, product or service.',
  frustrated:
    'Expresses irritation, impatience or feeling unheard about this interaction or service.',
  angry:
    'Expresses anger, hostility or outrage about this interaction or service.',
  unclear:
    'No reliable emotional signal, ambiguous tone or only attachment/receipt markers.',
} as const;

export type CustomerEmotion = keyof typeof EMOTIONS;
export interface EmotionAssessment {
  /** An estimate of expressed tone, never a verified fact about a person. */
  emotion: CustomerEmotion;
  confidence: number;
  upsetProbability: number;
}

export const EMOTION_GUIDANCE_MIN = 0.65;
export const EMOTION_HANDOFF_MIN = 0.95;
export const UPSET_HANDOFF_MIN = 0.95;

export function emotionNeedsHandoff(assessment: EmotionAssessment): boolean {
  // Mild frustration deserves a useful recovery reply, not a sticky transfer.
  return (
    assessment.emotion === 'angry' &&
    assessment.confidence >= EMOTION_HANDOFF_MIN &&
    assessment.upsetProbability >= UPSET_HANDOFF_MIN
  );
}

export function needsEmotionCare(assessment?: EmotionAssessment): boolean {
  return (
    !!assessment &&
    assessment.confidence >= EMOTION_GUIDANCE_MIN &&
    !['neutral', 'positive', 'unclear'].includes(assessment.emotion)
  );
}

export function emotionGuidance(assessment: EmotionAssessment): string {
  if (!needsEmotionCare(assessment)) return '';
  const guidance: Partial<Record<CustomerEmotion, string>> = {
    confused:
      'Explain the answer patiently in simple language. Ask at most one necessary clarification. Do not repeat already answered questions or pressure the customer to buy.',
    concerned:
      'Acknowledge the specific worry calmly and answer it using known facts. Do not dismiss it, pressure a purchase or promise an outcome the team has not confirmed.',
    sad: 'Acknowledge the difficult experience briefly and respectfully. Keep the practical help gentle and focused; avoid cheerful sales language or guessing personal circumstances.',
    disappointed:
      'Acknowledge the specific disappointment and answer what you can from known facts. Ask at most one useful unanswered question. Do not transfer solely because the customer is disappointed, upsell or invent promises.',
    frustrated:
      'Acknowledge the specific frustration and correct or answer the missed point using known facts. Do not defend the bot, repeat answered questions or transfer solely because the customer is frustrated.',
    angry:
      'Stay calm and acknowledge the specific problem. Give useful, factual help without arguing, blaming, telling the customer to calm down or selling. Severe anger or a failed recovery is routed separately by the application.',
  };
  return `Estimated customer tone: ${assessment.emotion}. This is uncertain context; do not label the customer's feelings in your reply. ${guidance[assessment.emotion]}`;
}

export function emotionHandoffReason(assessment: EmotionAssessment): string {
  const tone =
    assessment.confidence >= EMOTION_GUIDANCE_MIN
      ? `Estimated customer tone: ${assessment.emotion}. `
      : '';
  return `${tone}Possible customer dissatisfaction; human review requested to avoid further frustration.`;
}

/** Fixed apologies acknowledge the experience without inventing fault, refunds or deadlines. */
export function emotionalHandoffMessage(messages: ChatMessage[]): string {
  const script = customerLanguageScript(messages);
  const arabic =
    script === 'arabic' ||
    (script === 'mixed' &&
      isArabicText(latestCustomerAuthoredMessage(messages)));
  return arabic
    ? 'نعتذر عن هذه التجربة. طلبك يحتاج متابعة من أحد أعضاء الفريق، وسأترك له المحادثة لمساعدتك.'
    : 'I’m sorry about this experience. Your request needs a team member’s attention, so I’ll leave the conversation with them to help you.';
}
