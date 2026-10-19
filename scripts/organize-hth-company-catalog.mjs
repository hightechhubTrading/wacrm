/** One-time, account-scoped organization of HTH's company-supplied catalog.
 * Default is a dry run. --apply writes one transaction through the linked CLI.
 * No prices, customer threads, WhatsApp sends or media associations are created/deleted.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

process.loadEnvFile('.env.local');
const accountId = '21e37548-cb15-46e6-8556-510f47a538be';
const ids = {
  window: 'b281fe23-26af-4509-a01c-cbb8546c6e22',
  shop: 'a1125167-5117-49a7-a1f5-2efc9633dec9',
  garage: 'eb501fd1-e022-4b39-8010-764fd8b863c9',
};
const marker = '[company-catalog-organized-2026-10-18]';
const linked = fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim();
if (
  !new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.startsWith(
    linked + '.'
  )
)
  throw Error('Linked database does not match app environment.');
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const { data: products, error } = await db
  .from('ai_products')
  .select('*,ai_product_media(*)')
  .eq('account_id', accountId);
if (error) throw Error(error.message);
const original = Object.fromEntries(
  Object.entries(ids).map(([key, id]) => [
    key,
    products.find((p) => p.id === id),
  ])
);
if (Object.values(original).some((p) => !p))
  throw Error('Expected company catalog entries are missing.');
if (Object.values(original).every((p) => p.source_notes?.includes(marker))) {
  console.log('Company catalog already organized; no changes applied.');
  process.exit(0);
}
const src =
  'المصدر: معلومات الشركة المحفوظة في الكتالوج والصور التي قدمها المستخدم. تنظيم المعلومات بتاريخ 18 أكتوبر 2026. الأسئلة غير المجابة ليست مواصفات معتمدة.';
const commonQuestions = [
  'هل يمكن تزويدنا بسعر استرشادي منفصل لكل نوع، مع العملة ووحدة القياس والحد الأدنى للفوترة؟',
  'ما المشمول في السعر: المحرك، أجهزة التحكم، التركيب، النقل، فك الباب القديم والأعمال الإضافية؟',
  'ما الحد الأدنى والأقصى للعرض والارتفاع لكل نوع؟ وما القياسات المطلوبة قبل إعطاء التقدير؟',
  'هل مدد التنفيذ أيام عمل أم أيام تقويمية؟ ومن أي مرحلة يبدأ احتسابها: العربون أم المقاسات أم اعتماد الطلب؟',
  'هل المدة المذكورة تشمل التصنيع والتوريد والتركيب، أم التركيب فقط؟',
  'ما موديل المحرك وقدرته وخيارات التحكم وطريقة الفتح عند انقطاع الكهرباء لكل نوع؟',
  'ما نطاق الضمان المكتوب والاستثناءات؟ وهل يشمل المحرك والريموت والباب والدهان وأجرة الصيانة؟',
  'ما الملفات أو الصور والمواصفات المعتمدة الخاصة بكل نوع، وما المطلوب للمعاينة وعرض السعر؟',
];
const garageQuestions = [
  'ما المقصود بصافي الارتفاع 260 سم للرول الأسترالي و290 سم للأمريكي: ارتفاع الفتحة المطلوب أم الصافي بعد التركيب أم حد أقصى؟',
  'ما مساحة الرأس والجوانب والعمق المطلوبة لكل نظام؟',
  'في وصف الرول الأسترالي، هل «صنع الصين» تخص المحرك أم نظام الباب كاملاً؟ وما علامة وموديل المحرك؟',
  'هل المقصود بسماكة 4 سم سماكة لوح الباب الأمريكي؟ وما خيارات فتحات الزجاج وتأثيرها على السعر والمدة؟',
  'هل ضمان السنة من تاريخ التركيب ينطبق على النوعين؟ وهل توجد شروط مختلفة لكل نوع؟',
];
const shopQuestions = [
  'ما مواصفات الرول الأسترالي والباب الأمريكي المخصصين للمحلات، وما الفرق عن نسخ الكراجات؟',
  'ما سماكة ومادة الشرائح ونسبة أو نمط التخريم المتاحة لأبواب الحديد المصمتة والمخرمة؟',
  'ما سماكة ومواصفات البولي كربونات، وما خيارات الرؤية والألوان ومتطلبات التركيب؟',
  'هل مدة 10–15 يوماً والضمان سنة من تاريخ التركيب يشملان جميع الأنواع الخمسة؟',
  'ما الألوان القياسية للمصمت والمخرم والبولي كربونات؟ وهل للألوان الخاصة تكلفة أو مدة إضافية؟',
];
const windowQuestions = [
  'ما المقصود بعبارة «الهاندل يضاف 350 ريال إلى سعر المتر المربع»: مبلغ ثابت لكل نافذة أم لكل متر مربع أم للطلب كاملاً؟',
  'هل النطاق المحفوظ 350–380 ريال/م² ينطبق على اليدوي والكهربائي أم تكوين محدد؟ وما المشمول فيه تحديداً؟',
  'هل الحد الأدنى 2 م² يُحسب لكل نافذة أم لكل طلب؟ وما ترتيب العرض والارتفاع في حد اليدوي 200×150 سم؟',
  'ما العلامات والموديلات الفعلية للمحركات الصينية والإيطالية، وما سعر كل محرك وشروط ضمانه؟',
  'ما ضمان الشتر نفسه؟ وهل مدد 8–10 أيام والألوان الخاصة 25–35 يوماً أيام عمل، ومن أي مرحلة تبدأ؟',
];
const questionList = (q) => q.map((v, i) => `${i + 1}. [ ] ${v}`).join('\n');
function notes(old, questions) {
  return `${marker}\n${src}\n\nأسئلة الشركة المفتوحة:\n${questionList(questions)}\n\nالنص الأصلي — محفوظ للمراجعة، وليس مصدراً لحسم النقاط الغامضة:\n${old.description}\n\nملاحظات السعر الأصلية:\n${old.price_notes ?? 'لا توجد'}${old.source_notes ? '\n\nملاحظات المراجعة السابقة:\n' + old.source_notes : ''}`;
}
const entries = [];
function entry(name, kind, parentId, fields = {}, old = null) {
  const existing =
    old ??
    products.find(
      (p) => p.name === name && p.kind === kind && p.parent_id === parentId
    );
  const p = {
    id: existing?.id ?? randomUUID(),
    name,
    kind,
    parent_id: parentId,
    status: existing?.status ?? 'approved',
    description: '',
    aliases: [],
    specifications: '',
    limitations: '',
    source_notes: src,
    source_url: null,
    price_min: null,
    price_max: null,
    price_unit: null,
    price_notes: null,
    tag_id: null,
    tag_label: null,
    created_by: existing?.created_by ?? original.garage.created_by,
    ...fields,
  };
  entries.push({
    row: p,
    expected_updated_at: existing?.updated_at ?? null,
    is_existing: !!existing,
  });
  return p;
}
const doors = entry('أنظمة أبواب الكراجات والمحلات', 'family', null, {
  description:
    'مجموعة أبواب الكراجات والمحلات. يختلف النظام والمواصفات حسب الاستخدام والنوع؛ المنتجات والأنواع الفرعية مستقلة في تسعيرها ومواصفاتها.',
  aliases: ['garage and shop doors', 'أبواب شتر', 'rolling doors'],
  limitations:
    'لا تستخدم سعر شتر النوافذ لهذه المجموعة. لا تُنسب مواصفات نوع إلى نوع آخر.',
});
const windows = entry('أنظمة شتر النوافذ', 'family', null, {
  description:
    'أنظمة شتر النوافذ للخصوصية والتحكم في الضوء، مستقلة عن أبواب الكراجات والمحلات.',
  aliases: ['window shutters', 'شتر نوافذ', 'شتر درايش'],
  limitations:
    'لا تعمم سعر شتر النوافذ أو مواصفاته على أبواب الكراجات أو المحلات.',
});
const garage = entry(
  original.garage.name,
  'product',
  doors.id,
  {
    description:
      'أبواب كراجات لمداخل الفلل، متوفرة بنظام الرول الأسترالي أو النظام الأمريكي. تُؤكد ملاءمة النظام وطريقة التركيب والتجهيزات المطلوبة بعد معاينة الموقع.',
    aliases: ['garage door', 'garage shutters', 'باب كراج', 'باب كراج فيلا'],
    specifications:
      'الأنواع: رول أسترالي، وأبواب أمريكية.\nتذكر الشركة ضماناً لمدة سنة من تاريخ التركيب؛ تؤكد شروط التغطية ونطاقها للطلب قبل الاعتماد.',
    limitations:
      'لا يوجد سعر استرشادي معتمد في هذا السجل. أجب عن المعلومات المتاحة، وحدد النوع المطلوب واجمع التفصيل الضروري التالي دون اختراع سعر أو نقل سعر شتر النوافذ. لا تفسر 260/290 سم كحدود تركيب مؤكدة قبل توضيح المقصود. مدد التنفيذ تقديرية وليست موعداً محجوزاً. لا تعمم مواصفات نوع على الآخر.',
    source_notes: notes(original.garage, garageQuestions),
    price_min: original.garage.price_min,
    price_max: original.garage.price_max,
    price_unit: original.garage.price_unit,
    tag_id: original.garage.tag_id,
    tag_label: original.garage.tag_label,
  },
  original.garage
);
const shop = entry(
  original.shop.name,
  'product',
  doors.id,
  {
    description:
      'أبواب إغلاق للمحلات التجارية، متوفرة بالرول الأسترالي، والأبواب الأمريكية، وشرائح الحديد المصمتة أو المخرمة، والبولي كربونات الشفاف. تُراجع المقاسات وطريقة التركيب والتجهيزات المطلوبة في الموقع.',
    aliases: ['shop shutter', 'shop doors', 'أبواب محلات', 'شتر محل'],
    specifications:
      'الأنواع المذكورة من الشركة: رول أسترالي، أمريكي، حديد مصمت، حديد مخرم، بولي كربونات شفاف.\nتذكر الشركة مدة تركيب استرشادية 10–15 يوماً وضمان سنة من تاريخ التركيب؛ يلزم تأكيد انطباقهما على النوع المطلوب وشروطهما.',
    limitations:
      'لا توجد أسعار استرشادية معتمدة هنا. لا تنقل سعر شتر النوافذ. لا تفسر «كل المقاسات» على أنها دعم أبعاد غير محدودة؛ الفريق يؤكد ملاءمة المقاس. لا تفترض أن مواصفات المحرك أو اللون مشتركة بين جميع الأنواع. مدة 10–15 يوماً غير ملزمة قبل تأكيد بدء المدة ونطاق الطلب.',
    source_notes: notes(original.shop, shopQuestions),
    price_min: original.shop.price_min,
    price_max: original.shop.price_max,
    price_unit: original.shop.price_unit,
    tag_id: original.shop.tag_id,
    tag_label: original.shop.tag_label,
  },
  original.shop
);
entry(
  original.window.name,
  'product',
  windows.id,
  {
    description:
      'شتر ألمنيوم خارجي للنوافذ في الكبائن والفلل والواجهات. يتوفر تشغيل كهربائي بمحرك وريموت، وتشغيل يدوي للمقاسات الصغيرة. هذا المنتج لشتر النوافذ وليس أبواب الكراجات أو المحلات.',
    aliases: [
      'window shutter',
      'aluminium window shutters',
      'شتر نوافذ',
      'شتر درايش',
      'شتر كبائن',
    ],
    specifications:
      'الألوان الأساسية المذكورة: أبيض وبيج، وألوان خاصة حسب الطلب.\nالتركيب من الخارج. التشغيل الكهربائي يحتاج نقطة كهرباء قرب النافذة.\nخيارات المحركات المذكورة: صيني أو إيطالي؛ العلامة والموديل يلزمهما تأكيد.\nالحد المذكور للتشغيل اليدوي: 200×150 سم؛ ترتيب العرض والارتفاع يحتاج تأكيداً.\nللنوافذ المقوسة: شرائح ثابتة في الجزء العلوي.\nمدة التركيب الاسترشادية المذكورة: 8–10 أيام، والألوان الخاصة: 25–35 يوماً؛ يتأكد بدء المدة ونطاقها للطلب.',
    limitations:
      'النطاق الاسترشادي لهذا المنتج فقط، وليس سعراً نهائياً أو سعراً لأبواب الكراجات والمحلات. لا تحسب إجمالي عرض سعر. سعر المحرك منفصل. تكلفة الهاندل وشمول النطاق للتشغيل اليدوي غير محسومين؛ اطلب تأكيد الفريق لهذه النقطة دون اختراع مبلغ. مدة التنفيذ وشروط الضمان لا تُضمن قبل التأكيد.',
    source_notes: notes(original.window, windowQuestions),
    price_min: original.window.price_min,
    price_max: original.window.price_max,
    price_unit: original.window.price_unit,
    price_notes:
      'النطاق الاسترشادي المحفوظ: 350–380 ريال قطري لكل متر مربع، والسعر النهائي بعد المعاينة. الحد الأدنى المذكور للفوترة: 2 متر مربع؛ يُؤكد هل ينطبق لكل نافذة أم لكل طلب. سعر المحرك يُضاف منفصلاً حسب الاختيار. لا يشمل هذا البيان تسعيراً معتمداً لتكلفة الهاندل؛ هذه النقطة محفوظة ضمن أسئلة الشركة.',
    tag_id: original.window.tag_id,
    tag_label: original.window.tag_label,
  },
  original.window
);
function variant(
  name,
  parent,
  description,
  specifications,
  limitations,
  questions,
  aliases
) {
  entry(name, 'variant', parent.id, {
    description,
    specifications,
    limitations,
    aliases,
    tag_id: parent.tag_id,
    tag_label: parent.tag_label,
    source_notes: `${marker}\n${src}\nالأصل: ${parent.name} (${parent.id}).\nأسئلة الشركة المفتوحة:\n${questionList(questions)}`,
  });
}
variant(
  'رول أسترالي للكراجات',
  garage,
  'باب كراج بنظام الرول الأسترالي لمداخل الفلل. راجع معاينة الموقع ومتطلبات التركيب قبل اعتماد الطلب.',
  'يتضمن محركاً وجهازَي تحكم عن بُعد وفق معلومات الشركة.\nالألوان المذكورة: الأبيض والبيج.\nمدة التركيب الاسترشادية المذكورة: 6–8 أيام؛ تؤكد للطلب بعد تحديد نطاقه.',
  'لا يوجد سعر معتمد لهذا النوع. لا تنقل مواصفات أو سعر النظام الأمريكي أو شتر النوافذ. صافي الارتفاع المذكور في المصدر 260 سم يحتاج توضيحاً ولا يستخدم كحد تركيب مؤكد. عبارة «صنع الصين» تحتاج تأكيد ما إذا كانت تخص المحرك أو النظام.',
  garageQuestions,
  ['Australian rolling garage door', 'رول استرالي للكراج', 'باب رول كراج']
);
variant(
  'أبواب أمريكية للكراجات',
  garage,
  'أبواب كراجات بالنظام الأمريكي، مع محرك سنتر وخيار فتحات زجاج حسب الطلب.',
  'المحرك المذكور: LiftMaster أمريكي، بمحرك سنتر وجهازَي تحكم عن بُعد.\nسماكة الشريحة المذكورة: 4 سم، وفق وصف الشركة.\nالألوان المذكورة: الأبيض والبيج.\nفتحات زجاج حسب الطلب.\nمدة التركيب الاسترشادية المذكورة: 10–15 يوماً؛ تؤكد للطلب بعد تحديد نطاقه.',
  'لا يوجد سعر معتمد لهذا النوع. لا تنقل مواصفاته للمحلات أو للرول الأسترالي تلقائياً. صافي الارتفاع المذكور 290 سم يحتاج توضيحاً قبل تقييم ملاءمة الموقع. الموديل الدقيق وتفاصيل اللوح والضمان يؤكدها الفريق.',
  garageQuestions,
  [
    'American garage door',
    'sectional garage door',
    'باب كراج أمريكي',
    'ليفت ماستر للكراج',
  ]
);
variant(
  'رول أسترالي للمحلات',
  shop,
  'نوع من أبواب إغلاق المحلات مذكور في معلومات الشركة باسم الرول الأسترالي.',
  'توفر هذا النوع مذكور من الشركة. التفاصيل الفنية الخاصة بنسخة المحلات لم ترد في النص.',
  'لا تنقل محرك الكراج أو مقاساته أو مدته أو ألوانه لهذا النوع. لا يوجد سعر معتمد، وتؤكد تفاصيل النسخة المطلوبة مع الفريق.',
  shopQuestions,
  ['Australian shop shutter', 'رول استرالي محل']
);
variant(
  'أبواب أمريكية للمحلات',
  shop,
  'نوع من أبواب إغلاق المحلات مذكور في معلومات الشركة باسم الأبواب الأمريكية.',
  'توفر هذا النوع مذكور من الشركة. لم ترد مواصفات منفصلة لنسخة المحلات في النص.',
  'لا تنسب محرك LiftMaster أو سماكة 4 سم أو ارتفاع 290 سم لهذا النوع اعتماداً على وصف الكراجات وحده. لا يوجد سعر معتمد، وتؤكد مواصفات الطلب مع الفريق.',
  shopQuestions,
  ['American shop door', 'باب أمريكي محل']
);
variant(
  'شتر حديد مصمت للمحلات',
  shop,
  'باب إغلاق للمحلات بشرائح حديد مصمتة، مع خيارات لون بدهان حراري حسب طلب العميل.',
  'شرائح حديد مصمتة.\nيمكن اختيار لون بدهان حراري وفق معلومات الشركة.\nمحرك جانبي صيني ومفتاح، وفق وصف الشركة.',
  'لا يوجد سعر معتمد. المقاس وطريقة التركيب والتجهيزات تؤكد بعد المعاينة. لا تعني عبارة «كل المقاسات» أبعاداً غير محدودة. السماكة وموديل المحرك والألوان القياسية لم تحدد.',
  shopQuestions,
  ['solid steel shop shutter', 'شتر صوليد', 'شرائح حديد مصمت']
);
variant(
  'شتر حديد مخرم للمحلات',
  shop,
  'باب إغلاق للمحلات بشرائح حديد مخرمة، وهو خيار مستقل عن الشرائح المصمتة.',
  'توفر شرائح الحديد المخرمة مذكور في معلومات الشركة. لم تفصل الشركة سماكة الشرائح أو نمط التخريم أو التجهيزات الخاصة بهذا الخيار.',
  'لا يوجد سعر معتمد. لا تفترض أن سماكة الشرائح أو المحرك أو الألوان مطابقة للمصمت قبل تأكيد الفريق. المقاس وطريقة التركيب والتجهيزات تؤكد بعد المعاينة.',
  shopQuestions,
  ['perforated shop shutter', 'شتر مخرم', 'شرائح حديد مخرم']
);
variant(
  'شتر بولي كربونات شفاف للمحلات',
  shop,
  'باب إغلاق شفاف من البولي كربونات، للمحلات داخل المولات وخارجها وفق معلومات الشركة.',
  'بولي كربونات شفاف.\nالاستخدام المذكور: محلات داخل المولات وخارجها.\nمحرك جانبي صيني ومفتاح وفق وصف الشركة.',
  'لا يوجد سعر معتمد. لا تفترض سماكة أو تصنيف أمان أو أبعاداً غير محدودة. يتطلب المقاس وطريقة التركيب والتجهيزات تأكيداً من الفريق.',
  shopQuestions,
  ['transparent polycarbonate shutter', 'شتر شفاف', 'بولي كربونات للمحلات']
);
const title = 'أسئلة الشركة المفتوحة — أبواب الكراجات والمحلات وشتر النوافذ';
const { data: documents, error: docError } = await db
  .from('ai_knowledge_documents')
  .select('id,title,updated_at,status')
  .eq('account_id', accountId)
  .eq('title', title);
if (docError) throw Error(docError.message);
const content = `# أسئلة الشركة المفتوحة\n\nالحالة: بانتظار إجابات الشركة. هذا مستند متابعة داخلي، وليس معلومات معتمدة للمساعد.\nالمرجع: معلومات الشركة الموجودة في كتالوج المنتجات بتاريخ 18 أكتوبر 2026.\n\nلكل إجابة: سجل النص المؤكد، والنوع الذي ينطبق عليه، واسم/دور من أكد المعلومة وتاريخها، وأرفق ملف المواصفات أو قائمة الأسعار عند توفرها. بعد المراجعة، انقل الإجابة فقط إلى المنتج أو النوع المناسب.\n\n## أسئلة مشتركة — أولوية التسعير والضمان\n${questionList(commonQuestions)}\n\n## أبواب الكراجات\n${questionList(garageQuestions)}\n\n## أبواب المحلات\n${questionList(shopQuestions)}\n\n## شتر النوافذ\n${questionList(windowQuestions)}\n\n## سجل الإجابات\nلم تُسجل إجابات بعد. اترك الأسئلة مفتوحة حتى يصل تأكيد الشركة.\n`;
const document = {
  id: documents[0]?.id ?? randomUUID(),
  account_id: accountId,
  created_by: original.garage.created_by,
  title,
  content,
  status: 'draft',
  topic: 'product',
  product_id: null,
  source_notes: `${marker}\n${src}\nالمستند مسودة داخلية؛ لا يعتمد أو يفهرس كمعلومات للمساعد قبل استبدال الأسئلة بإجابات مؤكدة.`,
};
console.log(
  JSON.stringify(
    {
      mode: process.argv.includes('--apply') ? 'apply' : 'dry-run',
      existingProductsToOrganize: 3,
      families: 2,
      variants: 7,
      internalQuestionDocument: title,
      openQuestions:
        commonQuestions.length +
        garageQuestions.length +
        shopQuestions.length +
        windowQuestions.length,
      existingMedia: products.reduce(
        (n, p) => n + p.ai_product_media.length,
        0
      ),
      newPrices: 0,
    },
    null,
    2
  )
);
if (!process.argv.includes('--apply')) process.exit(0);
const dir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'wacrm-company-organization-')
);
fs.chmodSync(dir, 0o700);
fs.writeFileSync(
  path.join(dir, 'before.json'),
  JSON.stringify({ products, documents }),
  { mode: 0o600 }
);
fs.writeFileSync(
  path.join(dir, 'plan.json'),
  JSON.stringify({ entries, document }),
  { mode: 0o600 }
);
const literal = (v) =>
  "'" + JSON.stringify(v).replaceAll("'", "''") + "'::jsonb";
const sql = `BEGIN;
DO $organize_company$
DECLARE plan jsonb := ${literal(entries)}; doc jsonb := ${literal(document)}; item jsonb; current_row public.ai_products%ROWTYPE; r public.ai_products%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('${accountId}',77));
 FOR item IN SELECT value FROM jsonb_array_elements(plan) LOOP
  IF (item->>'is_existing')::boolean THEN
   SELECT * INTO current_row FROM public.ai_products WHERE id=(item->'row'->>'id')::uuid AND account_id='${accountId}' FOR UPDATE;
   IF NOT FOUND OR current_row.updated_at IS DISTINCT FROM (item->>'expected_updated_at')::timestamptz THEN RAISE EXCEPTION 'Catalog changed during organization; refresh the plan before retrying'; END IF;
  END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(plan) LOOP
  SELECT * INTO r FROM jsonb_populate_record(NULL::public.ai_products,item->'row');
  IF (item->>'is_existing')::boolean THEN
   UPDATE public.ai_products SET name=r.name,kind=r.kind,parent_id=r.parent_id,status=r.status,description=r.description,aliases=r.aliases,specifications=r.specifications,limitations=r.limitations,source_notes=r.source_notes,source_url=r.source_url,price_notes=r.price_notes
   WHERE id=r.id AND account_id='${accountId}';
  ELSE
   INSERT INTO public.ai_products(id,account_id,created_by,name,kind,parent_id,status,description,aliases,specifications,limitations,source_notes,source_url,price_min,price_max,price_unit,price_notes,tag_id,tag_label)
   VALUES(r.id,'${accountId}',r.created_by,r.name,r.kind,r.parent_id,r.status,r.description,r.aliases,r.specifications,r.limitations,r.source_notes,r.source_url,r.price_min,r.price_max,r.price_unit,r.price_notes,r.tag_id,r.tag_label);
  END IF;
 END LOOP;
 INSERT INTO public.ai_knowledge_documents(id,account_id,created_by,title,content,status,topic,product_id,source_notes)
 VALUES((doc->>'id')::uuid,'${accountId}',(doc->>'created_by')::uuid,doc->>'title',doc->>'content','draft','product',NULL,doc->>'source_notes')
 ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,content=EXCLUDED.content,status='draft',topic='product',source_notes=EXCLUDED.source_notes
 WHERE ai_knowledge_documents.account_id='${accountId}';
END $organize_company$;
COMMIT;`;
const file = path.join(dir, 'apply.sql');
fs.writeFileSync(file, sql, { mode: 0o600 });
const result = spawnSync(
  'supabase',
  ['db', 'query', '--linked', '--file', file],
  { encoding: 'utf8' }
);
if (result.status !== 0)
  throw Error(
    result.stderr || result.stdout || 'Organization transaction failed.'
  );
console.log(
  'Organization transaction committed. Private snapshot and plan:',
  dir
);
