"""Prepare a private source pack without editing originals or connecting to a database."""
import argparse
import csv
import hashlib
import json
from pathlib import Path

EXTRACTOR_VERSION = 2
SOURCE_KINDS = {
    'products.csv': 'product',
    'price_list_clean_2026-04-29.csv': 'price',
    'clients_master.csv': 'client',
    'HTH-Quotation-Register-2025-26.csv': 'quotation',
    'HTH-Invoice-Register.csv': 'invoice',
    'HTH-Jobs-Won-From-Invoices.csv': 'job',
    'inventory_item_master_MERGED.csv': 'component',
    'inventory_merge_review.csv': 'merge',
    'supplier_costs.csv': 'supplier',
    'supplier_alufix_parts_codes.csv': 'supplier_code',
    'supplier_gtr_screens_price_grid_EUR.csv': 'grid',
    'submittal_index.csv': 'submittal',
    'internal_item_codes_and_deliveries.csv': 'delivery',
    'bom_window_shutter_55mm_rules.csv': 'bom_rule',
    'bom_window_shutter_worked_examples.csv': 'bom_example',
    'source_inventory.csv': 'coverage',
    'catalog_price_list_2026-04-29.csv': 'superseded',
    'inventory_item_master_DRAFT.csv': 'superseded',
}
DOCUMENTS = [
    'HTH-Findings-Log.md', 'HTH-Quotation-Findings.md',
    'HTH-Agent-Knowledge.md', 'README-DATA-STANDARD.md', 'BOM-Window-Shutter.md',
]


def normalize_cells(headers, fields, name, row_number):
    """Repair only identified source quoting defects, with original cells retained."""
    original = list(fields)
    note = None
    if len(fields) != len(headers):
        if (name == 'products.csv' and len(headers) == 11 and len(fields) == 13
                and fields[:4] == ['PG', 'Pergolas and shades (steel', ' WPC', ' bioclimatic)']):
            fields = [fields[0], ','.join(fields[1:4]), *fields[4:]]
            note = 'Unquoted commas in product_en were rejoined; original parsed cells are retained. Review before approval.'
        elif (name == 'products.csv' and len(headers) == 11 and len(fields) == 13
              and fields[0] == 'PIV' and fields[9:12] == ['~3', '200-4', '000 QAR/m2 (derived from PIV-2083/2085)']):
            fields = [*fields[:9], ','.join(fields[9:-1]), fields[-1]]
            note = 'Unquoted thousands separators in price_anchor_2026 were rejoined. This historical range is not an approved selling rate.'
        elif (name == 'source_inventory.csv' and len(headers) == 4
              and len(fields) > 4 and fields[2].isdigit()):
            fields = [*fields[:3], ','.join(fields[3:])]
            note = 'Unquoted comma in final review-status column was rejoined; original parsed cells are retained.'
        else:
            raise ValueError(f'{name}:{row_number}: expected {len(headers)} columns, found {len(fields)}; manual source parsing review required')
    result = dict(zip(headers, fields, strict=True))
    if note:
        result['__parse_review_note'] = note
        result['__original_csv_fields_json'] = json.dumps(original, ensure_ascii=False)
    return result


def prepare(source):
    records, sources = [], []
    for name, kind in SOURCE_KINDS.items():
        file = source / name if (source / name).exists() else source / 'HTH-Knowledge-Pack' / name
        digest = hashlib.sha256(file.read_bytes()).hexdigest()
        with file.open(encoding='utf-8-sig', newline='') as handle:
            reader = csv.reader(handle)
            headers = next(reader)
            rows = [normalize_cells(headers, fields, name, index) for index, fields in enumerate(reader, 2)]
        sources.append({'file': name, 'sha256': digest, 'rows': len(rows)})
        records.extend({'key': f'{name}:{index}', 'kind': kind, 'source': name, 'row': index, 'data': row}
                       for index, row in enumerate(rows, 2))
    for name in DOCUMENTS:
        file = source / name if (source / name).exists() else source / 'HTH-Knowledge-Pack' / name
        digest = hashlib.sha256(file.read_bytes()).hexdigest()
        sources.append({'file': name, 'sha256': digest, 'rows': 1})
        records.append({'key': name, 'kind': 'document', 'source': name, 'row': 1,
                        'data': {'text': file.read_text(encoding='utf-8-sig')}})
    version = hashlib.sha256(json.dumps({'extractor_version': EXTRACTOR_VERSION, 'sources': sources}, sort_keys=True).encode()).hexdigest()
    return {'format': 1, 'extractor_version': EXTRACTOR_VERSION, 'version': version,
            'label': 'HTH archive review · 2 November 2026', 'sources': sources, 'records': records}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=Path('../..'))
    parser.add_argument('--output', type=Path, default=Path('.local/hth-quotation-knowledge.json'))
    args = parser.parse_args()
    pack = prepare(args.source.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(pack, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'version': pack['version'], 'sources': len(pack['sources']),
                      'records': len(pack['records']), 'parse_review_rows': sum('__parse_review_note' in r['data'] for r in pack['records']),
                      'bytes': args.output.stat().st_size}))


if __name__ == '__main__':
    main()
