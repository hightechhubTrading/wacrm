/** Build a private migration manifest from an authoritative account snapshot.
 * Read only: does not change the database. Review media and price handling before apply.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
const [snapshotPath, outputPath] = process.argv.slice(2);
if (!snapshotPath || !outputPath)
  throw Error(
    'Usage: node scripts/prepare-product-map.mjs snapshot.json manifest.json'
  );
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
const map = fs.readFileSync('docs/product-map.md', 'utf8');
const identity = (key) => {
  const h = crypto
    .createHash('sha256')
    .update(`hth-product-map-v3:${snapshot.accountId}:${key}`)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const reuse = {
  'Window Shutters': 'Window Shutter Systems',
  'Steel Doors and Gates': 'Custom Steel Doors and Gates',
  'Gate Motors and Barriers': 'Gate Automation and Parking Barriers',
  'Aluminium Doors': 'Pivot Entrance Doors',
  'Fire-rated Doors': 'Fire-rated Door Systems',
  'Aluminium Windows and Façades': 'Aluminium, uPVC and Glazing Systems',
  Pergolas: 'Pergolas and Roof Systems',
  'Sectional Garage Door (American)': 'American-style Sectional Garage Door',
  'Roller Garage Door (Australian)': 'Australian-style Rolling Garage Door',
  'Solid Steel Shutter': 'Solid Steel Shop Shutter',
  'Perforated Shutter': 'Perforated Steel Shop Shutter',
  'Polycarbonate (Clear) Shutter': 'Transparent Polycarbonate Shop Shutter',
  'High-speed PVC Door': 'High-speed PVC Doors',
  'Sliding Gate Motor': 'Sliding Gate Automation',
  'Swing Gate Motor': 'Swing Gate Automation',
  'Parking Barrier': 'Parking Barriers',
  'Pivot Door': 'Aluminium and ACP Pivot Door',
  'Fire-rated Door': 'Fire-rated Steel Door Sets',
  'Aluminium Window': 'Aluminium Windows and Doors',
  'Curtain Wall and Shopfront': 'Glazed Façades',
  'uPVC Window': 'uPVC Windows and Doors',
  'Glass Partition': 'Glass Partitions',
  'Shower Enclosure': 'Glass Shower Enclosures',
  Skylight: 'Skylights',
  'Automatic Sliding Glass Door': 'Sliding Glass Entrances',
  'Modern Pergola': 'Aluminium Pergolas',
};
const rows = [];
let category;
const tree = map.split('```')[1];
for (const line of tree.split('\n')) {
  const c = line.match(/[├└]─ \d+\. (.*?) · (.*)/);
  const p = line.match(/│?\s{4,}[├└]─ (.*)/);
  if (!c && !p) continue;
  const name = c ? c[1] : p[1];
  const matches = snapshot.products.filter(
    (r) => r.name === reuse[name] && !r.superseded_by
  );
  if (reuse[name] && matches.length !== 1)
    throw Error(`Ambiguous mapping: ${name}`);
  const existing = matches[0];
  const row = {
    id: existing?.id ?? identity(name),
    name,
    name_ar: c?.[2] ?? null,
    kind: c ? 'family' : 'product',
    parent_id: c ? null : category.id,
    inventory_type: 'product',
    existingId: existing?.id ?? null,
    expectedUpdatedAt: existing?.updated_at ?? null,
  };
  if (c) {
    category = row;
    const sectionNumber = c[0].match(/(\d+)\./)[1];
    row.planSection = map
      .split(`### ${sectionNumber}. `)[1]
      ?.split('\n### ')[0]
      ?.trim();
    if (!row.planSection) throw Error(`Missing detailed section: ${name}`);
  } else {
    row.planSection = category.planSection;
    row.standardQuestions = [
      'Width × height',
      'Operation',
      'Colour or finish',
      'Used for',
    ];
    row.supplyAndInstallation = true;
  }
  rows.push(row);
}
if (
  rows.filter((r) => r.kind === 'family').length !== 11 ||
  rows.filter((r) => r.kind === 'product').length !== 33
)
  throw Error('Product map must contain 11 categories and 33 products');
if (new Set(rows.map((r) => r.id)).size !== rows.length)
  throw Error('A source identity cannot serve two targets');
const mapped = new Set(rows.map((r) => r.id));
const legacyProducts = snapshot.products.filter(
  (r) => r.inventory_type === 'product' && !mapped.has(r.id)
);
const manifest = {
  version: 3,
  accountId: snapshot.accountId,
  userId: snapshot.userId,
  mapSha256: crypto.createHash('sha256').update(map).digest('hex'),
  snapshotSha256: crypto
    .createHash('sha256')
    .update(fs.readFileSync(snapshotPath))
    .digest('hex'),
  rows,
  retainedLegacyProducts: legacyProducts.map((r) => ({
    id: r.id,
    name: r.name,
    parent_id: r.parent_id,
    existingReplacement: r.superseded_by,
    action: 'retain-hidden',
    expectedUpdatedAt: r.updated_at,
  })),
  mediaReview: snapshot.media.map((m) => ({
    id: m.id,
    product_id: m.product_id,
    label: m.label,
    description: m.ai_description,
    media_kind: m.media_kind,
    targetProductId: null,
  })),
  invariants: [
    'Retain every existing product UUID and price value',
    'Preserve quotation items, issued documents and immutable source data',
    'No automatic motor sizing without a recorded rule',
    'Only product inventory is eligible for chat photos',
    'No photo reassignment based on an ambiguous legacy group',
    'Do not copy a family price to newly split products',
  ],
  remaining: [
    'Review every target specification, choices, code and bilingual name',
    'Resolve merge replacement IDs and move children before changing kinds',
    'Classify equipment/services/workshop parts and compatibility',
    'Review 56 media assignments',
    'Snapshot historical quotation/source/tag/link state',
    'Generate guarded transaction, rehearse with rollback, apply and verify',
    'Verify inventory, quotation and chat photo flows',
  ],
};
fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n', {
  mode: 0o600,
});
console.log(
  JSON.stringify({
    categories: 11,
    products: 33,
    reused: rows.filter((r) => r.existingId).length,
    new: rows.filter((r) => !r.existingId).length,
    retainedLegacyProducts: legacyProducts.length,
    mediaToReview: manifest.mediaReview.length,
  })
);
