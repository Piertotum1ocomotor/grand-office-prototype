import argparse
from html import unescape
import json,re
from pathlib import Path
from urllib.parse import unquote, urlsplit
root=Path(__file__).resolve().parents[1]/'data'
main=root/'catalog.json'
data=json.loads(main.read_text())
categories={row['id']:row for row in data['categories']}
parser=argparse.ArgumentParser()
parser.add_argument('--categories',type=Path,help='Directory of JSON pages from the public product_cat API')
args=parser.parse_args()
if args.categories:
 sources=[row for page in sorted(args.categories.glob('*.json')) for row in json.loads(page.read_text())]
 if not sources:
  parser.error('no categories found')
 for row in sources:
  category={'id':row['id'],'name':unescape(row['name']),'parent':row['parent'],'slug':row['slug']}
  path=urlsplit(row['link']).path
  if path.startswith('/product-category/'):
   category['path']=path
  categories[row['id']]=category
 data['categories']=list(categories.values())
 for category in categories.values():
  item=category
  slugs=[]
  while item and item.get('slug') and len(slugs)<12:
   slugs.insert(0,unquote(item['slug']))
   item=categories.get(item['parent'])
  if unquote(category.get('path',''))=='/product-category/'+'/'.join(slugs)+'/':
   category.pop('path',None)
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
parts=re.compile(
 r'\b(?:заглушк\w*|креп[её]ж\w*|креплени\w*|держател\w*|фиксато\w*|кабель[ -]+канал\w*|царг\w*'
 r'|опор[аы]|ножк[аи]|столешниц\w*|экран[ы]?|пюпитр\w*|двер[ьи]|фасад\w*|полк[аи]|топ|крышк[аи]|петл[яи]'
 r'|подлокотник\w*|крестовин\w*|подставк\w*|панел[ьи]|ролик\w*|колес[оа]|фурнитур\w*|траверс\w*'
 r'|комплект\s+(?:картер\w*|ящик\w*|двер\w*|боковин\w*|полок|опор|фурнитур\w*)|фронтал[ьи]|вставк\w*'
 r'|лоток|газлифт\w*|суппорт\w*|боковин\w*|вкладыш\w*|штанг\w*|блок\s+розеток|аксессуар\w*)\b',re.I)
modules=re.compile(
 r'\b(?:корпус\w*|модул[ьиь]|приставк\w*|приставн[а-я]+\s+(?:элемент|секци[яи])|надставк\w*'
 r'|надстройк\w*|расширител\w*|антресол[ьи]|каркас\w*|подстоль[ея]|бенч-?секци\w*'
 r'|(?:угловой|соединительный|приставной)\s+элемент|бокс\s+для\s+шкафа|блок\s+ящиков)\b',re.I)
furniture=re.compile(r'\b(?:стол(?:ы|ик(?:и)?)?|кресл[оа]|стул(?:ья)?|шкаф[ы]?|гардероб[ы]?|тумб[аы]|стеллаж[и]?|диван[ы]?|пуф[ы]?|сейф[ы]?|банкетк[аи]|кроват[ьи]|стойк[аи]|вешалк[аи]|перегородк[аи]|скамь[яи])\b',re.I)
dimensions=re.compile(r'(?<!\d)(\d{2,4})\s*[×xх*]\s*(\d{2,4})\s*[×xх*]\s*(\d{2,4})(?!\d)',re.I)
verified_specs={
 244689:('https://merlion.com/b2b/1395947/', {
  'Ширина':'650 мм','Глубина':'650 мм','Диаметр крестовины':'650 мм',
  'Минимальная высота кресла':'855 мм','Ширина сиденья':'440 мм','Глубина сиденья':'440 мм',
  'Максимальная нагрузка':'120 кг','Гарантия производителя':'24 месяца',
 }),
}
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
def type_of(name,ids):
 for text in [name,*[categories.get(cat,{}).get('name','') for cat in ids]]:
  hit=[(m.start(),kind) for kind,pattern in type_patterns.items() if (m:=pattern.search(text))]
  if hit: return min(hit)[1]
 return None

def kind_of(name):
 hits=[(m.start(),kind) for kind,pattern in [('parts',parts),('modules',modules),('furniture',furniture)] if (m:=pattern.search(name))]
 return min(hits)[1] if hits else 'furniture'

# These Bern articles were also assigned to Capital in the source catalog.
excluded_categories = {
 92594: {13998},
 92619: {13996, 27262},
 205657: {13998},
}
for row in data['items']:
 if row[0] in excluded_categories:
  row[6] = [category for category in row[6] if category not in excluded_categories[row[0]]]
 key=row[0]//1000
 if key not in shardfiles:
  p=root/'products'/f'{key}.json'
  shardfiles[key]=(p,json.loads(p.read_text()))
 detail=shardfiles[key][1][str(row[0])]
 verification=verified_specs.get(row[0])
 if verification:
  detail[1]=list((dict(detail[1])|verification[1]).items())
 del row[10:]
 row.extend([type_of(row[1],row[6]),dimensions_of(row[1],detail)])
 del detail[5:]
 detail.extend([None,row.copy()])
 if verification: detail.append(verification[0])
 row.append(kind_of(row[1]))
def write(p,x):
 p.write_text(json.dumps(x,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
for p,shard in shardfiles.values(): write(p,shard)
config=json.loads((root.parent/'site.json').read_text())
kit=config.get('workspaceKit',{})
featured=set(kit.get('products',[]))
featured.update(model for group in kit.get('groups',[]) for model in group['models'])
write(root/'featured.json',[row[:12] for row in data['items'] if row[0] in featured])

# The public catalogue needs no canonical URL per card. Early pages are served on their own.
image_prefix='https://grand-office59.ru/wp-content/uploads/'
def browse_row(row):
 identifier,name,sku,price,upper,image,ids,stock,backorder,url,kind,dimensions,form=row
 return [identifier,name,sku,price,upper,image.removeprefix(image_prefix),ids,backorder,kind,dimensions,form]

output=root/'browse'
output.mkdir(exist_ok=True)
pages_output=output/'pages'
pages_output.mkdir(exist_ok=True)
small_output=output/'small'
small_output.mkdir(exist_ok=True)
page_size=24
pages_per_file=8
small_bucket_size=32
rows=list(map(browse_row,data['items']))
priority=[887,244689,86,986,176,197,204,1046,211,2609,188286,157457]
order={value:index for index,value in enumerate(priority)}
def rank(row):
 return {'furniture':0,'modules':1,'parts':2}[row[10]],order.get(row[0],len(order))
rows.sort(key=rank)
scopes={'all':rows}
for key in types:
 scopes[key]=[row for row in rows if row[8]==key and row[10]=='furniture']
by_category={key:[] for key in categories}
for row in rows:
 ancestry=set()
 for identifier in row[6]:
  while identifier in categories and identifier not in ancestry:
   ancestry.add(identifier)
   identifier=categories[identifier]['parent']
 for identifier in ancestry: by_category[identifier].append(row)
for identifier,items in by_category.items():
 if not categories[identifier]['parent'] or len(items)>=150:
  scopes[str(identifier)]=items
 categories[identifier].pop('partsOnly',None)
 categories[identifier].pop('empty',None)
 if not items:
  categories[identifier]['empty']=True
 if items and not any(row[10]=='furniture' for row in items):
  categories[identifier]['partsOnly']=True
expected=set()
def display_row(row):
 return row[:6]+[[],*row[7:]]

for key,items in scopes.items():
 display_rows=list(map(display_row,items))
 first_page=output/(key+'.json')
 expected.add(first_page)
 write(first_page,{'count':len(items),'rows':display_rows[:page_size]})
 for block,start in enumerate(range(page_size,len(items),page_size*pages_per_file)):
  chunk=pages_output/f'{key}-{block}.json'
  expected.add(chunk)
  write(chunk,display_rows[start:start+page_size*pages_per_file])
small_scopes={}
for identifier,items in by_category.items():
 if str(identifier) not in scopes and categories[identifier].get('slug') and items:
  small_scopes.setdefault(identifier//small_bucket_size,{})[identifier]=list(map(display_row,items))
for block,items in small_scopes.items():
 chunk=small_output/f'{block}.json'
 expected.add(chunk)
 write(chunk,items)
write(output/'sections.json',{'categories':data['categories'],'previews':{key:len(items) for key,items in scopes.items()}})
write(main,data)
write(output/'index.json',rows)
for path in [*output.glob('*.json'),*pages_output.glob('*.json'),*small_output.glob('*.json')]:
 if path not in expected and path.name not in ('sections.json','index.json'): path.unlink()
print(len(data['items']),'products with',sum(r[10] is not None for r in data['items']),'types and',sum(r[11] is not None for r in data['items']),'dimensions')
for k in types: print(k,sum(row[10]==k for row in data['items']))
