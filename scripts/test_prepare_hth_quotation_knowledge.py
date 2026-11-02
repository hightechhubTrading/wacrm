"""Source quoting regression tests; no private archives or database required."""
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('prepare', Path(__file__).with_name('prepare-hth-quotation-knowledge.py'))
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)
PRODUCT_HEADERS = ['code', 'product_en', 'product_ar', 'old_folder', 'pricing_unit', 'what_is_included', 'standard_payment', 'standard_delivery', 'warranty', 'price_anchor_2026', 'confidence']


class SourceParsingTests(unittest.TestCase):
    def test_normal_rows_preserve_values(self):
        fields = ['WS'] + ['original'] * 10
        self.assertEqual(prepare.normalize_cells(PRODUCT_HEADERS, fields, 'products.csv', 2), dict(zip(PRODUCT_HEADERS, fields)))

    def test_pergola_name_is_rejoined_without_shifting_specs(self):
        fields = ['PG', 'Pergolas and shades (steel', ' WPC', ' bioclimatic)', 'Arabic name', 'Pergola', 'per project', 'Original scope', '60/30/10', '15 days', 'per model', 'historical anchor', 'Medium']
        row = prepare.normalize_cells(PRODUCT_HEADERS, fields, 'products.csv', 5)
        self.assertEqual(row['product_en'], 'Pergolas and shades (steel, WPC, bioclimatic)')
        self.assertEqual(row['what_is_included'], 'Original scope')
        self.assertEqual(row['confidence'], 'Medium')
        self.assertEqual(json.loads(row['__original_csv_fields_json']), fields)

    def test_pivot_range_keeps_thousands_separators_and_confidence(self):
        fields = ['PIV', 'Pivot doors', 'Arabic name', 'Pivot door', 'per m2', 'Original scope', '60/40', '20 days', 'per quote', '~3', '200-4', '000 QAR/m2 (derived from PIV-2083/2085)', 'Medium']
        row = prepare.normalize_cells(PRODUCT_HEADERS, fields, 'products.csv', 9)
        self.assertEqual(row['price_anchor_2026'], '~3,200-4,000 QAR/m2 (derived from PIV-2083/2085)')
        self.assertEqual(row['confidence'], 'Medium')
        self.assertIn('not an approved selling rate', row['__parse_review_note'])

    def test_coverage_tail_is_rejoined_and_unknown_errors_stop_import(self):
        headers = ['archive', 'folder', 'real_files', 'review_status_2026-11-02']
        row = prepare.normalize_cells(headers, ['Supplier', 'Catalogue', '2', 'skimmed (images', ' no prices)'], 'source_inventory.csv', 28)
        self.assertEqual(row['review_status_2026-11-02'], 'skimmed (images, no prices)')
        with self.assertRaisesRegex(ValueError, 'manual source parsing review required'):
            prepare.normalize_cells(PRODUCT_HEADERS, ['Unknown', 'broken'], 'products.csv', 99)


if __name__ == '__main__':
    unittest.main()
