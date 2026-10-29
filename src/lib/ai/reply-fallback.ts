import { choice } from '@typesafe-ai/sdk';
import { askJev } from './typesafe/client';
import type { SalesEvidence } from './typesafe/sales';
import type { GenerateResult } from './types';
import { customerLanguageScript } from './query';
import { languageScript } from './defaults';
interface Candidate {
  text: string;
  mediaId?: string;
  productTagId?: string;
  handoff?: boolean;
}
/** Closed-set selection of reviewed wording/source excerpts. It never sends or approves itself. */
export async function selectReplyFallback(
  evidence: SalesEvidence,
  exclude: string[] = []
): Promise<GenerateResult | null> {
  const ar = customerLanguageScript(evidence.messages) !== 'latin';
  const candidates: Record<string, Candidate> = {
    greeting: { text: ar ? 'هلا، كيف أقدر أساعدك؟' : 'Hi, how can I help?' },
    product: {
      text: ar
        ? 'أي منتج تقصد؟ تقدر تكتب اسمه أو ترسل صورته.'
        : 'Which product do you mean? You can send its name or a photo.',
    },
    shutter_type: {
      text: ar
        ? 'تقصد شتر للنوافذ أو باب شتر لكراج أو محل؟'
        : 'Do you mean window shutters, or a shutter door for a garage or shop?',
    },
    glazing_type: {
      text: ar ? 'تحتاج نوافذ أو أبواب؟' : 'Do you need windows or doors?',
    },
    supplier_clarify: {
      text: ar
        ? 'تقصد إنك تعرض خدمة أو تبحث عن خدمة تحتاجها؟'
        : 'Are you offering a service, or looking for someone to do the work?',
    },
    door_type: {
      text: ar
        ? 'تقصد باب مدخل أو باب داخلي؟'
        : 'Do you mean an entrance door or an internal door?',
    },
    dimensions: {
      text: ar
        ? 'كم عرض المدخل وارتفاعه، ولو بشكل تقريبي؟'
        : 'What is the opening width and height, even approximately?',
    },
    area: {
      text: ar
        ? 'في أي منطقة بيكون التركيب؟'
        : 'Which area is the installation in?',
    },
    repair: {
      text: ar
        ? 'توفر خدمة الصيانة يحتاج تأكيد من الفريق. وش المشكلة اللي تواجهك؟'
        : 'The team needs to confirm repair availability. What problem are you having?',
    },
    price_unknown: {
      text: ar
        ? 'سعر هالنوع يحتاج تأكيد من الفريق قبل إعطاء رقم.'
        : 'The price for this exact type needs confirmation from the team before giving a number.',
    },
    exact_unknown: {
      text: ar
        ? 'هالتفصيل يحتاج تأكيد من الفريق؛ ما عندي معلومة معتمدة أقدر أجزم بها.'
        : 'That detail needs confirmation from the team; I don’t have an approved answer for it.',
    },
    missing_photo: {
      text: ar
        ? 'ما عندي صورة مطابقة لهالنوع متاحة للإرسال هنا.'
        : 'I don’t have a matching example for that type available to attach here.',
    },
    missing_document: {
      text: ar
        ? 'ما عندي ملف مطابق لهالطلب متاح للإرسال هنا.'
        : 'I don’t have a matching document available to attach here.',
    },
    attachment: {
      text: ar
        ? 'وصل المرفق، لكن محتواه ما ظهر عندي. اكتب لي باختصار وش تحتاج فيه.'
        : 'The attachment arrived, but its contents aren’t available to me. Please describe briefly what you need help with.',
    },
    defer: { text: ar ? 'خذ راحتك.' : 'Take your time.' },
    unclear: {
      text: ar
        ? 'ممكن توضح لي طلبك بكلمتين؟'
        : 'Could you briefly clarify what you need?',
    },
    comparison: {
      text: ar
        ? 'المصمت ما يبيّن اللي داخل، والمخرم يبيّن جزء حسب التخريم، والشفاف يخلي المعروضات تبين والباب مسكّر.'
        : 'Solid shutters block views, perforated shutters allow partial visibility depending on the openings, and transparent shutters keep displays visible while closed.',
    },
    safety: {
      text: ar
        ? 'الأمان والتصنيف ما يتأكدون من اسم النوع وحده؛ يحتاجون مراجعة النظام المحدد ووثائقه.'
        : 'Safety and performance ratings cannot be confirmed from the category name alone; the exact system and its documentation need review.',
    },
    transfer: { text: '', handoff: true },
  };
  const facts = (evidence.businessContext ?? '')
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);
  for (const [i, fact] of facts.entries()) {
    const script = languageScript(fact);
    if (script === 'mixed' || script === (ar ? 'arabic' : 'latin'))
      candidates['company_' + i] = { text: fact };
  }
  for (const [i, m] of [
    ...(evidence.businessContext ?? '').matchAll(/\+\d[\d ()-]{7,}\d/g),
  ].entries())
    candidates['phone_' + i] = {
      text: (ar ? 'رقم التواصل: ' : 'Contact number: ') + m[0],
    };
  for (const [i, m] of [
    ...(evidence.businessContext ?? '').matchAll(/https?:\/\/[^\s]+/g),
  ].entries())
    candidates['website_' + i] = {
      text:
        (ar ? 'موقع الشركة: ' : 'Company website: ') +
        m[0].replace(/[.,]$/, ''),
    };
  for (const [i, p] of evidence.products.entries()) {
    const parts = p.name.split('·').map((part) => part.trim());
    const localName = parts.find((part) =>
      ar ? /[\u0600-\u06ff]/.test(part) : /^[^\u0600-\u06ff]*[a-z]/i.test(part)
    );
    if (localName && (!p.catalog || p.catalog.status === 'approved'))
      candidates['availability_' + i] = {
        text: ar
          ? `نعم، نوفر ${localName}. وش تبي تعرف؟`
          : `Yes, we offer ${localName}. What would you like to know?`,
      };
    candidates['unknown_price_' + i] = {
      text: ar
        ? 'السعر الخاص بهالنوع يحتاج تأكيد من الفريق.'
        : 'The price for this exact type needs confirmation from the team.',
      productTagId: p.id,
    };
    for (const [j, file] of p.files.slice(0, 3).entries())
      candidates[`media_${i}_${j}`] = {
        text: ar ? 'أقدر أرسل لك هذا المثال.' : 'I can share this example.',
        mediaId: file.id,
      };
    if (p.priceMin != null && p.priceMax != null)
      candidates['price_' + i] = {
        text: ar
          ? `السعر التقديري من ${p.priceMin} إلى ${p.priceMax} ${evidence.currency ?? ''} ${p.priceUnit ?? ''}. ${p.priceNotes ?? ''} السعر النهائي يؤكده الفريق.`
          : `The estimate is ${evidence.currency ?? ''} ${p.priceMin}–${p.priceMax} ${p.priceUnit ?? ''}. ${p.priceNotes ?? ''} The team confirms the final quote.`,
        productTagId: p.id,
      };
  }
  for (const [i, k] of evidence.knowledge
    .filter((k) => k.includes('[knowledge_type=customer_guide]'))
    .entries()) {
    for (const heading of ['Explain simply', 'Compare options']) {
      const section = k.split('## ' + heading + '\n')[1]?.split('\n## ')[0];
      if (!section) continue;
      const paragraphs = section
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter((p) => p && !p.startsWith('##'));
      const text = paragraphs.find(
        (p) => languageScript(p) === (ar ? 'arabic' : 'latin')
      );
      if (text) candidates[`guide_${i}_${heading}`] = { text };
    }
  }
  if (evidence.intent === 'product')
    for (const id of Object.keys(candidates))
      if (id.startsWith('price_') || id.startsWith('unknown_price_'))
        delete candidates[id];
  if (evidence.intent === 'supplier')
    for (const id of Object.keys(candidates))
      if (
        !id.startsWith('company_') &&
        !id.startsWith('phone_') &&
        !id.startsWith('website_') &&
        !['supplier_clarify', 'unclear', 'attachment', 'transfer'].includes(id)
      )
        delete candidates[id];
  for (const [id, candidate] of Object.entries(candidates))
    if (/\[\[|\]\]/.test(candidate.text)) delete candidates[id];
  for (const id of exclude) delete candidates[id];
  const { answers } = await askJev(
    {
      currentCustomerRequest: [...evidence.messages]
        .reverse()
        .find((m) => m.role === 'user')?.content,
      currentIntent: evidence.intent ?? 'uncertain',
      recentDialogue: evidence.messages.slice(-8),
      memory: evidence.memory,
      companyFacts: evidence.businessContext,
      products: evidence.products.map((p) => ({
        id: p.id,
        name: p.name,
        priceMin: p.priceMin,
        priceMax: p.priceMax,
        priceNotes: p.priceNotes,
        files: p.files,
      })),
      candidates,
    },
    {
      candidate: choice(
        {
          question:
            'Select the candidate that best helps with currentCustomerRequest now. Earlier dialogue only resolves its references. Do not answer an older ad opener instead of the latest real request. Choose none if no candidate is useful and accurate in context.',
          instructions:
            'For a basic availability question, prefer an availability candidate naming the matching approved product. Those candidates confirm an offering, not stock, an exact variant, or every family configuration. Do not answer a comparison, technical or price question with a generic availability statement. Do not use a price-unknown response when no price was requested. For a short comparison follow-up, resolve the exact alternatives from the preceding assistant/customer turn; never choose a guide comparing different categories. An explicit entrance-door request has already answered entrance versus internal: do not choose door_type again. Use unclear for garbled or ambiguous trade/worker messages; never guess shutters from an old advertisement. A company-profile document request requires a matching document candidate or missing_document, not an office fact. A question about an unconfirmed overseas branch requires exact_unknown, not the known local office address. A necessary unanswered clarification is useful. Do not repeat an answered question. Answer a known company question directly when a matching fact candidate exists. A general comparison must match the requested categories. A price candidate requires the exact customer product/variant and every condition; do not borrow a price for manual or another variant. An asset must match the requested product and kind. Acknowledge a genuine unknown when no approved answer exists. Choose transfer only for explicit human requests or actual human authority needed now. Choose none rather than force an unrelated answer.',
        },
        {
          none: 'No useful supported candidate',
          ...Object.fromEntries(
            Object.entries(candidates).map(([id, c]) => [
              id,
              c.text || 'Transfer the request to staff',
            ])
          ),
        }
      ),
    }
  );
  const answer = answers.candidate;
  if (answer.type !== 'choice' || !Object.hasOwn(candidates, answer.choice))
    return null;
  const selected = candidates[answer.choice];
  return {
    text: selected.text,
    handoff: selected.handoff ?? false,
    mediaId: selected.mediaId ?? null,
    productTagId: selected.productTagId ?? null,
    fields: [],
    priority: null,
    priorityReason: null,
    usage: null,
    fallbackId: answer.choice,
  };
}
