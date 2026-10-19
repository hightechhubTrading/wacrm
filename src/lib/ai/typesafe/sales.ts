import { containsPriceFigure } from '../defaults';
import { shutterClarification } from '../recovery';
import type { ConversationMemory } from '../memory';
import type { FollowupKind } from '../followups';
import { choice, noul, type Questions } from '@typesafe-ai/sdk';
import type { ChatMessage, GenerateResult } from '../types';
import type { ProductPromptItem } from '../media-library';
import type { CollectFieldPromptItem } from '../defaults';
import { askJev, jevMode, salesV2Mode, type JevMode } from './client';
import { logJevCheck, type JevAuditContext } from './audit';
import {
  customerStatements,
  HANDOFF_MIN,
  INTENTS,
  isProbability,
  salesGuidance,
  SUPPORTED_MIN,
  type SalesIntent,
} from './policy';
import { priceOutsideRange } from './price';
import {
  EMOTIONS,
  emotionGuidance,
  emotionHandoffReason,
  emotionNeedsHandoff,
  needsEmotionCare,
  type EmotionAssessment,
  type CustomerEmotion,
} from './emotion';

export interface SalesEvidence {
  messages: ChatMessage[];
  knowledge: string[];
  products: ProductPromptItem[];
  collectFields: CollectFieldPromptItem[];
  businessContext: string | null;
  businessHours?: string | null;
  socialLinks?: Record<string, string> | null;
  agentPhone?: string | null;
  currency?: string | null;
  memory?: ConversationMemory;
  emotion?: EmotionAssessment;
}

export const INPUT_QUESTIONS = {
  emotion: choice(
    {
      question:
        'What emotional tone is expressed in the latest customer-authored text in `messages`?',
      instructions:
        'Estimate expressed tone, not hidden feelings or a diagnosis. Use earlier turns only to interpret the latest text, including sarcasm or feeling unheard. Past anger explicitly resolved by the latest customer is not current anger. Ignore assistant words, quoted examples, inferred image descriptions and attachment/receipt markers. Urgency, capitals, a high-price observation or a polite repair request alone do not imply anger. Choose unclear when there is insufficient evidence.',
    },
    EMOTIONS
  ),
  upset: noul({
    question:
      'Does the latest customer-authored text express current anger, frustration or dissatisfaction about this interaction, the business, its product or service?',
    instructions:
      'Include indirect irritation, feeling unheard, hostile sarcasm or disappointment with unresolved service. Consider previous turns only to interpret the latest text. Exclude past dissatisfaction that the latest customer says is resolved, quoted examples, attachment descriptions, ordinary urgency, neutral repair requests, polite price negotiation and worry without dissatisfaction. This judges expressed dissatisfaction, not unobservable feelings.',
  }),
  intent: choice(
    'What is the primary intent of the latest customer-authored request in `messages`? Use previous turns only to resolve references. Treat image descriptions as inferred observations.',
    INTENTS
  ),
  action: choice(
    'What practical next work is explicitly requested in the latest customer turn? A generic ad opener is none; a conditional offer from the business is not a customer request.',
    {
      none: 'No requested business action',
      quotation: 'Prepare or clarify a quotation',
      inspection: 'Arrange a measurement/site inspection',
      repair: 'Resolve a repair/service request',
      location: 'Send business location',
      comparison: 'Compare requested product/specification alternatives',
    }
  ),
  needs_location: noul(
    'Does the latest customer explicitly ask for the business location? Ignore a location the customer merely shares.'
  ),
  needs_comparison: noul(
    'Does the latest customer explicitly request a product/specification comparison or a revised quotation matching a competitor scope?'
  ),
  deferred: noul(
    'Does the latest customer explicitly defer the next step and say they will contact the business later? Do not infer deferral from silence or a past deferral that has been reopened.'
  ),
  wrong_contact: noul(
    'Does the latest customer explicitly say the message was sent to the wrong contact? Do not infer this from missing media, a greeting or a name.'
  ),
  human: noul(
    'Does the latest customer-authored request explicitly ask to speak with a human salesperson or team member? Do not infer this from an ordinary quotation request or a past request already resolved.'
  ),
  recovery_failed: noul({
    question:
      'Has a recovery attempt already failed: does the latest customer explicitly remain dissatisfied about the same unresolved issue after an earlier customer complaint and an intervening assistant attempt to address that complaint?',
    instructions:
      'Require all three in chronological conversation history: an earlier customer complaint, an assistant response attempting to resolve or clarify that complaint, and the latest customer still complaining about that same issue. A first complaint about earlier routine answers, a repeated price request, a correction, urgency or disappointment alone is not a failed recovery. Do not infer dissatisfaction from silence or attachment markers. A complaint that the latest customer says is resolved does not qualify.',
  }),
  stuck: noul(
    'Does the latest customer-authored request explicitly complain that the business is repeating itself, ignoring an already answered detail, or failing to answer the same request? Ordinary requests for more detail are not complaints.'
  ),
};

export interface SalesInput {
  mode: JevMode;
  handoff: boolean;
  guidance: string;
  followupKind?: FollowupKind;
  followupKinds?: FollowupKind[];
  suppressSales?: boolean;
  emotion?: EmotionAssessment;
  apologize?: boolean;
  handoffReason?: string;
}

export async function assessSalesInput(
  ctx: JevAuditContext,
  messages: ChatMessage[],
  memory?: ConversationMemory
): Promise<SalesInput> {
  const mode = jevMode();
  if (mode === 'off') return { mode, handoff: false, guidance: '' };
  const start = Date.now();
  try {
    const result = await askJev({ messages, memory }, INPUT_QUESTIONS);
    const { intent, human, stuck } = result.answers;
    const { emotion, upset } = result.answers;
    if (
      !Object.hasOwn(INTENTS, intent.choice) ||
      !isProbability(intent.confidence) ||
      !isProbability(human.noul) ||
      !isProbability(stuck.noul) ||
      !emotion ||
      !Object.hasOwn(EMOTIONS, emotion.choice) ||
      !isProbability(emotion.confidence) ||
      !isProbability(upset?.noul)
    )
      throw new Error('Invalid judgments');
    const v2 = salesV2Mode();
    const deferred = result.answers.deferred;
    const wrong = result.answers.wrong_contact;
    const action = result.answers.action;
    const suppressSales =
      v2 === 'enforce' &&
      intent.confidence >= 0.8 &&
      ((intent.choice === 'deferred' &&
        isProbability(deferred?.noul) &&
        deferred.noul >= 0.95) ||
        (intent.choice === 'wrong_contact' &&
          isProbability(wrong?.noul) &&
          wrong.noul >= 0.95));
    const actionKinds = [
      'quotation',
      'inspection',
      'repair',
      'location',
      'comparison',
    ];
    const followupKind =
      !suppressSales &&
      action &&
      actionKinds.includes(action.choice) &&
      isProbability(action.confidence) &&
      action.confidence >= 0.8
        ? (action.choice as FollowupKind)
        : undefined;
    const assessment: EmotionAssessment = {
      emotion: emotion.choice as CustomerEmotion,
      confidence: emotion.confidence,
      upsetProbability: upset.noul,
    };
    const emotionalHandoff = emotionNeedsHandoff(assessment);
    const apologize =
      upset.noul >= 0.85 ||
      (assessment.confidence >= 0.8 &&
        ['angry', 'frustrated', 'disappointed'].includes(assessment.emotion)) ||
      stuck.noul >= HANDOFF_MIN;
    const recovery = result.answers.recovery_failed;
    const recoveryFailed =
      isProbability(recovery?.noul) && recovery.noul >= HANDOFF_MIN;
    const followupKinds: FollowupKind[] = followupKind ? [followupKind] : [];
    if (!suppressSales && result.answers.needs_location?.noul >= 0.95)
      followupKinds.push('location');
    if (!suppressSales && result.answers.needs_comparison?.noul >= 0.95)
      followupKinds.push('comparison');
    const handoff =
      human.noul >= HANDOFF_MIN ||
      emotionalHandoff ||
      (apologize && recoveryFailed);
    await logJevCheck(ctx, {
      layer: 'input',
      mode,
      outcome: handoff ? 'handoff' : 'allow',
      model: result.model,
      latencyMs: Date.now() - start,
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      judgments: {
        intent: { choice: intent.choice, confidence: intent.confidence },
        human: human.noul,
        stuck: stuck.noul,
        recovery_failed: recovery?.noul ?? null,
        emotion: { choice: emotion.choice, confidence: emotion.confidence },
        upset: upset.noul,
        needs_location: result.answers.needs_location?.noul ?? null,
        needs_comparison: result.answers.needs_comparison?.noul ?? null,
        v2Mode: v2,
        action: action
          ? { choice: action.choice, confidence: action.confidence }
          : null,
        deferred: deferred?.noul ?? null,
        wrong_contact: wrong?.noul ?? null,
      },
    });
    return {
      mode,
      emotion: mode === 'enforce' ? assessment : undefined,
      apologize: mode === 'enforce' && apologize,
      handoffReason:
        mode === 'enforce' && handoff && apologize
          ? emotionalHandoff
            ? emotionHandoffReason(assessment)
            : 'Customer remains dissatisfied after a recovery attempt; human review requested.'
          : undefined,
      followupKind:
        mode === 'enforce' && v2 === 'enforce' ? followupKind : undefined,
      followupKinds:
        mode === 'enforce' && v2 === 'enforce'
          ? [...new Set(followupKinds)]
          : undefined,
      suppressSales,
      handoff: mode === 'enforce' && handoff,
      guidance:
        mode === 'enforce'
          ? [
              salesGuidance(intent.choice as SalesIntent, intent.confidence),
              emotionGuidance(assessment),
              apologize && !handoff
                ? 'Recover this conversation before considering transfer: briefly acknowledge the specific concern, answer or correct the missed point from evidence, and ask at most one necessary unanswered question. Do not repeat qualification or promise an unconfirmed action.'
                : '',
              'Do not hand off solely because a fact is missing. Answer supported parts and clarify one essential missing detail; transfer only when the actual request needs a human decision or recovery has failed.',
            ]
              .filter(Boolean)
              .join('\n')
          : '',
    };
  } catch {
    await logJevCheck(ctx, {
      layer: 'input',
      mode,
      outcome: 'unavailable',
      latencyMs: Date.now() - start,
    });
    return {
      mode,
      handoff: false,
      guidance:
        mode === 'enforce'
          ? 'Intent checks are temporarily unavailable. Respond cautiously using only confirmed evidence; ask one necessary unanswered clarification. Respect an explicit request for a human immediately. Do not infer anger or invent facts. The reply must still pass output verification.'
          : '',
    };
  }
}

export function outputQuestions(
  evidence: SalesEvidence,
  proposal: GenerateResult
): Questions {
  const questions: Questions = {
    grounded: noul(
      {
        question:
          'Is proposal.text free of unsupported affirmative business claims?',
        instructions: [
          'Evaluate only what the assistant asserts as a fact, not what it asks the customer. A question such as "Do you mean window shutters or a garage/shop door?" does not claim the business supplies every named option. Greetings, acknowledgments and necessary clarifications have no factual business claims and pass.',
          'evidence.products is the approved catalog. Each product priceMin and priceMax explicitly authorizes a clearly labelled estimated range in evidence.currency and priceUnit. No extra quotation document, dimensions or site visit is required to share that per-unit estimate. It must match the exact customer product and proposal.productTagId; do not borrow a price from another product or variant.',
          'Policy statements such as "the team confirms the final quote" or conditional offers to review/arrange an inspection do not assert an operation has completed. They are allowed. Confirmed appointments, already-sent documents, guaranteed slots, invented scope, discounts, phone numbers, stock, warranties and technical specifications require matching evidence.',
          'Source notes are internal review context, not approved facts. Limitations restrict claims, not establish specifications. Family/sibling prices, ratings, warranties, motors and lead times never inherit. Earlier assistant assertions and customer wishes do not prove business facts. Empty text has no claims.',
        ],
      },
      {
        true: 'Every affirmative business claim is explicitly supported, or the reply contains only questions, acknowledgments or conditional next steps.',
        false:
          'At least one affirmative business claim contradicts or goes beyond the provided evidence; for example an unsupported garage price or a falsely confirmed visit.',
      }
    ),
    responsive: noul(
      'Does `proposal.text` address the latest customer request or ask one necessary unanswered clarification, without repeating an answered question? Use customer-authored statements to establish what is answered, not earlier assistant assumptions. For a price-per-unit question, an approved matching estimate answers directly without needing dimensions. When the product or variant is ambiguous (including shutter/Shatar), asking windows versus garage/shop is useful progress. If no estimate is approved, a plain explanation and one essential missing detail is valid. Questions and conditional offers need no business-claim evidence. An empty handoff response is acceptable.'
    ),
  };
  if (proposal.handoff)
    questions.handoff_needed = noul({
      question:
        'Does the actual customer request require human authority or an explicit human transfer now?',
      instructions:
        'Judge the customer request in evidence.messages, not the assistant decision. Explicit human requests, final negotiated quotes, confirmed bookings, unresolved serious complaints and genuinely unavailable technical authority justify transfer. A routine ad opener, known product question, ambiguous spelling, missing measurement, first price request, unapproved price range, or an earlier rejected candidate alone do not. One necessary clarification or a supported partial answer should continue.',
    });
  if (needsEmotionCare(evidence.emotion)) {
    questions.empathy = noul({
      question:
        'Does `proposal.text` respond respectfully to the latest customer concern or confusion, acknowledging their expressed difficulty and giving calm, relevant help?',
      instructions:
        'The estimate in evidence.emotion is uncertain context, not a fact to announce about the customer. Do not argue, blame, dismiss, tell them to calm down, use cheerful upselling, pressure a purchase or repeat answered qualification questions. Do not demand an apology for an ordinary information request. Empty handoff text is acceptable.',
    });
  }
  if (salesV2Mode() !== 'off') {
    questions.documents = noul(
      'Does `proposal.text` avoid claiming to have read, understood or interpreted attachment content unavailable in evidence.messages and evidence.memory.documents? A filename or receipt marker is not parsed content. Parsed/partial extraction supports only the actual visible text; no visual drawing interpretation. Acknowledge receipt without pretending to read it. Empty handoff text is acceptable.'
    );
    questions.completion = noul(
      'Does proposal.text avoid falsely asserting an operation has already been completed or a date/slot guaranteed? If it makes no such completed-operation assertion, answer yes. Asking for a location, offering a review, saying the team confirms final quotes, or giving a non-final catalog estimate is not a completed operation and passes. Statements such as appointment is booked, I sent the file or your quote is ready require recorded successful operations in evidence.memory.actions. An open task or requested date is not proof of completion.'
    );
    questions.scope = noul({
      question:
        'Does proposal.text avoid changing or contradicting customer-supplied quantities, dimensions and specifications, using the latest correction whenever it restates or quotes the scope?',
      instructions:
        'Only penalize an omission when the reply claims to summarize, compare, price or fulfill the full requested scope but leaves an opening or requirement out. A brief acknowledgment or necessary clarification need not recite previously supplied measurements. For example, asking for missing height after the customer supplied width preserves scope; asking for the same width again is judged by responsive instead. A catalog-backed per-unit estimate need not enumerate every opening or invent missing dimensions. Faithful translation and Arabic digit normalization are allowed. If no scope is supplied, or the reply makes no conflicting or incomplete scope claim, answer yes.',
    });
    questions.requests = noul(
      {
        question:
          'Does the reply avoid ignoring a separate, independently answerable customer request?',
        instructions: [
          'This checks coverage of independent requests only; primary response relevance is checked separately. A customer with one request and one necessary clarification passes this check. For example, customer "الشتر بكم المتر؟" / "Shatar price per meter?", assistant "Window shutters or a garage/shop shutter door?" passes: product type is unresolved, so the per-unit price is not yet independently answerable.',
          'If there are multiple requests, judge whether the reply answers each part whose answer is already supported by evidence. A known showroom address or phone can be answered independently while collecting missing quote details. Ignoring that known address and asking only measurements fails.',
          'Do not demand a number before product identity is known. Do not require a human transfer, repeated restatement of the request, or a final quote to consider the turn useful. Empty handoff text is acceptable.',
        ],
      },
      {
        true: 'No separate known-answer request was skipped. Includes a single ambiguous price request answered by a necessary product-type question.',
        false:
          'A separate request with an available supported answer, such as a showroom address alongside a quote request, was ignored.',
      }
    );
  }
  if (proposal.mediaId)
    questions.media = noul(
      'Is the exact attachment identified by `proposal.mediaId` in `evidence.products` relevant to the latest customer request and consistent with the reply? An absent file ID is not supported.'
    );
  if (proposal.productTagId)
    questions.product = noul(
      'Has the customer clearly identified or agreed to the exact product identified by `proposal.productTagId` in `evidence.products` as the topic? A speculative product suggestion by the assistant or an absent ID is not sufficient.'
    );
  for (const [i, field] of (proposal.fields ?? []).slice(0, 24).entries()) {
    questions[`field_${i}`] = noul({
      question:
        'Is this exact proposed lead field value explicitly supported by `customerStatements`, for a uniquely matching allowed field in `evidence.collectFields`?',
      proposedField: field,
      instructions:
        'Customer statements exclude inferred photo captions. Do not accept a value guessed from an image, invented by an assistant, or supplied only in business reference material. A faithful translation or unit normalization preserving the stated meaning is acceptable. If the customer corrected a value, use the latest correction.',
    });
  }
  return questions;
}

async function checkSalesOutput(
  ctx: JevAuditContext,
  evidence: SalesEvidence,
  proposal: GenerateResult,
  attempt = 0,
  failures: string[] = []
): Promise<GenerateResult> {
  const mode = jevMode();
  if (mode === 'off') return proposal;
  const start = Date.now();
  try {
    const questions = outputQuestions(evidence, proposal);
    const result = await askJev(
      {
        evidence,
        proposal,
        customerStatements: [
          ...customerStatements(evidence.messages),
          ...(evidence.memory?.statements.map((s) => s.text) ?? []),
        ],
      },
      questions
    );
    const supported = (id: string) => {
      const answer = result.answers[id];
      if (!answer || answer.type !== 'noul' || !isProbability(answer.noul))
        throw new Error('Invalid judgment');
      return answer.noul >= SUPPORTED_MIN;
    };
    const grounded = supported('grounded');
    const responsive = supported('responsive');
    const empathetic = !questions.empathy || supported('empathy');
    // Existence/allowlist checks stay in code; semantic judgments never grant access.
    const mediaAllowed =
      !proposal.mediaId ||
      (supported('media') &&
        evidence.products.some((p) =>
          p.files.some((f) => f.id === proposal.mediaId)
        ));
    const productAllowed =
      !proposal.productTagId ||
      (supported('product') &&
        evidence.products.some((p) => p.id === proposal.productTagId));
    const fields = (proposal.fields ?? []).filter((field, i) => {
      if (i >= 24) return false;
      const allowed = evidence.collectFields.filter(
        (f) => f.name.trim().toLowerCase() === field.name.trim().toLowerCase()
      );
      return supported(`field_${i}`) && allowed.length === 1;
    });
    // Evaluate each enforced dimension so recovery receives every failed check.
    const checks: Record<string, boolean> = {
      grounded,
      responsive,
      empathy: empathetic,
      price_evidence:
        !containsPriceFigure(proposal.text) ||
        !!(
          productAllowed &&
          proposal.productTagId &&
          evidence.products.some(
            (p) =>
              p.id === proposal.productTagId &&
              p.priceMin != null &&
              p.priceMax != null
          )
        ),
      price: !priceOutsideRange(
        proposal.text,
        evidence.products.find((p) => p.id === proposal.productTagId)
      ),
    };
    if (salesV2Mode() === 'enforce') {
      for (const id of ['documents', 'completion', 'scope', 'requests'])
        checks[id] = supported(id);
    }
    const requestedTransfer =
      proposal.handoff &&
      result.answers.handoff_needed?.type === 'noul' &&
      result.answers.handoff_needed.noul >= HANDOFF_MIN;
    if (proposal.handoff && !requestedTransfer)
      checks.premature_handoff = false;
    failures.push(...Object.keys(checks).filter((id) => !checks[id]));
    const handoff = failures.length > 0;
    await logJevCheck(ctx, {
      layer: 'output',
      mode,
      outcome: handoff
        ? 'handoff'
        : !mediaAllowed ||
            !productAllowed ||
            fields.length !== (proposal.fields ?? []).length
          ? 'filtered'
          : 'allow',
      model: result.model,
      latencyMs: Date.now() - start,
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      judgments: {
        attempt,
        enforcedFailures: Object.keys(checks).filter((id) => !checks[id]),
        v2Mode: salesV2Mode(),
        productId: proposal.productTagId,
        sourceDocumentIds: [
          ...new Set(
            evidence.knowledge.flatMap((k) => {
              const match = k.match(/\[source document=([0-9a-f-]+)/i);
              return match ? [match[1]] : [];
            })
          ),
        ].slice(0, 20),
        routingReason: requestedTransfer
          ? 'human_authority'
          : handoff
            ? 'verification_failed'
            : 'verified_reply',
        ...Object.fromEntries(
          Object.keys(questions).map((id) => {
            const answer = result.answers[id];
            return [id, answer?.type === 'noul' ? answer.noul : null];
          })
        ),
      },
    });
    if (mode === 'shadow') return proposal;
    return {
      ...proposal,
      text: handoff ? '' : proposal.text,
      handoff: !!requestedTransfer || handoff,
      routingDecision: {
        reason: requestedTransfer
          ? 'human_authority'
          : handoff
            ? 'verification_failed'
            : 'verified_reply',
        failures: Object.keys(checks).filter((id) => !checks[id]),
        attempt,
      },
      mediaId: mediaAllowed ? proposal.mediaId : null,
      productTagId: productAllowed ? proposal.productTagId : null,
      fields,
    };
  } catch {
    failures.push('unavailable');
    await logJevCheck(ctx, {
      layer: 'output',
      mode,
      outcome: 'unavailable',
      latencyMs: Date.now() - start,
      judgments: { attempt },
    });
    return mode === 'shadow'
      ? proposal
      : {
          ...proposal,
          text: '',
          handoff: true,
          routingDecision: {
            reason: 'verification_unavailable',
            failures: ['unavailable'],
            attempt,
          },
          mediaId: null,
          productTagId: null,
          fields: [],
        };
  }
}

/** A rejected draft gets one rewrite, never an unchecked send or an open-ended loop. */
export async function verifySalesOutput(
  ctx: JevAuditContext,
  evidence: SalesEvidence,
  proposal: GenerateResult,
  repair?: (guidance: string) => Promise<GenerateResult>
): Promise<GenerateResult> {
  const failures: string[] = [];
  const checked = await checkSalesOutput(ctx, evidence, proposal, 0, failures);
  if (
    !checked.handoff ||
    checked.routingDecision?.reason === 'human_authority' ||
    !repair ||
    jevMode() !== 'enforce'
  )
    return checked;
  try {
    const corrections: Record<string, string> = {
      premature_handoff:
        'The customer can still be helped. Answer a known fact or ask one essential clarification; do not transfer merely because a price or dimension is missing.',
      price_evidence:
        'A price needs the exact approved product with both range limits and a same-reply product tag. Use its unit and conditions. If product match is unclear, ask which type rather than guess a price.',
      grounded:
        'Business claims were not sufficiently supported. Use only explicit business/catalog/knowledge evidence; customer wishes and prior assistant promises do not prove business facts.',
      responsive:
        'The reply did not sufficiently address the latest request or repeated an answered question. Check the recent turns and older customer statements before asking anything.',
      empathy:
        'The tone did not sufficiently acknowledge the specific concern. Respond calmly and helpfully without blame, pressure or cheerful upselling.',
      price:
        'The quoted amount was outside the selected product range. Use its exact currency, unit, range and conditions, or omit the amount and ask the essential missing detail.',
      documents:
        'The reply implied access to unavailable attachment content. Acknowledge receipt only; use only actual parsed text and respect partial extraction limits.',
      completion:
        'The reply implied an unsupported completed operation or confirmed appointment. Describe a request or conditional next step; only recorded successful work proves completion.',
      scope:
        'The reply changed or omitted part of the requested scope. Preserve the latest corrected quantities, dimensions and requirements.',
      requests:
        'The reply missed an independent request. Answer each supported part, including location/comparison questions, and ask only one essential missing clarification.',
      unavailable:
        'Verification was unavailable; this is not evidence of a content error. Keep the reply conservative and fully supported; the replacement still requires verification.',
    };
    const revised = await repair(
      failures.map((id) => corrections[id]).join('\n') +
        '\n\n' +
        'The previous candidate did not pass reply verification. Write a fresh, brief reply to the latest customer using only the supplied evidence. Remove unsupported claims, promises of completed work, appointments, prices or attachment interpretation. Answer supported parts; if a fact is missing, ask one specific unanswered clarification. Acknowledge any concern respectfully. Do not transfer just because the previous wording failed or a detail is missing. Use the handoff marker only if the actual request requires human authority or an explicit human request. All normal evidence, language, field and media rules still apply.'
    );
    const recovered = await checkSalesOutput(ctx, evidence, revised, 1);
    if (
      !recovered.handoff ||
      revised.handoff ||
      recovered.routingDecision?.reason === 'verification_unavailable'
    )
      return recovered;
    const clarification = shutterClarification(evidence);
    if (!clarification) return recovered;
    // One narrow template fallback: no extra generation, no actions, same verifier.
    return await checkSalesOutput(
      ctx,
      evidence,
      {
        ...proposal,
        text: clarification,
        handoff: false,
        mediaId: null,
        productTagId: null,
        fields: [],
        priority: null,
        priorityReason: null,
      },
      2
    );
  } catch {
    // Keep the original verified/filtered fields, never the rejected raw proposal.
    return checked;
  }
}
