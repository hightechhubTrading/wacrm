import type { GuideSections, GuideProduct } from './customer-guides';
interface GuideTemplate {
  key: string;
  names: string[];
  sections: GuideSections;
  sources?: string[];
}
const both = (en: string, ar: string) => `${en}\n\n${ar}`;
/** Editable educational starting points. No supplier-specific prices, warranties or ratings. */
export const CUSTOMER_GUIDE_TEMPLATES: GuideTemplate[] = [
  {
    key: 'window-shutters',
    names: [
      'Window shutters · شتر النوافذ',
      'أنظمة شتر النوافذ',
      'window shutters',
    ],
    sections: {
      explanation: both(
        'A window shutter is a covering over a window opening. Discuss privacy, light and how the covering is operated separately from the window itself.',
        'شتر النافذة غطاء لفتحة النافذة. نشرح الخصوصية والضوء وطريقة تشغيل الغطاء بشكل منفصل عن النافذة نفسها.'
      ),
      options: both(
        'Manual and motorized describe operation. A rolling shutter gathers above the opening. Window shutters and garage/shop doors serve different openings; their prices and hardware are not interchangeable.',
        'اليدوي والكهربائي يصفان طريقة التشغيل. يتجمع شتر الرول أعلى الفتحة. شتر النوافذ وأبواب الكراجات والمحلات لا تتشارك الأسعار أو التجهيزات تلقائياً.'
      ),
      selection: both(
        'Start with the desired light/privacy control and how often it will be operated. Convenience preferences can guide operation choice; power supply, dimensions and mounting need site-specific checks.',
        'ابدأ بالتحكم المطلوب بالضوء والخصوصية وعدد مرات الاستخدام. الراحة تساعد في اختيار التشغيل، بينما الكهرباء والمقاسات والتثبيت تُراجع للموقع المحدد.'
      ),
      next_question: both(
        'For a first comparison: is your priority privacy, controlling sunlight or convenient operation? Ask dimensions when sizing or estimating is the next step.',
        'للمقارنة الأولى: الأهم عندك الخصوصية، التحكم بالشمس، أو سهولة التشغيل؟ اسأل عن المقاسات عندما تصبح الخطوة التالية تحديد المقاس أو التقدير.'
      ),
      faq: both(
        'Does motorized mean a specific motor brand? No; use the selected product record. What happens during a power cut? The release/backup arrangement depends on the exact system and needs confirmation.',
        'هل الكهربائي يعني علامة محرك محددة؟ لا، تُؤخذ من سجل النوع المختار. ماذا يحدث عند انقطاع الكهرباء؟ تعتمد آلية التحرير أو التشغيل البديل على النظام المحدد وتحتاج تأكيداً.'
      ),
    },
  },
  {
    key: 'rolling-doors',
    names: [
      'Rolling shutter doors · أبواب الشتر',
      'أنظمة أبواب الكراجات والمحلات',
      'garage and shop doors',
      'rolling doors',
    ],
    sections: {
      explanation: both(
        'Garage and shop closure systems cover an access opening. First distinguish the opening’s use, then explain the closure style and desired visibility.',
        'أنظمة إغلاق الكراجات والمحلات تغلق فتحة الدخول. نحدد الاستخدام أولاً ثم نشرح أسلوب الإغلاق والرؤية المطلوبة.'
      ),
      options: both(
        'A rolling door gathers above the opening; a sectional door uses joined panels travelling on guides. For shop shutters, solid surfaces block views, perforations can allow partial visibility, and transparent panels keep displays visible through the closed shutter. These category meanings do not specify motors, ratings or exact construction.',
        'باب الرول يتجمع أعلى الفتحة، والباب السكشن يستخدم ألواحاً مترابطة تتحرك على مسارات. في شتر المحلات، المصمت ما يبيّن اللي داخل، والمخرم يبيّن جزء حسب التخريم، والشفاف يخلّي المعروضات تبين والباب مسكّر. هذه فروق عامة ولا تحدد المحرك أو التصنيفات أو التصنيع الدقيق.'
      ),
      selection: both(
        'Compare visual privacy versus displaying goods for shops. For garages, explain opening motion before checking headroom, side room and interior clearance. Never rank burglary resistance, fire performance or price from the category name alone.',
        'للمحل نقارن الخصوصية البصرية مع إظهار البضاعة. وللكراج نشرح حركة الفتح قبل مراجعة المساحة العلوية والجانبية والداخلية. لا نستنتج مقاومة الاقتحام أو الحريق أو ترتيب الأسعار من اسم النوع.'
      ),
      next_question: both(
        'If the customer already said shop and asks the difference: explain solid, perforated and transparent first, then ask whether privacy or display visibility matters more. For a garage, ask which opening style they are considering.',
        'إذا قال العميل محل وسأل عن الفرق، اشرح المصمت والمخرم والشفاف أولاً ثم اسأل عن أولوية الخصوصية أو إظهار المعروضات. للكراج اسأل عن أسلوب الفتح الذي يفكر فيه.'
      ),
      faq: both(
        'Which is cheapest or strongest? Compare approved, matching specifications and scope; the material/category name alone cannot answer. Do all options use the same motor? No such assumption; check the exact product.',
        'أيها أرخص أو أقوى؟ تُقارن مواصفات ونطاقات معتمدة ومتكافئة؛ اسم المادة أو النوع وحده لا يكفي. هل تستخدم الأنواع نفس المحرك؟ لا نفترض ذلك، بل نراجع النوع المحدد.'
      ),
    },
  },
  {
    key: 'pivot',
    names: ['Pivot doors · الأبواب المحورية', 'pivot doors', 'أبواب محورية'],
    sections: {
      explanation: both(
        'A pivot door rotates about pivot hardware at the top and bottom. This describes how it opens, not the material used to build it.',
        'يدور باب البيفوت حول آلية محورية في الأعلى والأسفل. الاسم يصف طريقة الفتح وليس مادة التصنيع.'
      ),
      options: both(
        'A conventional hinged door opens on side hinges. Pivot systems use a pivot axis. Aluminium, steel and cladding choices describe construction and finish, separately from opening motion; use the exact product for available combinations.',
        'يفتح الباب المفصلي التقليدي على مفصلات جانبية، بينما يستخدم البيفوت محور دوران. الألمنيوم والحديد والكسوة تصف التصنيع والتشطيب بشكل منفصل عن حركة الفتح، ويُراجع المنتج المحدد لمعرفة التركيبات المتاحة.'
      ),
      selection: both(
        'Discuss appearance, desired opening movement and access needs. Door weight, pivot position, clearance, frame and hardware compatibility require the actual design. Do not infer a load capacity or automatic operation from the word pivot.',
        'ناقش الشكل وحركة الفتح واحتياجات الدخول. وزن الباب وموقع المحور والخلوص والإطار وتوافق الآلية تُراجع وفق التصميم الفعلي. لا نستنتج سعة تحمل أو تشغيلاً كهربائياً من اسم بيفوت.'
      ),
      next_question: both(
        'Are you comparing the opening style, or choosing the material/design for an entrance? Ask about the opening and site clearance when checking fit.',
        'تبي تعرف الفرق في طريقة الفتح، أو تختار المادة والتصميم للمدخل؟ نطلب مقاسات الفتحة والخلوص عند مراجعة الملاءمة.'
      ),
      faq: both(
        'Is every pivot door the same thickness or cladding? No; those are configuration-specific. Is a smart lock included? Use the product’s actual inclusions/exclusions. What is the weight limit? Confirm the selected hardware, not a generic family figure.',
        'هل جميع أبواب البيفوت بنفس السماكة أو الكسوة؟ لا، هذه تفاصيل خاصة بالتكوين. هل القفل الذكي مشمول؟ نراجع المشمول والمستثنى في المنتج الفعلي. ما حد الوزن؟ يُؤكد للآلية المختارة وليس برقم عام للعائلة.'
      ),
    },
  },
  {
    key: 'steel',
    names: [
      'Custom steel doors · أبواب الحديد حسب الطلب',
      'steel doors',
      'ابواب حديد',
    ],
    sections: {
      explanation: both(
        'Custom steel doors combine a door leaf, frame, hardware and finish to suit an opening. Material, decorative style and any tested performance are separate choices.',
        'يتكون باب الحديد حسب الطلب من ضلفة وإطار وتجهيزات وتشطيب لفتحة محددة. المادة والزخرفة والأداء المختبر أمور منفصلة.'
      ),
      options: both(
        'Plain and decorative describe appearance. A solid surface blocks views; an open decorative design can have gaps unless another layer closes them. A steel door is not automatically a certified fire door.',
        'السادة والمزخرف يصفان الشكل. السطح المصمت يحجب الرؤية، وقد يحتوي التصميم الزخرفي المفتوح فراغات ما لم تغلقها طبقة أخرى. الباب الحديدي لا يُعد باب حريق معتمداً تلقائياً.'
      ),
      selection: both(
        'Start with use, privacy and the preferred design. Check finish, exposure and hardware against the exact product rather than promising corrosion resistance or security from the material alone.',
        'ابدأ بالاستخدام والخصوصية والتصميم المفضل. راجع التشطيب والتعرض للعوامل والتجهيزات في المنتج المحدد، دون ضمان مقاومة التآكل أو الأمان اعتماداً على المادة فقط.'
      ),
      next_question: both(
        'Is this an entrance, an internal/service door or a gate, and do you prefer a plain or decorative face?',
        'تحتاج باب مدخل، باب داخلي أو خدمة، أو بوابة؟ وتفضّل الشكل سادة أو مزخرف؟'
      ),
      faq: both(
        'Does steel mean fire-rated? No; ask for the exact tested assembly when fire performance is required. Are all finishes or locks included? Only the exact offer/product can establish that.',
        'هل الحديد يعني تصنيف حريق؟ لا، عند طلب أداء حريق نراجع الطقم المختبر المحدد. هل كل التشطيبات والأقفال مشمولة؟ يحدد ذلك المنتج أو العرض الفعلي.'
      ),
    },
  },
  {
    key: 'glazing',
    names: [
      'Aluminium, UPVC & glass · الألمنيوم وUPVC والزجاج',
      'UPVC',
      'يو بي في سي',
    ],
    sections: {
      explanation: both(
        'Window, door and glazing systems combine opening style, frame/profile, glass and hardware. Aluminium and UPVC describe frame materials; glass selection is a separate specification.',
        'تجمع أنظمة النوافذ والأبواب والزجاج بين طريقة الفتح والإطار أو القطاع والزجاج والتجهيزات. الألمنيوم وUPVC يصفان مادة الإطار، واختيار الزجاج مواصفة منفصلة.'
      ),
      options: both(
        'Sliding and hinged describe motion. A fixed glazed panel does not open. Partitions divide spaces, skylights are roof glazing, facades form an exterior glazed face, and shower enclosures surround a shower area. Do not assume one specification suits all these uses.',
        'السحاب والمفصلي يصفان الحركة، واللوح الزجاجي الثابت لا يفتح. الفواصل تقسّم المساحات، والسكاي لايت زجاج بالسقف، والواجهات تشكّل وجهاً خارجياً زجاجياً، وكبائن الشاور تحيط بمنطقة الاستحمام. لا نفترض ملاءمة مواصفة واحدة لكل الاستخدامات.'
      ),
      selection: both(
        'Identify the application, desired opening and visual privacy. Thermal/acoustic targets, safety glazing, dimensions and project requirements need an exact system rather than a blanket material ranking.',
        'حدد الاستخدام وطريقة الفتح والخصوصية البصرية. متطلبات العزل الحراري والصوتي والزجاج المناسب والمقاسات ومتطلبات المشروع تحتاج نظاماً محدداً بدلاً من ترتيب عام للمواد.'
      ),
      next_question: both(
        'Is the request for a window/door, partition, skylight, facade or shower enclosure? If already known, ask about opening style or the main comfort/privacy priority.',
        'تحتاج نافذة أو باب، فاصل، سكاي لايت، واجهة، أو كابينة شاور؟ إذا كان معروفاً اسأل عن طريقة الفتح أو أولوية الراحة والخصوصية.'
      ),
      faq: both(
        'Does UPVC versus aluminium determine all insulation? No; the whole selected frame/glass/installation system matters. Can glass thickness be chosen from a photograph? An exact project specification is needed.',
        'هل تحدد مادة UPVC أو الألمنيوم العزل وحدها؟ لا، يهم نظام الإطار والزجاج والتركيب المختار ككل. هل تُحدد سماكة الزجاج من صورة؟ نحتاج مواصفة المشروع المحددة.'
      ),
    },
  },
  {
    key: 'sliding',
    names: [
      'Automatic sliding glass · الزجاج المنزلق الأوتوماتيكي',
      'automatic sliding glass',
    ],
    sections: {
      explanation: both(
        'An automatic sliding glass entrance moves one or more leaves sideways using an operator and controls. The leaf layout, activation and access-control requirements are separate choices.',
        'يحرك المدخل الزجاجي السحاب الأوتوماتيكي ضلفة أو أكثر جانبياً بواسطة مشغّل وتحكم. توزيع الضلف والتفعيل ومتطلبات التحكم بالدخول خيارات منفصلة.'
      ),
      options: both(
        'Single and double sliding layouts describe how the opening is arranged. A sensor request, access-control input and manual operating mode are different control functions; exact compatibility depends on the selected system.',
        'السحاب المفرد والمزدوج يصفان توزيع الفتحة. التفعيل بالحساس وإشارة التحكم بالدخول ووضع التشغيل اليدوي وظائف مختلفة، ويتوقف التوافق على النظام المختار.'
      ),
      selection: both(
        'Discuss traffic flow, available side space and who should enter. Safety sensors, escape/accessibility requirements, power-cut behavior and exact operator ratings need technical confirmation for the site.',
        'ناقش حركة المرور والمساحة الجانبية ومن يسمح له بالدخول. حساسات الأمان ومتطلبات الخروج وسهولة الوصول والتعامل مع انقطاع الكهرباء وتصنيفات المشغّل تحتاج تأكيداً فنياً للموقع.'
      ),
      next_question: both(
        'Is this a new entrance or automation of an existing opening, and should it open for everyone approaching or only authorized users?',
        'المدخل جديد أو تبي تحوّل مدخل موجود لأوتوماتيك؟ وتبيه يفتح لأي شخص يقترب أو لأشخاص محددين؟'
      ),
      faq: both(
        'Does automatic mean any access system will work? No; confirm compatibility. What happens in a power cut? Confirm the specific operator and configured release/backup arrangement.',
        'هل الأوتوماتيكي يعني التوافق مع أي نظام دخول؟ لا، نؤكد التوافق. ماذا يحدث عند انقطاع الكهرباء؟ نراجع المشغّل المحدد وترتيب التحرير أو التشغيل البديل.'
      ),
    },
  },
  {
    key: 'pergolas',
    names: ['Pergolas & roofs · البرجولات والأسقف', 'pergola', 'برجولا'],
    sections: {
      explanation: both(
        'Pergolas and outdoor roofs organize shade and the character of an outdoor area. The structure, roof movement and side enclosure can be specified separately.',
        'تنظم البرجولات والأسقف الخارجية الظل وطبيعة الجلسة. يمكن تحديد الهيكل وحركة السقف والإغلاق الجانبي بشكل منفصل.'
      ),
      options: both(
        'A louvred roof uses slats that can be positioned in systems designed for that purpose; a retractable roof opens by moving/retracting its covering. Aluminium and WPC describe materials. Guillotine glass moves vertically and describes an enclosure rather than the roof itself.',
        'يستخدم سقف الشرائح ألواحاً يمكن تغيير وضعها في الأنظمة المصممة لذلك، ويفتح السقف القابل للسحب بتحريك أو سحب غطائه. الألمنيوم وWPC يصفان مواد. زجاج الغيوتين يتحرك رأسياً ويصف الإغلاق الجانبي لا السقف نفسه.'
      ),
      selection: both(
        'Start with adjustable shade, an open-sky feeling or enclosure preferences. Rain drainage, wind exposure, waterproofing claims and structural mounting must be checked on the exact design.',
        'ابدأ بتفضيل الظل المتغير أو الإحساس بالسماء المفتوحة أو الإغلاق الجانبي. تصريف المطر والتعرض للرياح وادعاءات منع تسرب الماء والتثبيت الإنشائي تُراجع للتصميم المحدد.'
      ),
      next_question: both(
        'Would you prefer to adjust the shade, retract the roof to open the space, or add a side enclosure?',
        'تبي تتحكم بالظل، تسحب السقف وتفتح المساحة، أو تضيف إغلاق للجوانب؟'
      ),
      faq: both(
        'Does every pergola stop rain or tolerate the same wind? No; confirm exact system specifications. Does a roof include moving glass sides? Only if that scope is explicitly included.',
        'هل تمنع كل برجولا المطر أو تتحمل نفس الرياح؟ لا، نؤكد مواصفات النظام المحدد. هل يشمل السقف جوانب زجاجية متحركة؟ فقط إذا ذُكرت ضمن النطاق صراحة.'
      ),
    },
  },
  {
    key: 'pool',
    names: ['Pool covers · أغطية المسابح', 'pool cover', 'غطاء مسبح'],
    sources: [
      'https://www.cpsc.gov/s3fs-public/362%20Safety%20Barrier%20Guidelines%20for%20Pools.pdf',
    ],
    sections: {
      explanation: both(
        'A pool cover closes over a pool when it is not in use. Covering method, drive arrangement, pool shape and storage position are design choices.',
        'يمتد غطاء المسبح فوق المسبح عند عدم استخدامه. طريقة التغطية والتشغيل وشكل المسبح ومكان تجميع الغطاء خيارات تصميمية.'
      ),
      options: both(
        'Manual and automatic describe operation. A cover described as automatic, floating or protective is not thereby proven to be a certified safety cover. Establish the purpose and the exact system documentation.',
        'اليدوي والأوتوماتيكي يصفان التشغيل. وصف الغطاء بأنه أوتوماتيكي أو عائم أو واقٍ لا يثبت أنه غطاء أمان معتمد. نحدد الغرض ووثائق النظام الفعلي.'
      ),
      selection: both(
        'Discuss convenient covering and the pool layout, then check the selected system with the team. Never promise child safety or replace supervision/barriers on the basis of a product name.',
        'ناقش سهولة التغطية وتخطيط المسبح ثم راجع النظام المختار مع الفريق. لا تضمن أمان الأطفال أو الاستغناء عن الإشراف والحواجز اعتماداً على اسم المنتج.'
      ),
      next_question: both(
        'What is the main reason for covering the pool, and is the pool new or already built? If safety is the requirement, collect it explicitly for technical review.',
        'وش السبب الأساسي لتغطية المسبح؟ والمسبح جديد أو موجود من قبل؟ إذا كان المطلوب الأمان، سجله بوضوح للمراجعة الفنية.'
      ),
      faq: both(
        'Does automatic mean certified child safety? No. Confirm the exact certification and installation arrangement with the team. Can a cover replace active supervision? Do not present a cover as a substitute for supervision.',
        'هل الأوتوماتيكي يعني اعتماد أمان الأطفال؟ لا. تُراجع شهادة النظام وترتيبات تركيبه مع الفريق. هل يستبدل الغطاء الإشراف؟ لا يُقدّم الغطاء بديلاً للإشراف.'
      ),
    },
  },
  {
    key: 'fire',
    names: [
      'Fire-rated steel doors · الأبواب الفولاذية والنارية',
      'fire doors',
      'باب حريق',
    ],
    sources: [
      'https://www.ul.com/thecodeauthority/knowledge/ul-fire-rated-doors-guide',
    ],
    sections: {
      explanation: both(
        'A fire-door requirement concerns a specified door assembly, including the door, frame and compatible hardware. A steel material description alone does not establish a fire rating.',
        'يتعلق طلب باب الحريق بطقم باب محدد يشمل الباب والإطار والتجهيزات المتوافقة. وصف المادة بأنها حديد أو فولاذ وحده لا يثبت تصنيف حريق.'
      ),
      options: both(
        'Ordinary steel doors and documented fire-door assemblies are different categories. Required fire/smoke performance, opening arrangement and hardware must be matched to the exact project and assembly documentation.',
        'الأبواب الحديدية العادية وأطقم الحريق الموثقة فئتان مختلفتان. متطلبات الحريق أو الدخان وطريقة الفتح والتجهيزات تُطابق مع المشروع ووثائق الطقم المحدد.'
      ),
      selection: both(
        'Collect the project specification and location/use. The technical team must verify the selected assembly and documentation; do not recommend an unverified rating, authority approval or replacement hardware.',
        'اجمع مواصفات المشروع وموقع الاستخدام. يتحقق الفريق الفني من الطقم ووثائقه، ولا نوصي بتصنيف غير موثق أو اعتماد جهة أو تجهيز بديل غير متحقق منه.'
      ),
      next_question: both(
        'Do you have the project’s required door schedule or fire/smoke specification? Share it for exact assembly review.',
        'عندك جدول الأبواب أو مواصفات الحريق والدخان المطلوبة للمشروع؟ أرسلها عشان نراجع الباب والإطار والتجهيزات المطلوبة مع بعض.'
      ),
      faq: both(
        'Does a steel door automatically satisfy a fire-door request? No. Can an individual hardware rating prove the whole installed assembly? Do not infer that; review the complete matching documentation.',
        'هل يحقق الباب الحديدي تلقائياً طلب باب الحريق؟ لا. هل يثبت تصنيف قطعة تجهيز واحدة تصنيف الطقم المركب كله؟ لا نستنتج ذلك، بل نراجع الوثائق المتطابقة كاملة.'
      ),
    },
  },
  {
    key: 'gates',
    names: [
      'Automatic gates & barriers · البوابات والحواجز',
      'automatic gate',
      'بوابة اوتوماتيك',
    ],
    sections: {
      explanation: both(
        'Gate automation operates a gate leaf; a parking barrier controls vehicle passage using a barrier arm. Opening geometry and access-control behavior are separate choices.',
        'تشغل أتمتة البوابة ضلفة البوابة، بينما ينظم حاجز المواقف مرور المركبات بذراع حاجز. هندسة الفتح وسلوك التحكم بالدخول خيارات منفصلة.'
      ),
      options: both(
        'A swing gate rotates on hinges; a sliding gate moves sideways. A barrier arm controls a lane rather than forming a full gate leaf. The operator must suit the actual gate and operating conditions.',
        'تدور البوابة المفصلية على مفصلاتها، وتتحرك البوابة السحابة جانبياً. ينظم ذراع الحاجز مساراً بدلاً من تشكيل ضلفة بوابة كاملة. يجب أن يلائم المشغّل البوابة وظروف تشغيلها الفعلية.'
      ),
      selection: both(
        'Compare the available swing/side space and whether the aim is a full gate or lane control. Weight, dimensions, use frequency, safety sensing and power-cut access require exact system checks.',
        'قارن مساحة دوران الضلفة أو حركتها الجانبية، وحدد هل المطلوب بوابة كاملة أم تنظيم مسار. الوزن والمقاسات وتكرار الاستخدام وحساسات الأمان والدخول عند انقطاع الكهرباء تحتاج مراجعة النظام المحدد.'
      ),
      next_question: both(
        'Is there an existing swing/sliding gate to automate, or do you need a barrier for a vehicle lane?',
        'عندك بوابة مفصلية أو سحابة وتبي تحوّلها لأوتوماتيك، أو تحتاج حاجز لمسار السيارات؟'
      ),
      faq: both(
        'Can any motor operate any gate? No; match the actual gate and operator. Are remotes, access control and backup power included? Use the exact approved package and offer.',
        'هل يشغل أي محرك أي بوابة؟ لا، نطابق البوابة الفعلية والمشغّل. هل الريموت والتحكم بالدخول والطاقة البديلة مشمولة؟ نراجع الباقة والعرض المعتمدين المحددين.'
      ),
    },
  },
];
const normalize = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/gu, '')
    .replace(/[أإآ]/gu, 'ا')
    .trim();
export function customerGuideDrafts(
  products: (GuideProduct & { aliases?: string[] })[]
) {
  const entries = [];
  for (const product of products.filter(
    (p) => p.kind === 'family' && !p.superseded_by
  )) {
    const names = [product.name, ...(product.aliases ?? [])].map(normalize);
    const matches = CUSTOMER_GUIDE_TEMPLATES.filter((t) =>
      t.names.some((n) => names.includes(normalize(n)))
    );
    if (matches.length !== 1) continue;
    const template = matches[0];
    entries.push({
      product_id: product.id,
      title: `Customer guide · ${product.name}`,
      guide_sections: template.sections,
      source_notes:
        `AI-prepared educational draft for staff review. Based on existing catalog category names and general product concepts; no HTH-specific availability, construction, prices, warranty or ratings inferred. Template: ${template.key}.` +
        (template.sources?.length
          ? ' General reference sources (not evidence for an HTH system): ' +
            template.sources.join(' ')
          : ''),
    });
  }
  return entries;
}
