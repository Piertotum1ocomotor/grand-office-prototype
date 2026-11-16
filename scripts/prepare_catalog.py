import json,re
from pathlib import Path
root=Path(__file__).resolve().parents[1]/'data'
main=root/'catalog.json'
data=json.loads(main.read_text())
categories={row['id']:row for row in data['categories']}
shardfiles={}
types={
 'tables':r'\bстол(?:ы|а|ов|ик(?:и)?)?\b',
 'chairs':r'\b(?:кресл(?:о|а|ов)?|стул(?:ья|а|ьев)?)\b',
 'cabinets':r'\b(?:шкаф(?:ы|а|ов)?|гардероб(?:ы|а|ов)?)\b',
 'pedestals':r'\bтумб(?:а|ы|очка|очки)?\b',
 'shelving':r'\bстеллаж(?:и|а|ей)?\b',
 'sofas':r'\bдиван(?:ы|а|ов)?\b',
}
type_patterns={key:re.compile(value,re.I) for key,value in types.items()}
dimensions=re.compile(r'(?<!\d)(\d{2,4})\s*[×xх*]\s*(\d{2,4})\s*[×xх*]\s*(\d{2,4})(?!\d)',re.I)
def dimensions_of(name,detail):
 source=re.search(r'(?:размеры|габариты)(?:\s+изделия)?(?:\s*\([^)]{1,22}\))?\s*[:—–-]\s*([^.;]+)',detail[3],re.I)
 match=(dimensions.search(source[1]) if source else None) or dimensions.search(name)
 result=[int(x) for x in match.groups()] if match else [None,None,None]
 labels=['ширина','глубина','высота']
 for label,value in detail[1]:
  attribute=label.casefold().strip()
  for i,key in enumerate(labels):
   if attribute==key or attribute==key+', мм' or attribute==key+' (мм)':
    match=re.fullmatch(r'[\s\u00a0]*(\d{2,4})(?:[\s\u00a0]*мм)?\s*',value,re.I)
    if match: result[i]=int(match[1])
 return result if any(value is not None for value in result) else None
def kind_of(name,ids):
 for text in [name,*[categories.get(cat,{}).get('name','') for cat in ids]]:
  hit=[(m.start(),kind) for kind,pattern in type_patterns.items() if (m:=pattern.search(text))]
  if hit: return min(hit)[1]
 return None
for row in data['items']:
 key=row[0]//1000
 if key not in shardfiles:
  p=root/'products'/f'{key}.json'
  shardfiles[key]=(p,json.loads(p.read_text()))
 detail=shardfiles[key][1][str(row[0])]
 del row[10:]
 row.extend([kind_of(row[1],row[6]),dimensions_of(row[1],detail)])
 del detail[5:]
 detail.extend([None,row])
def write(p,x):
 p.write_text(json.dumps(x,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
write(main,data)
for p,shard in shardfiles.values(): write(p,shard)
config=json.loads((root.parent/'site.json').read_text())
kit=config.get('workspaceKit',{})
featured=set(kit.get('products',[]))
featured.update(model for group in kit.get('groups',[]) for model in group['models'])
write(root/'featured.json',[row for row in data['items'] if row[0] in featured])
print(len(data['items']),'products with',sum(r[10] is not None for r in data['items']),'types and',sum(r[11] is not None for r in data['items']),'dimensions')
for k in types: print(k,sum(row[10]==k for row in data['items']))
