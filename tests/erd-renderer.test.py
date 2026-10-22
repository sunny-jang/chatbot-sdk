"""Ensure regeneration includes future tables, with and without declared FKs."""
import json, subprocess, tempfile, unittest
from pathlib import Path

class RenderTest(unittest.TestCase):
    def test_new_tables_receive_layout(self):
        repo = Path(__file__).resolve().parents[1]
        data = json.loads((repo / 'docs/architecture/schema-2026-10-22.json').read_text())
        for name in ['future_linked', 'future_standalone']:
            data['columns'].append(dict(table_name=name,column_name='id',udt_name='text',primary_key=True,is_nullable='NO'))
        data['relations'].append(dict(source_table='future_linked',source_column='id',target_table='bots',target_column='id',constraint_name='future_fk'))
        with tempfile.TemporaryDirectory() as work:
            root = Path(work) / 'docs/architecture'
            root.mkdir(parents=True)
            (root / 'schema-2026-10-22.json').write_text(json.dumps(data))
            subprocess.run(['python3',str(repo / 'scripts/render-erd.py')],cwd=work,check=True,capture_output=True)
            svg = (root / 'chatbot-erd.svg').read_text()
            for table in {c['table_name'] for c in data['columns']}:
                self.assertIn(f'data-table="{table}"',svg)
            self.assertIn('기타 테이블',svg)
            self.assertIn('width="2685"',svg)

if __name__ == '__main__': unittest.main()
