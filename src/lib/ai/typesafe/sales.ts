import { selectReplyFallback } from '../reply-fallback';
import {
  KNOWLEDGE_GAP_QUESTIONS,
  type KnowledgeGapKind,
} from '../knowledge-gaps';
import { judgeSalesOutput } from './output-evidence';
import { CONVERSATION_BEHAVIOR_POLICY } from '../conversation-behavior';
import { CUSTOMER_TONE_POLICY } from '../customer-tone';
import { containsPriceFigure } from '../defaults';
import { PRODUCT_EDUCATION_RULES } from '../product-education';
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
  behaviorV2Enabled?: boolean;
  intent?: SalesIntent;
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
    'What practical next work is explicitly requested in the latest customer turn? A generic ad opener and a routine request for an available per-unit estimate are none. Quotation means requested written/final/revised quote work for staff, not every price question. A conditional offer from the business is not a customer request.',
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
    {
      question:
        'Is the customer explicitly requesting a human member of staff instead of continuing with the automated assistant?',
      instructions:
        'Judge the latest customer-authored words in messages. Equivalent Arabic requests count: "أبي أكلم موظف", "وصلني بموظف", "حولني للفريق", "ما أبي أكمل مع البوت". The person need not use the word human or salesperson. A request to arrange a site visit, ordinary quotation enquiry or mention of staff without asking to transfer is not enough. Ignore past requests resolved by the current message.',
    },
    {
      true: 'The customer directly asks to speak with or be connected to staff, including colloquial Arabic equivalents.',
      false: 'No current explicit request to move the conversation to staff.',
    }
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
  intent?: SalesIntent;
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
  memory?: ConversationMemory,
  behaviorV2Enabled = false
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
    const v2 = behaviorV2Enabled ? 'enforce' : salesV2Mode();
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
      intent: intent.choice as SalesIntent,
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
          'Are all company-specific claims in proposal.text explicitly supported by the approved business evidence?',
        instructions: [
          'generalProductKnowledge provides category meanings and basic visual distinctions, including relative privacy. They may be explained in Arabic or English, even when discussing the catalog. Definite category nouns such as المصمت or المخرم do not turn an ordinary explanation of those words into a company-specific specification. Only explicit claims about the business or an exact configuration require company evidence.',
          'Judge company-specific assertions only. A correct general definition, broad qualitative category comparison or conditional preference suggestion is not a company-specific assertion and does not require a catalog passage. General explanation accuracy is checked separately. Do not treat the absence of a general definition from evidence as an unsupported company claim.',
          PRODUCT_EDUCATION_RULES[0],
          PRODUCT_EDUCATION_RULES[2],
          PRODUCT_EDUCATION_RULES[3],
          'Evaluate only what the assistant asserts as a fact, not what it asks the customer. A question such as "Do you mean window shutters or a garage/shop door?" does not claim the business supplies every named option. Greetings, acknowledgments and necessary clarifications have no factual business claims and pass.',
          'evidence.products is the approved catalog. Each product priceMin and priceMax explicitly authorizes a clearly labelled estimated range in evidence.currency and priceUnit. No extra quotation document, dimensions or site visit is required to share that per-unit estimate. It must match the exact customer product and proposal.productTagId; do not borrow a price from another product or variant.',
          'A reply can truthfully state its uncertainty: “I do not have confirmation of an Egypt branch” does not assert that no branch exists. An unknown fact is not invented just because the assistant explicitly says it is unknown. A necessary customer question asserts no company fact. Statements that staff must confirm unverified service, price or booking details describe the application authority boundary, not a promise that the service is offered or that staff already acted.',
          'evidence.products includes the selectable outgoing files. A statement that no matching photo/brochure is available to attach here is supported when the relevant product has no matching file; it does not assert the company has none anywhere. A conditional offer to share a listed example is supported by that file. A file label or aiDescription supports basic visible appearance only, never a manufacturer specification, safety rating or exact measurement.',
          'Policy statements such as "the team confirms the final quote" or conditional offers to review/arrange an inspection do not assert an operation has completed. They are allowed. Confirmed appointments, already-sent documents, guaranteed slots, invented scope, discounts, phone numbers, stock, warranties and technical specifications require matching evidence.',
          'Source notes are internal review context, not approved facts. Limitations restrict claims, not establish specifications. Family/sibling prices, ratings, warranties, motors and lead times never inherit. Earlier assistant assertions and customer wishes do not prove business facts. Empty text has no claims.',
        ],
      },
      {
        true: 'All company-specific assertions are explicitly supported, or there are no company-specific assertions. Questions, explicit uncertainty and statements that unverified details need confirmation pass. General definitions, qualitative category comparisons and conditional preference suggestions pass this company-evidence check without a catalog passage.',
        false:
          'At least one assertion about this business or an exact offered configuration lacks or contradicts approved evidence, such as an invented price, material thickness, stock claim, warranty, fire rating or confirmed visit.',
      }
    ),
    education: noul(
      {
        question:
          'If proposal.text gives general product education, are its category definitions, qualitative distinctions and conditional suggestions accurate and appropriately limited?',
        instructions: [
          PRODUCT_EDUCATION_RULES[0],
          PRODUCT_EDUCATION_RULES[1],
          PRODUCT_EDUCATION_RULES[3],
          'Use generalProductKnowledge as a general educational reference. Visual privacy and display visibility comparisons are allowed category meanings, not security rankings. This reference does not establish availability or an exact offered configuration.',
          'Evaluate common product concepts using ordinary domain knowledge, even when the catalog does not spell them out. For example, المصمت blocks views, المخرم has openings for partial visibility, and البولي كربونات الشفاف permits views through it. Explaining this is ordinary education, not a technical guarantee about the installed system.',
          'Do not require a manufacturer datasheet for basic terminology or visual category differences. False definitions, unsupported broad performance guarantees and confident technical or safety conclusions inferred from the category alone fail. Exact company facts are evaluated separately by the business-evidence question. If there is no general product explanation, answer yes.',
        ],
      },
      {
        true: 'No general explanation is given, or it is accurate basic education or a conditional selection suggestion without unsupported performance guarantees.',
        false:
          'The general explanation is false, reverses basic category meanings, or turns a category into an unsupported guarantee or confident technical conclusion.',
      }
    ),
    responsive: noul(
      {
        question:
          'Does proposal.text make useful progress on the latest customer request without repeating an answered question?',
        instructions: [
          'Use the latest customer message and recent turns to identify the request. Earlier assistant text can identify the referent of a short follow-up, but customer-authored statements establish the selected product and answered details.',
          'For an ambiguous price request, asking which category the customer means is necessary progress. For example, customer “الشتر بكم المتر؟” or “Shatar price per metre?”, reply “Window shutters or a garage/shop shutter door?” passes. A catalog product or an earlier assistant suggestion does not by itself establish which product the customer wants. Do not demand a price before the category is identified.',
          'For an identified product with an approved matching per-unit estimate, share that estimate without demanding dimensions. If its price is not approved, a brief explanation plus one essential missing clarification is valid. Questions and conditional next steps need no factual business evidence.',
          'For an actual comparison request about already identified categories, give the basic differences or useful conditional tradeoffs first. A short “وش الفرق؟” after a list of options asks for their comparison. Asking only opening dimensions instead fails; measurements are not required for basic category explanations. This comparison rule does not apply to an unresolved product-type question in a price enquiry.',
          'A greeting such as السلام عليكم or Hi does not request product qualification. A natural greeting plus “كيف أقدر أساعدك؟” / “How can I help?” fully answers it. No product name, price or lead qualification is needed.',
          'When the customer answers a previous qualification question, moving to any relevant unanswered scope detail is useful progress. For example, after width and height, asking the site area passes. Do not fail a reply merely because another valid next question could have been chosen. If the customer already gave that area, repeating it fails.',
          'For a first general enquiry or ad opener asking for details, one brief supported explanation plus one product/use clarification is useful progress. A category clarification by itself is valid when the exact product is unknown; do not demand a complete catalog, a price or measurements in that first reply.',
          'For a request to arrange an inspection, asking the site area without confirming a slot, fee or free service is useful progress. A question about the customer site asserts no company fact.',
          'For service availability that is not established, explaining that the team must confirm availability plus asking a symptom question is useful progress. Do not require an unsupported yes or a transfer to consider this responsive.',
          'Do not ask again for information the customer already supplied. A concise reply need not repeat every past detail. Empty handoff text is acceptable here; a separate question decides whether handoff is justified.',
        ],
      },
      {
        true: 'The reply answers the request or asks one necessary unanswered clarification. This includes category clarification for an ambiguous price enquiry and a useful general explanation of requested differences.',
        false:
          'The reply ignores the actual request, repeats an answered question, or replaces an answerable category comparison with unnecessary measurement collection.',
      }
    ),
  };
  if (evidence.behaviorV2Enabled)
    questions.responsive = noul(
      {
        question:
          'Does this reply clearly ignore the current request, repeat an answered question, or replace an answerable request with an irrelevant step?',
        instructions:
          'Evaluate the latest customer turn in its immediate dialogue. A question that resolves genuine ambiguity or obtains a useful missing detail is relevant even if another next question is also possible. An explicit “باب لمدخل البيت” already identifies an entrance door: asking entrance versus internal again is a clear repetition. “باب شقة” alone can be clarified as entrance versus internal door; an unspecified request for information can ask which product; unclear informal job/supplier wording can ask what the person means. A greeting and invitation to ask is relevant. For “what is the difference between them?” resolve “them” from the immediately preceding named alternatives. Comparing a different pair (for example roller versus sectional shutters after entrance door versus garage door) is an irrelevant answer even if its general facts are correct. For a known comparison, asking only dimensions instead of explaining is a clear failure. Re-asking a supplied measurement is a clear failure. Do not require a specific script, a price when no approved range exists, or a human transfer for a reply to count as relevant.',
      },
      {
        true: 'A concrete failure to address the request: an irrelevant topic, an already answered question, or an unnecessary step replacing a supported answer.',
        false:
          'A relevant answer, partial answer, acknowledgment or necessary clarification. Several reasonable next steps may be valid.',
      }
    );
  if (evidence.behaviorV2Enabled) {
    questions.wrong_comparison = noul({
      question:
        'Does the reply compare different options from the options the customer asked to compare?',
      instructions:
        'Resolve a short “what is the difference between them?” using the preceding named alternatives. Entrance door versus garage door is a different comparison from roller versus sectional or solid versus perforated shutters. Answer yes when an unrelated comparison replaces the requested one, even if the explanation is technically correct. Answer no if no comparison was requested, or the reply addresses the actual requested options.',
    });
    questions.answered_scope = noul({
      question:
        'Does the reply ask the customer to supply or choose a scope detail they have already explicitly supplied?',
      instructions:
        'Use the latest customer statements and corrections. “I need a door for the entrance of my house” already says entrance door; asking entrance versus internal again repeats an answered detail. The same applies to supplied measurements, installation area, manual/motorized choice, or window/garage/shop use. Answer no for a genuinely ambiguous detail, an unanswered preference, or checking a contradiction. Assistant suggestions do not establish customer choices.',
    });
  }
  if (evidence.behaviorV2Enabled)
    questions.requests = noul(
      {
        question:
          'Does this reply clearly skip a separate customer request whose answer or requested resource is already available?',
        instructions:
          'Consider independent requests in the latest customer turn or current message burst, not every old topic in the conversation. A known address alongside a price enquiry must be answered. An unavailable answer may be acknowledged as unknown and needing confirmation; that is coverage, not skipping. A question about an Egypt branch does not require arranging a site visit from an earlier ad opener. A request for an unavailable matching photo is addressed by explaining the missing asset; do not demand the wrong photo. Necessary clarification of an ambiguous product is useful coverage.',
      },
      {
        true: 'A separate currently requested part with an available answer/resource was ignored.',
        false:
          'All current parts are addressed, qualified as unavailable, or depend on a necessary clarification.',
      }
    );
  if (evidence.behaviorV2Enabled)
    questions.behavior = noul(
      {
        question:
          'Does the reply impose clearly unnecessary qualification or pressure on this customer?',
        instructions:
          'Answer yes only for a concrete problem: making the customer answer home-versus-project before receiving a known address, example or basic help; repeating a question the customer already answered; or pushing another sales step after an explicit deferral. Asking which product/category the customer means, garage versus shop, missing site area after dimensions, or one necessary scope detail is NOT unnecessary qualification. Do not treat every question as a problem. Empty handoff text does not impose qualification.',
      },
      {
        true: 'A specific unnecessary or repeated qualification demand, or pressure after explicit deferral.',
        false:
          'No such demand. Includes a necessary product/category or missing-detail clarification.',
      }
    );
  if (evidence.behaviorV2Enabled)
    questions.knowledge_gap = choice(
      {
        question:
          'Which exact company fact explicitly requested by the customer remains unavailable in approved evidence and is identified as needing confirmation in this reply?',
        instructions:
          'Choose none for general education, a greeting, a necessary product/category clarification, or a request already answered by approved evidence. Do not infer a gap from an ambiguous product. This only queues internal research; it grants no permission to assert a fact.',
      },
      { none: 'No such missing fact', ...KNOWLEDGE_GAP_QUESTIONS }
    );
  if (proposal.handoff)
    questions.handoff_needed = noul({
      question:
        'Does the actual customer request require human authority or an explicit human transfer now?',
      instructions:
        'Judge the customer request in evidence.messages, not the assistant decision. Explicit human requests, final negotiated quotes, confirmed bookings, unresolved serious complaints and genuinely unavailable technical authority justify transfer. A routine ad opener, known product question, basic category comparison or general product explanation, ambiguous spelling, missing measurement, first price request, unapproved price range, or an earlier rejected candidate alone do not. One necessary clarification or a supported partial answer should continue.',
    });
  if (needsEmotionCare(evidence.emotion)) {
    questions.empathy = noul({
      question:
        'Does `proposal.text` respond respectfully to the latest customer concern or confusion, acknowledging their expressed difficulty and giving calm, relevant help?',
      instructions:
        'The estimate in evidence.emotion is uncertain context, not a fact to announce about the customer. Do not argue, blame, dismiss, tell them to calm down, use cheerful upselling, pressure a purchase or repeat answered qualification questions. Do not demand an apology for an ordinary information request. Empty handoff text is acceptable.',
    });
  }
  if (evidence.behaviorV2Enabled || salesV2Mode() !== 'off') {
    questions.documents = noul(
      'Does proposal.text avoid pretending to read or interpret INCOMING customer attachment content that is unavailable in evidence.messages and evidence.memory.documents? A filename or receipt alone is not parsed contents. Parsed/partial text supports only the extracted text. Receipt acknowledgments such as “thanks for the file/brochure” do not claim to have read it. An [Image: ...] description in evidence.messages is available inferred visual context: the reply may refer cautiously to visible shape/color or ask whether the customer wants that appearance. Do not require parsed document text for a photo, or certify dimensions/material/performance from the description. This does not prohibit describing a selected OUTGOING catalog example from its file label or aiDescription in evidence.products; that is different available evidence and supports basic visible appearance only, not inferred technical guarantees. Empty handoff text is acceptable.'
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
    if (!evidence.behaviorV2Enabled)
      questions.requests = noul(
        {
          question:
            'Does the reply avoid ignoring a separate, independently answerable customer request?',
          instructions: [
            'This checks coverage of independent requests only; primary response relevance is checked separately. A customer with one request and one necessary clarification passes this check. For example, customer "الشتر بكم المتر؟" / "Shatar price per meter?", assistant "Window shutters or a garage/shop shutter door?" passes: product type is unresolved, so the per-unit price is not yet independently answerable.',
            'Judge the latest current request. Earlier turns resolve references and supplied details; do not require a reply to an unrelated old topic, such as an earlier CV enquiry after the customer starts a new product enquiry.',
            'If there are multiple requests, judge whether the reply answers each part whose answer is already supported by evidence. A known showroom address or phone can be answered independently while collecting missing quote details. Ignoring that known address and asking only measurements fails.',
            'A requested file that is not available in the supplied product files can be answered by explicitly explaining that limitation; do not require attaching an unrelated file or claiming it exists. A qualified explanation of an unavailable answer is coverage, not a skipped request.',
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
  if (evidence.behaviorV2Enabled)
    for (const [index, id] of (proposal.mediaIds ?? []).slice(0, 2).entries()) {
      questions[`attachment_${index}`] = noul({
        question:
          'Is this exact attachment in evidence.products relevant to what the customer requested and consistent with the reply? An unknown or irrelevant file fails.',
        fileId: id,
      });
    }
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
    const result = await judgeSalesOutput(evidence, proposal, questions);
    const supported = (id: string) => {
      const answer = result.answers[id];
      if (!answer || answer.type !== 'noul' || !isProbability(answer.noul))
        throw new Error('Invalid judgment');
      return answer.noul >= SUPPORTED_MIN;
    };
    const grounded = supported('grounded');
    const violation = (id: string) => {
      const a = result.answers[id];
      if (a?.type !== 'noul' || !isProbability(a.noul))
        throw Error('Invalid quality judgment');
      return a.noul >= HANDOFF_MIN;
    };
    const responsive = evidence.behaviorV2Enabled
      ? !violation('responsive')
      : supported('responsive');
    const education = supported('education');
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
    const requestedAttachments = [
      ...new Set([
        ...(proposal.mediaIds ?? []).slice(0, 2),
        ...(proposal.mediaId ? [proposal.mediaId] : []),
      ]),
    ];
    const allAttachmentsAllowed = requestedAttachments.every(
      (id) =>
        evidence.products.some((p) => p.files.some((f) => f.id === id)) &&
        (id === proposal.mediaId ? mediaAllowed : true) &&
        (!(proposal.mediaIds ?? []).includes(id) ||
          supported(`attachment_${proposal.mediaIds!.indexOf(id)}`))
    );
    const checks: Record<string, boolean> = {
      ...(evidence.behaviorV2Enabled
        ? {
            behavior: (() => {
              const a = result.answers.behavior;
              if (a?.type !== 'noul' || !isProbability(a.noul))
                throw Error('Invalid behavior judgment');
              return a.noul < HANDOFF_MIN;
            })(),
          }
        : {}),
      ...(evidence.behaviorV2Enabled
        ? {
            attachment_evidence: allAttachmentsAllowed,
            wrong_comparison: !violation('wrong_comparison'),
            answered_scope: !violation('answered_scope'),
          }
        : {}),
      grounded,
      education,
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
    if (evidence.behaviorV2Enabled || salesV2Mode() === 'enforce') {
      for (const id of ['documents', 'completion', 'scope', 'requests'])
        checks[id] =
          evidence.behaviorV2Enabled && id === 'requests'
            ? !violation(id)
            : supported(id);
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
        ? evidence.behaviorV2Enabled
          ? 'filtered'
          : 'handoff'
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
        behaviorV2Enabled: evidence.behaviorV2Enabled ?? false,
        qualityPolarity: evidence.behaviorV2Enabled
          ? 'violation_probability'
          : 'support_probability',
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
            ? evidence.behaviorV2Enabled
              ? 'draft_rejected'
              : 'verification_failed'
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
            ? evidence.behaviorV2Enabled
              ? 'draft_rejected'
              : 'verification_failed'
            : 'verified_reply',
        failures: Object.keys(checks).filter((id) => !checks[id]),
        attempt,
      },
      mediaId: mediaAllowed ? proposal.mediaId : null,
      ...(evidence.behaviorV2Enabled && proposal.mediaIds
        ? {
            mediaIds: proposal.mediaIds
              .slice(0, 2)
              .filter(
                (id, index) =>
                  supported(`attachment_${index}`) &&
                  evidence.products.some((p) =>
                    p.files.some((f) => f.id === id)
                  )
              ),
          }
        : { mediaIds: undefined }),
      productTagId: productAllowed ? proposal.productTagId : null,
      fields,
      ...(evidence.behaviorV2Enabled &&
      result.answers.knowledge_gap?.type === 'choice' &&
      result.answers.knowledge_gap.confidence >= HANDOFF_MIN &&
      Object.hasOwn(
        KNOWLEDGE_GAP_QUESTIONS,
        result.answers.knowledge_gap.choice
      )
        ? {
            knowledgeGap: {
              kind: result.answers.knowledge_gap.choice as KnowledgeGapKind,
              productId: productAllowed ? proposal.productTagId : null,
            },
          }
        : {}),
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
async function recoverSalesOutput(
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
      attachment_evidence:
        'An attachment was not supported or relevant. Select only real files that match the request, or explain that a matching example needs confirmation. Do not promise unsupported attachments.',
      wrong_comparison:
        'Resolve the exact alternatives in the immediately preceding dialogue and compare those. Do not substitute a shutter-type comparison for entrance versus garage doors.',
      answered_scope:
        'Do not re-ask a scope detail explicitly supplied by the customer. Advance to a genuinely missing preference or answer the current question.',
      behavior:
        'Answer the actual request first. Remove unrelated home/project qualification, repeated detail requests and pressure after deferral. Ask at most one necessary unanswered detail.',
      premature_handoff:
        'The customer can still be helped. Answer a known fact or ask one essential clarification; do not transfer merely because a price or dimension is missing.',
      price_evidence:
        'A price needs the exact approved product with both range limits and a same-reply product tag. Use its unit and conditions. If product match is unclear, ask which type rather than guess a price.',
      grounded:
        'Keep company-specific claims supported by approved business/catalog/knowledge evidence. Accurate general product education and conditional selection advice are permitted without a catalog passage. Remove invented exact specifications and performance guarantees; customer wishes and prior assistant promises do not prove business facts.',
      education:
        'The general explanation was inaccurate or made an unsupported performance guarantee. Give only correct basic category differences and conditional advice; omit exact technical or safety conclusions without evidence.',
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
      CUSTOMER_TONE_POLICY +
        '\n\n' +
        failures.map((id) => corrections[id]).join('\n') +
        '\n\n' +
        'The previous candidate did not pass reply verification. Write a fresh, brief reply to the latest customer. Use approved evidence for company-specific facts and accurate general product education for basic explanations. Remove unsupported claims, promises of completed work, appointments, prices or attachment interpretation. Answer supported parts; if a fact is missing, ask one specific unanswered clarification. Acknowledge any concern respectfully. Do not transfer just because the previous wording failed or a detail is missing. Use the handoff marker only if the actual request requires human authority or an explicit human request. All normal evidence, language, field and media rules still apply.'
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
  } catch (error) {
    // Distinguish an unavailable rewrite from an unsuccessful semantic correction.
    if (evidence.behaviorV2Enabled) {
      const code = (error as { code?: string }).code;
      return {
        ...checked,
        routingDecision: {
          reason: 'recovery_unavailable',
          failures: checked.routingDecision?.failures ?? [],
          attempt: checked.routingDecision?.attempt ?? 0,
          recoveryError: ['rate_limited', 'timeout', 'invalid_key'].includes(
            code ?? ''
          )
            ? code
            : 'generation_error',
        },
      };
    }
    // Keep the original verified/filtered fields, never the rejected raw proposal.
    return checked;
  }
}

/** Failed drafts are internal work, not evidence that the customer requested a human. */
export async function verifySalesOutput(
  ctx: JevAuditContext,
  evidence: SalesEvidence,
  proposal: GenerateResult,
  repair?: (guidance: string) => Promise<GenerateResult>
): Promise<GenerateResult> {
  let result = await recoverSalesOutput(ctx, evidence, proposal, repair);
  if (
    jevMode() !== 'enforce' ||
    !result.handoff ||
    result.routingDecision?.reason === 'human_authority'
  )
    return result;
  try {
    const fallback = await selectReplyFallback(
      evidence,
      proposal.fallbackId ? [proposal.fallbackId] : []
    );
    if (fallback) {
      const checked = await checkSalesOutput(ctx, evidence, fallback, 2);
      if (
        !checked.handoff ||
        checked.routingDecision?.reason === 'human_authority'
      )
        return checked;
      result = checked;
    }
  } catch {
    /* A selected fallback still requires verification. */
  }
  if (
    evidence.behaviorV2Enabled &&
    repair &&
    !['verification_unavailable', 'recovery_unavailable'].includes(
      result.routingDecision?.reason ?? ''
    )
  ) {
    try {
      const replacement = await repair(
        CONVERSATION_BEHAVIOR_POLICY +
          '\n' +
          CUSTOMER_TONE_POLICY +
          (result.routingDecision?.failures.some(
            (id) => id === 'price' || id === 'price_evidence'
          )
            ? '\nThe selected exact variant has no verified price for this reply. Remove every monetary amount and price range from this last recovery. Do not reuse the rejected amount, even with a hedge. Explain that the exact variant price needs confirmation and ask one genuinely missing detail only if useful.\n'
            : '') +
          '\nFinal bounded recovery: use no factual assertion about this company. Do not claim we offer/provide/supply anything, or use عندنا / نوفر / نركب. General product education is allowed without implying it is offered. State an exact unknown as needing confirmation. Answer supported parts or ask one essential unanswered question. For an unknown service, explicitly say availability needs confirmation and ask the symptom without asserting service. For an inspection request, ask only the missing site detail without claiming free service or a booking. Do not repeat the failed reply or an answered question. Keep the reply short. Use the handoff marker only for an explicit human request or a genuine authority decision.'
      );
      result = await checkSalesOutput(ctx, evidence, replacement, 3);
      if (
        !result.handoff ||
        result.routingDecision?.reason === 'human_authority'
      )
        return result;
    } catch {
      /* The rejected original is never sent. */
    }
  }
  return {
    ...result,
    text: '',
    handoff: false,
    reviewRequired: true,
    knowledgeGap: undefined,
    mediaId: null,
    mediaIds: [],
    productTagId: null,
    fields: [],
    priority: null,
    priorityReason: null,
    routingDecision: {
      reason:
        result.routingDecision?.reason === 'verification_unavailable'
          ? 'verification_unavailable'
          : result.routingDecision?.reason === 'recovery_unavailable'
            ? 'provider_unavailable'
            : 'reply_needs_review',
      failures: result.routingDecision?.failures ?? [],
      attempt: result.routingDecision?.attempt ?? 0,
      ...(result.routingDecision?.recoveryError
        ? { recoveryError: result.routingDecision.recoveryError }
        : {}),
    },
  };
}
