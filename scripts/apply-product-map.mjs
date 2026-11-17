/** Account-scoped product map transaction. Default rehearses and rolls back. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  productDetails,
  replacements,
  unconfirmedSupply,
} from './product-map-data.mjs';
const dir = '.local/product-map';
const s = JSON.parse(fs.readFileSync(`${dir}/before.json`));
const m = JSON.parse(fs.readFileSync(`${dir}/manifest.json`));
const hashFile = (path) =>
  crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
if (
  m.snapshotSha256 !== hashFile(`${dir}/before.json`) ||
  m.mapSha256 !== hashFile('docs/product-map.md') ||
  m.accountId !== s.accountId ||
  m.userId !== s.userId
)
  throw Error('Manifest source changed');
process.loadEnvFile('.env.local');
const linked = fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim();
if (
  new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !==
  `${linked}.supabase.co`
)
  throw Error('Linked project mismatch');
const lit = (v) =>
  v == null ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`;
const json = (v) => `${lit(JSON.stringify(v))}::jsonb`;
const a = lit(s.accountId),
  u = lit(s.userId);
const sql = [
  `BEGIN; SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='180s'; SELECT pg_advisory_xact_lock(hashtextextended(${a},101));`,
  `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM profiles WHERE account_id=${a} AND user_id=${u} AND account_role IN ('owner','admin')) THEN RAISE EXCEPTION 'Account admin required'; END IF; END $$;`,
  `CREATE TEMP TABLE original_products AS SELECT * FROM ai_products WHERE account_id=${a};`,
  `CREATE TEMP TABLE original_media AS SELECT * FROM ai_product_media WHERE account_id=${a};`,
  `DO $$ BEGIN IF (SELECT count(*) FROM original_products)<>${s.products.length} THEN RAISE EXCEPTION 'Inventory changed';END IF;END $$;`,
];
for (const p of s.products)
  sql.push(
    `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM original_products WHERE id=${lit(p.id)} AND updated_at=${lit(p.updated_at)}::timestamptz) THEN RAISE EXCEPTION 'Product changed since snapshot'; END IF; END $$;`
  );
const fingerprints = [
  'quotations',
  'quotation_items',
  'quotation_documents',
  'quotation_knowledge_records',
  'quotation_knowledge_reviews',
  'product_source_links',
  'ai_knowledge_documents',
];
for (const t of fingerprints)
  sql.push(
    `CREATE TEMP TABLE saved_${t} AS SELECT * FROM ${t} WHERE account_id=${a};`
  );
for (const r of m.rows) {
  const old = s.products.find((p) => p.id === r.id);
  const detail = productDetails[r.name];
  if (r.kind === 'product' && !detail) throw Error(`Missing detail ${r.name}`);
  const [code, ar, description, choices] = detail ?? [];
  const patch = {
    name: r.name,
    name_ar: r.name_ar ?? ar,
    kind: r.kind,
    parent_id: r.parent_id,
    status: unconfirmedSupply.includes(r.name) ? 'draft' : 'approved',
    customer_visible: !unconfirmedSupply.includes(r.name),
    inventory_type: 'product',
  };
  if (detail) {
    patch.description = description;
    patch.specifications = [
      description,
      `Configuration choices: ${choices}.`,
      'Supply and installation included. Electrical connection is an extra.',
      old?.specifications &&
        `Previously recorded product details:\n${old.specifications}`,
    ]
      .filter(Boolean)
      .join('\n');
    patch.aliases = [
      ...new Set([...(old?.aliases ?? []), old?.name, code].filter(Boolean)),
    ].slice(0, 30);
    patch.sku = old ? old.sku : code;
    patch.unit_of_measure =
      old?.unit_of_measure ??
      (['SL-MOTOR', 'SW-MOTOR', 'GB-BARRIER'].includes(code) ? 'piece' : 'm2');
    patch.limitations = [
      old?.limitations,
      unconfirmedSupply.includes(r.name) &&
        'Supply is not confirmed; retain as an internal draft.',
      r.name.startsWith('Window Shutter') &&
        'Motor model must follow opening size and load; no automatic selection rule is confirmed.',
      ['Window Shutter 41', 'Window Shutter 55'].includes(r.name) &&
        'Company answer dated 17 November 2026. Stated slat thickness is not aluminium wall/gauge thickness. Thermal/acoustic numerical ratings were not supplied; performance descriptions are company claims.',
      r.name === 'Window Shutter 77' &&
        'The 41/55 company answer does not establish thickness, colours or performance for 77.',
    ]
      .filter(Boolean)
      .join('\n');
  }
  patch.source_notes = [
    old?.source_notes,
    'Product-map v3, owner-authorized 17 November 2026. Original identity, SKU and price values retained where present. Configuration choices are not calculated prices or motor-sizing rules.',
  ]
    .filter(Boolean)
    .join('\n');
  const fields = Object.keys(patch);
  if (old)
    sql.push(
      `UPDATE ai_products SET (${fields.join(',')})=(SELECT ${fields.join(',')} FROM jsonb_populate_record(NULL::ai_products,${json(patch)})) WHERE account_id=${a} AND id=${lit(r.id)};`
    );
  else {
    const row = {
      ...patch,
      id: r.id,
      account_id: s.accountId,
      created_by: s.userId,
      description: patch.description ?? `${r.name} product category.`,
    };
    const keys = Object.keys(row);
    sql.push(
      `INSERT INTO ai_products(${keys.join(',')}) SELECT ${keys.join(',')} FROM jsonb_populate_record(NULL::ai_products,${json(row)});`
    );
  }
}
for (const r of m.retainedLegacyProducts) {
  const target =
    replacements[r.name] && m.rows.find((p) => p.name === replacements[r.name]);
  sql.push(
    `UPDATE ai_products SET status='draft',customer_visible=false${target ? `,superseded_by=${lit(target.id)}` : ''} WHERE account_id=${a} AND id=${lit(r.id)};`
  );
}
sql.push(
  `UPDATE ai_products SET customer_visible=false WHERE account_id=${a} AND inventory_type IN ('equipment','component','service');`
);
for (const size of [41, 55]) {
  const r = m.rows.find((r) => r.name === `Window Shutter ${size}`);
  const question = `ما مواصفات شريحة شتر النوافذ ${size} ملم وألوانها؟`;
  const answer = `شريحة ألمنيوم مقاس ${size} ملم وسماكة ${size === 41 ? 4 : 5} ملم، توفر عزلاً حرارياً بدرجة كبيرة، وعزلاً للضوء بنسبة 100%، وعزلاً للغبار، وعزلاً للصوت بدرجة جيدة. متوفرة باللونين البيج والأبيض.`;
  sql.push(
    `INSERT INTO ai_catalog_questions(account_id,created_by,product_id,gap_key,question,answer,evidence,confirmed_by,confirmed_on,status) VALUES(${a},${u},${lit(r.id)},${lit(`product-map-v3-window-${size}-specification`)},${lit(question)},${lit(answer)},'Company answer supplied by user on 17 November 2026; عازل صور normalized to عازل صوت. Thickness retained as stated slat thickness, not metal gauge.','User-supplied company answer','2026-11-17','answered');`
  );
}
const mediaDecisions = JSON.parse(
  fs.readFileSync(`${dir}/media-decisions.json`)
);
for (const d of mediaDecisions.assignments) {
  if (
    !s.media.some((f) => f.id === d.id && f.product_id === d.from) ||
    !m.rows.some((p) => p.id === d.to && p.kind === 'product')
  )
    throw Error('Invalid media assignment');
  sql.push(
    `UPDATE ai_product_media SET product_id=${lit(d.to)} WHERE account_id=${a} AND id=${lit(d.id)} AND product_id=${lit(d.from)};`
  );
}
for (const t of fingerprints)
  sql.push(
    `DO $$ BEGIN IF EXISTS((SELECT * FROM saved_${t} EXCEPT SELECT * FROM ${t} WHERE account_id=${a}) UNION ALL (SELECT * FROM ${t} WHERE account_id=${a} EXCEPT SELECT * FROM saved_${t})) THEN RAISE EXCEPTION '${t} changed';END IF;END $$;`
  );
sql.push(
  `DO $$ BEGIN IF EXISTS(SELECT 1 FROM original_products o LEFT JOIN ai_products p ON p.id=o.id AND p.account_id=o.account_id WHERE p.id IS NULL OR (p.price_min,p.price_max,p.price_unit,p.price_notes,p.sku,p.tag_id) IS DISTINCT FROM (o.price_min,o.price_max,o.price_unit,o.price_notes,o.sku,o.tag_id)) THEN RAISE EXCEPTION 'Original identity, prices, SKU or tag changed';END IF;END $$;`
);
sql.push(
  `DO $$ BEGIN IF EXISTS(SELECT 1 FROM original_media o FULL JOIN ai_product_media p ON p.id=o.id AND p.account_id=o.account_id WHERE (o.account_id=${a} OR p.account_id=${a}) AND (o.id IS NULL OR p.id IS NULL OR (to_jsonb(o)-'product_id') IS DISTINCT FROM (to_jsonb(p)-'product_id'))) THEN RAISE EXCEPTION 'Media content or identity changed';END IF;END $$;`
);

sql.push(
  `SELECT jsonb_build_object('targetCategories',11,'targetProducts',33,'products',(SELECT count(*) FROM ai_products WHERE account_id=${a}),'projection',(SELECT count(*) FROM catalog_items WHERE account_id=${a})) result;`,
  process.argv.includes('--apply') ? 'COMMIT;' : 'ROLLBACK;'
);
fs.writeFileSync(`${dir}/apply.sql`, sql.join('\n'), { mode: 0o600 });
const result = spawnSync(
  'supabase',
  ['db', 'query', '--linked', '--file', `${dir}/apply.sql`, '-o', 'json'],
  { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
);
fs.writeFileSync(
  `${dir}/${process.argv.includes('--apply') ? 'apply' : 'rehearsal'}-result.json`,
  result.stdout || result.stderr,
  { mode: 0o600 }
);
if (result.status) throw Error(result.stderr || result.stdout);
console.log(
  process.argv.includes('--apply')
    ? 'Committed product map'
    : 'Rehearsal passed and rolled back'
);
