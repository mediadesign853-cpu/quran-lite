#!/usr/bin/env python3
"""Rebuild only the Arabic Quran text and its search index from Tanzil source data.

This tool intentionally does not generate translations or tafsirs in the Lite edition.
"""
import argparse
import re, json, shutil, sys
from pathlib import Path

try:
    from .quran_text import normalize_for_comparison, normalize_quran_text
except ImportError:  # support direct execution: python tools/build_data.py
    from quran_text import normalize_for_comparison, normalize_quran_text

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description="Build Quran Reader Arabic text and search index")
parser.add_argument("--sql", type=Path, default=ROOT / "sources" / "quran-simple.sql")
parser.add_argument("--output-dir", type=Path, default=ROOT / "public" / "data")
parser.add_argument("--reference-dir", type=Path, default=ROOT / "data-original")
parser.add_argument("--write", action="store_true", help="confirm that generated files may replace public/data")
args = parser.parse_args()

P = args.output_dir.resolve()
OLD = args.reference_dir.resolve()
SQL_FILE = args.sql.resolve()

if not P.is_dir():
    print(f'Output directory does not exist: {P}', file=sys.stderr)
    sys.exit(2)

# If no explicit reference copy exists, preserve the currently installed data before writing.
if not OLD.exists():
    reference_seed = [P / 'surahs.json'] + [P / f'surah_{n:03d}.json' for n in range(1, 115)]
    seed_missing = [str(path) for path in reference_seed if not path.is_file()]
    if seed_missing:
        print('Cannot create the reference backup; existing data files are missing:', file=sys.stderr)
        for path in seed_missing[:30]: print(f'  - {path}', file=sys.stderr)
        sys.exit(2)
    shutil.copytree(P, OLD)
    print(f'Original data backed up to: {OLD}')

required = [SQL_FILE, OLD / 'surahs.json']
required += [OLD / f'surah_{n:03d}.json' for n in range(1, 115)]
missing = [str(path) for path in required if not path.is_file()]
if missing:
    print('Missing required source/reference files; no output was changed:', file=sys.stderr)
    for path in missing[:30]: print(f'  - {path}', file=sys.stderr)
    if len(missing) > 30: print(f'  ... and {len(missing) - 30} more', file=sys.stderr)
    print('Provide the Tanzil SQL file and a complete Arabic Quran reference data directory.', file=sys.stderr)
    sys.exit(2)
if not args.write:
    print('All inputs are present. Review them, then rerun with --write to replace the generated data.')
    sys.exit(0)

# ---- 1) Tanzil SQL -> text
s=SQL_FILE.read_text(encoding='utf-8')
rows=re.findall(r"\((\d+),\s*(\d+),\s*(\d+),\s*'((?:[^'\\]|\\.|'')*)'\)",s)
assert len(rows)==6236
T={(int(r[1]),int(r[2])):r[3].replace("''","'") for r in rows}
def nm(x): return normalize_for_comparison(x)  # comparison only; never use this for output text
bas=T[(1,1)]; bw=bas.split(' '); assert len(bw)==4
stripped=0
BIS={}                                    # surah -> its Bismillah heading: the SQL file's own text of 1:1
for su in range(2,115):
    t=T[(su,1)]; w=t.split(' ')
    if su==9: assert nm(' '.join(w[:4]))!=nm(bas); continue
    assert nm(' '.join(w[:4]))==nm(bas),(su,t[:40])
    BIS[su]=bas; T[(su,1)]=' '.join(w[4:]); stripped+=1; assert T[(su,1)]
for k, v in T.items():
    # Preserve all harakat and Quranic annotation marks in stored text.
    T[k] = normalize_quran_text(v)
print('basmala prefix removed from',stripped,'surahs')
# ---- 2) per-surah files in the existing structure, one Arabic edition (Tanzil simple)
meta=json.load(open(f'{OLD}/surahs.json',encoding='utf-8'))
diff=0;prevpage=0;pages=set()
for m in meta:
    n=m['number']; old=json.load(open(f'{OLD}/surah_{n:03d}.json',encoding='utf-8'))
    base=old[0]; assert base['numberOfAyahs']==m['numberOfAyahs']==sum(1 for k in T if k[0]==n)
    oc=old[2 if len(old) > 2 else 0]['ayahs']  # Compare against the simple Quran edition, including Lite data
    ays=[]
    for i,a in enumerate(base['ayahs']):
        assert a['numberInSurah']==i+1
        assert a['page']>=prevpage; prevpage=a['page']; pages.add(a['page'])
        txt=T[(n,i+1)]
        if nm(txt).replace(' ','')!=nm(oc[i]['text'].replace('\ufeff','')).replace(' ',''):
            # the reference edition may still carry the basmala on the first ayah
            o=nm(oc[i]['text'].replace('\ufeff','')).replace(' ','')
            if not (i==0 and o.endswith(nm(txt).replace(' ',''))): diff+=1
        ays.append({k:a[k] for k in ('number','numberInSurah','juz','manzil','page','ruku','hizbQuarter','sajda')}|{'text':txt})
    ed={'number':n,'name':base['name'],'englishName':base['englishName'],'englishNameTranslation':base['englishNameTranslation'],'revelationType':base['revelationType'],'numberOfAyahs':base['numberOfAyahs'],**({'bismillah':BIS[n]} if n in BIS else {}),'ayahs':ays,
        'edition':{'identifier':'quran-simple','language':'ar','name':'القرآن الكريم (تنزيل - مبسّط)','englishName':'Tanzil Quran Text (Simple)','format':'text','type':'quran','direction':'rtl'}}
    json.dump([ed],open(f'{P}/surah_{n:03d}.json','w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
print('ayahs whose letters differ from the previous Simple text:',diff,'| pages used:',len(pages),min(pages),max(pages))
# ---- 3) search index: all ayah texts in one small file (data/search-index.json), so searching needs one request only
idx=[[a['text'] for a in json.load(open(f'{P}/surah_{m["number"]:03d}.json',encoding='utf-8'))[0]['ayahs']] for m in meta]
json.dump(idx,open(f'{P}/search-index.json','w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
print('search-index.json written')
