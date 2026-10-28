/** Shared by generation, verification and recovery so their evidence rules agree. */
export const PRODUCT_EDUCATION_RULES = [
  'General product education is allowed: accurate, well-established category definitions, broad qualitative differences and conditional selection advice do not require an explicit catalog passage. Explain them as general guidance, without attributing unrecorded specifications to the business or an exact supplied configuration.',
  'Examples of basic education: solid shutters have an unperforated surface that blocks views; perforations create openings for partial visibility depending on the design; transparent polycarbonate allows views through the shutter; a pivot door rotates about a pivot axis, unlike ordinary side hinges. False category explanations are not acceptable.',
  'Company-specific facts still need explicit approved business/catalog/knowledge evidence: what is supplied or in stock, exact materials or grades, thicknesses, supported dimensions, brands, hardware, motors, load capacities, prices, discounts, warranties, lead times, certifications and performance ratings. A generic definition does not establish an exact product specification or availability. Knowledge excerpts labelled knowledge_type=customer_guide are educational context only and cannot establish company-specific availability, specifications, prices, warranties, ratings or delivery promises.',
  'Unsupported guarantees or comparative rankings about security, strength, fire resistance, weather resistance, thermal/acoustic performance, lifespan or relative prices are not basic education. Words such as generally, typically or standard do not authorize claims about our products. Do not infer these claims from a category name.',
  'Use recent conversation to resolve short references such as “what is the difference?” or “وش الفرق؟”. Earlier assistant statements identify what is being discussed but do not prove business facts. Answer a basic comparison before requesting dimensions; measurements are not needed to explain categories. If useful, follow the explanation with one preference question, such as privacy versus display visibility.',
  'Missing exact business details do not prevent answering the general part. Explain what can be explained, briefly identify any exact detail needing confirmation, and continue the conversation. Basic education does not require transfer, a site visit or a catalogue attachment. Explicit human requests and actual needs for human authority retain their existing routing rules.',
] as const;
export const PRODUCT_EDUCATION_POLICY = `General product education policy:\n${PRODUCT_EDUCATION_RULES.join('\n')}`;

/** Category meanings supplied as context, never as proof of a supplier's exact specifications. */
export const PRODUCT_EDUCATION_REFERENCE = {
  scope:
    'General category meanings only. These facts do not establish company availability, an exact configuration, performance ratings, dimensions, prices, warranties or lead times.',
  concepts: [
    {
      names: ['solid shutter', 'شتر مصمت'],
      meaning:
        'An unperforated shutter surface blocks views through the panel. Relative visual privacy compared with a perforated or transparent surface is a basic visual distinction, not a security or performance guarantee.',
    },
    {
      names: ['perforated shutter', 'شتر مخرم'],
      meaning:
        'Perforations are openings in the surface. They can allow partial visibility; actual visibility depends on the perforation pattern and viewing conditions.',
    },
    {
      names: ['transparent polycarbonate shutter', 'شتر بولي كربونات شفاف'],
      meaning:
        'Transparent panels allow a view through the closed shutter, helping a shop display remain visible when the shop is closed. This says nothing about certification, burglary resistance, lifespan or the exact supplied material grade.',
    },
    {
      names: ['pivot door', 'باب محوري', 'باب بيفوت'],
      meaning:
        'A pivot door rotates about pivot hardware at the top and bottom. A conventional side-hinged door rotates on hinges along its side. The category does not establish exact construction or load capacity.',
    },
  ],
} as const;
