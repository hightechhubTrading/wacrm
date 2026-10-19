/** Curated from the HTH vault and company site on 2026-10-18.
 * Research drafts contain no invented prices, certifications or promised performance.
 * Source conflicts stay in limitations for review, never in customer-facing facts.
 */
export interface ResearchedFamily {
  key: string;
  name: string;
  aliases: string[];
  description: string;
  source: string;
  products: {
    name: string;
    aliases: string[];
    description: string;
    variants?: { name: string; aliases: string[]; description: string }[];
  }[];
}
const home = 'https://hightechub.com/';
const profile =
  'Vault: raw/clients/hth/2026-10-09-import/Company profile.md §04; wiki/clients/hth/Products.md. Reviewed 2026-10-18.';
export const HTH_RESEARCH_SOURCE = profile;
export const HTH_RESEARCH: ResearchedFamily[] = [
  {
    key: 'pivot',
    name: 'Pivot doors · الأبواب المحورية',
    aliases: ['pivot doors', 'بيفوت', 'أبواب محورية'],
    description:
      'Custom entrance doors with pivot hardware and a choice of finishes.',
    source: 'https://hightechub.com/pivot-doors/',
    products: [
      {
        name: 'Custom pivot entrance door · باب مدخل بيفوت',
        aliases: ['pivot entrance', 'باب بيفوت'],
        description:
          'A pivot entrance door configured for the opening, chosen finish and hardware. Confirm dimensions and hardware compatibility before ordering.',
      },
    ],
  },
  {
    key: 'steel',
    name: 'Custom steel doors · أبواب الحديد حسب الطلب',
    aliases: ['iron doors', 'steel doors', 'ابواب حديد'],
    description:
      'Workshop-made steel entrance doors and gates, with decorative or plain designs.',
    source: 'https://hightechub.com/steel-doors/',
    products: [
      {
        name: 'Decorative steel doors · أبواب حديد زخرفية',
        aliases: ['decorative iron door', 'باب حديد زخرفي'],
        description:
          'Custom decorative steel doors fabricated for the site dimensions and agreed design.',
      },
      {
        name: 'Plain steel doors · أبواب حديد سادة',
        aliases: ['flush steel door', 'باب حديد سادة'],
        description:
          'Plain steel door designs. Confirm hardware, finish and opening requirements.',
      },
    ],
  },
  {
    key: 'window-shutters',
    name: 'Window shutters · شتر النوافذ',
    aliases: ['window shutters', 'شتر نوافذ', 'شتر درايش'],
    description:
      'Window coverings for light and privacy, including villa and cabin applications.',
    source: 'https://hightechub.com/window-shutters/',
    products: [
      {
        name: 'Motorized window shutters · شتر نوافذ كهربائي',
        aliases: ['electric window shutter', 'شتر نوافذ كهربائي'],
        description:
          'Motorized external window shutters. Confirm power supply, controls, mounting and opening during a power cut for the selected system.',
      },
      {
        name: 'Manual window shutters · شتر نوافذ يدوي',
        aliases: ['manual window shutters', 'هاندل', 'شتر يدوي للنوافذ'],
        description:
          'Manual external window shutters. Confirm dimensions and operating arrangement with the team.',
      },
    ],
  },
  {
    key: 'rolling-doors',
    name: 'Rolling shutter doors · أبواب الشتر',
    aliases: ['rolling shutter doors', 'شتر ابواب', 'ابواب شتر'],
    description:
      'Rolling doors for garage, retail and warehouse openings. Separate from window shutters.',
    source: home,
    products: [
      {
        name: 'Garage shutter doors · أبواب شتر الكراجات',
        aliases: ['garage shutter', 'كراج', 'باب كراج'],
        description:
          'Garage doors for villa entrances. Australian rolling and American sectional options appear in the existing sales catalog; each configuration needs its own approved pricing.',
        variants: [
          {
            name: 'Australian rolling garage door · باب كراج رول أسترالي',
            aliases: ['Australian roll', 'رول استرالي'],
            description:
              'Rolling garage-door configuration. Confirm the selected motor, remote controls and opening requirements; no price is inherited.',
          },
          {
            name: 'American sectional garage door · باب كراج أمريكي',
            aliases: ['American sectional', 'باب امريكي'],
            description:
              'Sectional garage-door configuration. Confirm the selected centre motor, panels and opening requirements; no price is inherited.',
          },
        ],
      },
      {
        name: 'Shop shutter doors · أبواب شتر المحلات',
        aliases: ['shop shutter', 'شتر محل'],
        description:
          'Shopfront rolling-door configurations. The existing catalog lists solid steel, perforated steel and transparent polycarbonate options. Keep the selected material and operation explicit.',
        variants: [
          {
            name: 'Solid steel shop shutter · شتر محل حديد صوليد',
            aliases: ['solid steel shutter', 'شتر صوليد'],
            description:
              'Solid steel slat shop shutter. Motor, finish and opening details require selection.',
          },
          {
            name: 'Perforated shop shutter · شتر محل حديد مخرم',
            aliases: ['perforated shutter', 'شتر مخرم'],
            description:
              'Perforated steel shop shutter. Confirm perforation, motor and installation scope.',
          },
          {
            name: 'Polycarbonate shop shutter · شتر محل بولي كربونايت',
            aliases: ['polycarbonate shutter', 'شتر شفاف'],
            description:
              'Transparent polycarbonate shop-door configuration. Confirm selected system, motor and installation scope.',
          },
        ],
      },
    ],
  },
  {
    key: 'glazing',
    name: 'Aluminium, UPVC & glass · الألمنيوم وUPVC والزجاج',
    aliases: ['UPVC', 'ألمنيوم', 'يو بي في سي'],
    description: 'Custom windows, doors and architectural glass systems.',
    source: home,
    products: [
      {
        name: 'Aluminium windows & doors · نوافذ وأبواب ألمنيوم',
        aliases: ['aluminium windows', 'شبابيك المنيوم'],
        description:
          'Made-to-measure aluminium windows and doors; specify opening type, profiles, glazing and finish.',
      },
      {
        name: 'UPVC windows & doors · نوافذ وأبواب UPVC',
        aliases: ['UPVC windows', 'درايش upvc'],
        description:
          'UPVC window and door systems configured for the site. Confirm opening style and glazing.',
      },
      {
        name: 'Glass partitions · الفواصل الزجاجية',
        aliases: ['glass partition', 'فاصل زجاج'],
        description:
          'Framed or frameless interior glass partitions, configured to the project.',
      },
      {
        name: 'Skylights · الفتحات السقفية',
        aliases: ['skylight', 'سكاي لايت'],
        description:
          'Roof glazing configured to the building design and opening.',
      },
      {
        name: 'Glazed facades · الواجهات الزجاجية',
        aliases: ['glazing facade', 'واجهة زجاج'],
        description:
          'Architectural glazed facades. Technical design and specifications require project review.',
      },
      {
        name: 'Shower enclosures · أقسام الحمامات',
        aliases: ['shower enclosure', 'شاور'],
        description:
          'Custom glass shower enclosures with the selected hardware and opening arrangement.',
      },
    ],
  },
  {
    key: 'sliding',
    name: 'Automatic sliding glass · الزجاج المنزلق الأوتوماتيكي',
    aliases: ['automatic sliding glass', 'باب زجاج اوتوماتيك'],
    description: 'Sensor-operated sliding glass entrances.',
    source: home,
    products: [
      {
        name: 'Sliding glass entrances · مداخل زجاجية منزلقة',
        aliases: ['sensor sliding door', 'باب حساس'],
        description:
          'Single or double sliding glass entrance configurations. Confirm operating modes and access-control compatibility.',
      },
    ],
  },
  {
    key: 'pergolas',
    name: 'Pergolas & roofs · البرجولات والأسقف',
    aliases: ['pergola', 'برجولا', 'برغولا'],
    description:
      'Roof and shade systems with distinct constructions and operating options.',
    source: home,
    products: [
      {
        name: 'Bioclimatic roofs · أسقف بيوكلايماتيكية',
        aliases: ['bioclimatic', 'بيوكلايماتيك'],
        description:
          'A pergola roof using adjustable louvres. Confirm the selected system and project scope.',
      },
      {
        name: 'Retractable pergolas · برجولات قابلة للطي',
        aliases: ['retractable pergola', 'برجولا متحركة'],
        description:
          'Retractable roof/pergola configurations. Confirm covering, drive and mounting.',
      },
      {
        name: 'Guillotine glass · زجاج غيوتين',
        aliases: ['guillotine glass', 'غيوتين'],
        description:
          'Vertically moving glass enclosure systems, often discussed with outdoor roof projects.',
      },
      {
        name: 'Aluminium pergolas · برجولات ألمنيوم',
        aliases: ['aluminium pergola', 'برجولا المنيوم'],
        description: 'Custom aluminium pergola structures.',
      },
      {
        name: 'WPC pergolas · برجولات WPC',
        aliases: ['WPC pergola', 'برجولا wpc'],
        description:
          'Pergola structures using WPC elements. Confirm the selected construction and finishes.',
      },
    ],
  },
  {
    key: 'pool',
    name: 'Pool covers · أغطية المسابح',
    aliases: ['pool cover', 'غطاء مسبح'],
    description: 'Automatic covers configured to the pool layout.',
    source: home,
    products: [
      {
        name: 'Automatic pool cover · غطاء مسبح أوتوماتيكي',
        aliases: ['automatic pool cover', 'غطاء مسبح اوتوماتيك'],
        description:
          'A motorized pool-cover configuration. Pool dimensions, surrounding layout and operating arrangement need review. Do not promise child-safety certification.',
      },
    ],
  },
  {
    key: 'fire',
    name: 'Fire-rated steel doors · الأبواب الفولاذية والنارية',
    aliases: ['fire doors', 'باب حريق'],
    description:
      'Door sets selected to the project requirements and system documentation.',
    source: home,
    products: [
      {
        name: 'Project fire-door sets · أطقم أبواب حريق للمشاريع',
        aliases: ['fire-rated door set', 'باب مقاوم للحريق'],
        description:
          'Steel door sets requiring verification of the exact certified assembly, hardware and project requirements. Do not quote a rating or approval without its matching certificate.',
      },
    ],
  },
  {
    key: 'gates',
    name: 'Automatic gates & barriers · البوابات والحواجز',
    aliases: ['automatic gate', 'barrier', 'بوابة اوتوماتيك'],
    description: 'Gate operators and vehicle access systems.',
    source: home,
    products: [
      {
        name: 'Swing gate automation · تشغيل بوابات مفصلية',
        aliases: ['swing gate', 'بوابة مفصلية'],
        description:
          'Automation for swing gates. Confirm gate geometry, weight, power and operator compatibility.',
      },
      {
        name: 'Sliding gate automation · تشغيل بوابات منزلقة',
        aliases: ['sliding gate', 'بوابة منزلقة'],
        description:
          'Automation for sliding gates. Confirm track, gate dimensions and selected operator.',
      },
      {
        name: 'Parking barriers · حواجز المواقف',
        aliases: ['parking barrier', 'حاجز موقف'],
        description:
          'Vehicle parking barriers, configured with the required access-control system.',
      },
    ],
  },
];
export const HTH_COMPANY_RESEARCH = {
  title: 'HTH company & service facts · معلومات الشركة والخدمة',
  content:
    'High Tech Hub Trading (هاي تك هاب تريدينغ) is based in Doha, Qatar. The head office is Office 6, Building 33, Othman Bin Affan Street (180), Zone 55, Al Azizia, Doha. The workshop is in the Industrial Area, Street 28. WhatsApp: +974 5064 0111. Phone: +974 7057 0800. Email: info@hightechub.com. Website: https://hightechub.com/. Services cover site assessment, design/shop drawings, supply or fabrication, installation, handover and after-sales support. A requested visit is not a confirmed appointment. Staff confirm quotations and appointment times. Manufacturer credentials belong to the named manufacturer, not automatically to HTH. Warranty, motor model, performance and certified fire rating must be supported for the exact product. Do not infer a standard warranty across all systems.',
  source_url: home,
  source_notes:
    profile +
    ' Also wiki/clients/hth/Company facts.md. Unresolved: founding date, general warranty versus product terms, fire certificates, motor specifications. Website hours differ from old staff messages; confirm current operating hours in account settings before publishing them.',
};
