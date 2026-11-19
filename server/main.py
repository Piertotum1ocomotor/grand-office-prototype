import argparse
import base64
import binascii
import csv
from collections import Counter
from contextlib import contextmanager
from datetime import date, datetime, timezone, timedelta
from functools import lru_cache
import gzip
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
from ipaddress import ip_address
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import sqlite3
import ssl
import time
from threading import Lock
from urllib.parse import urlsplit, parse_qs
from urllib.request import Request, HTTPRedirectHandler, HTTPSHandler, build_opener
import xml.etree.ElementTree as ET

from routing import NotFound, PAGES, PROJECTS, Routes
from seo import document

ROOT = Path(__file__).resolve().parents[1]
DB = Path(os.environ.get('GRAND_DB', ROOT / 'data-private/store.sqlite3'))
ADMIN_USER = os.environ.get('GRAND_ADMIN_USER', 'office')
ADMIN_PASSWORD = os.environ.get('GRAND_ADMIN_PASSWORD', '')
EXPRO_URL = os.environ.get('GRAND_EXPRO_URL', '')
ORIGINAL_STORE = 'https://grand-office59.ru'

def configured_origin(name, default=''):
    value = os.environ.get(name,default).rstrip('/')
    parsed = urlsplit(value)
    if value and (parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment):
        raise ValueError(f'{name} должен содержать HTTPS-адрес без пути.')
    return value

SOURCE_STORE = configured_origin('GRAND_LEGACY_ORIGIN', ORIGINAL_STORE)
PUBLIC_ORIGIN = configured_origin('GRAND_PUBLIC_ORIGIN')
INDEXABLE = bool(PUBLIC_ORIGIN) and os.environ.get('GRAND_INDEXABLE') == '1'
USE_PROXY_ADDRESS = os.environ.get('GRAND_TRUST_PROXY') == '1'
recent_variants = {}
variant_lock = Lock()
MAX_FILE = 8 * 1024 * 1024
MAX_FEED = 30 * 1024 * 1024
STALE_AFTER = timedelta(hours=float(os.environ.get('GRAND_STOCK_TTL_HOURS', '36')))
FILES = {'index.html', 'style.css', 'store.js', 'app.js', 'workspace.js', 'planner.js', 'site.json'}
ALLOWED_TYPES = {
    'application/pdf': (b'%PDF-',),
    'image/jpeg': (b'\xff\xd8\xff',),
    'image/png': (b'\x89PNG\r\n\x1a\n',),
}

class Problem(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status

def now():
    return datetime.now(timezone.utc).isoformat()

@contextmanager
def database():
    DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB, timeout=8)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            yield conn
    finally:
        conn.close()

def init():
    with database() as db:
        db.executescript("""
          PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS requests(
            id INTEGER PRIMARY KEY, token TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
            created TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'Новая',
            payload TEXT NOT NULL, file_name TEXT, file_type TEXT, file_data BLOB
          );
          CREATE TABLE IF NOT EXISTS edits(
            product INTEGER NOT NULL, variant INTEGER NOT NULL, price REAL,
            stock INTEGER, updated TEXT NOT NULL, PRIMARY KEY(product,variant)
          );
          CREATE TABLE IF NOT EXISTS supplier_values(
            product INTEGER NOT NULL, variant INTEGER NOT NULL, price REAL,
            stock INTEGER, updated TEXT NOT NULL, PRIMARY KEY(product,variant)
          );
          CREATE TABLE IF NOT EXISTS product_content(
            product INTEGER PRIMARY KEY, name TEXT, description TEXT
          );
          CREATE TABLE IF NOT EXISTS links(
            supplier TEXT NOT NULL, offer TEXT NOT NULL, product INTEGER NOT NULL, variant INTEGER NOT NULL,
            multiplier REAL NOT NULL, PRIMARY KEY(supplier,offer), UNIQUE(product,variant)
          );
          CREATE TABLE IF NOT EXISTS imports(
            id INTEGER PRIMARY KEY, supplier TEXT NOT NULL, created TEXT NOT NULL,
            state TEXT NOT NULL, parsed INTEGER NOT NULL, applied INTEGER NOT NULL, issue TEXT
          );
          CREATE TABLE IF NOT EXISTS limits(
            ip TEXT NOT NULL, bucket INTEGER NOT NULL, hits INTEGER NOT NULL, PRIMARY KEY(ip,bucket)
          );
        """)

@lru_cache(maxsize=1)
def catalog():
    raw = json.loads((ROOT / 'data/catalog.json').read_text(encoding='utf-8'))
    facts = json.loads((ROOT / 'data/catalog-facts.json').read_text(encoding='utf-8'))
    parts = set(facts['parts'])
    for row in raw['items']:
        row[11] = facts['dimensions'].get(str(row[0]), row[11])
        if row[0] in parts:
            row[12] = 'parts'
    return raw, {row[0]: row for row in raw['items']}

@lru_cache(maxsize=1)
def routes():
    unlisted = json.loads((ROOT/'data/indexing.json').read_text(encoding='utf-8'))['unlistedProducts']
    return Routes(catalog()[0],unlisted)

@lru_cache(maxsize=1)
def storefront_template():
    return (ROOT/'index.html').read_text(encoding='utf-8')

@lru_cache(maxsize=1)
def sitemap():
    root = ET.Element('urlset',xmlns='http://www.sitemaps.org/schemas/sitemap/0.9')
    for path in routes().sitemap_paths():
        ET.SubElement(ET.SubElement(root,'url'),'loc').text = PUBLIC_ORIGIN+path
    return ET.tostring(root,encoding='utf-8',xml_declaration=True)

@lru_cache(maxsize=40)
def shard(key):
    path = ROOT / 'data/products' / f'{key}.json'
    return json.loads(path.read_text(encoding='utf-8')) if path.is_file() else {}

def record(product):
    row = catalog()[1].get(product)
    if row is None:
        raise Problem('Товар не найден.',404)
    return row

def detail(product):
    record(product)
    return shard(product // 1000).get(str(product), [[],[],[],'',None])

def active_stock(edit):
    if edit is None or datetime.fromisoformat(edit['updated']) + STALE_AFTER < datetime.now(timezone.utc):
        return None
    return edit['stock']

def price_map(db, table):
    return {r['product']:r['price'] for r in db.execute(f'SELECT product,price FROM {table} WHERE variant=0 AND price IS NOT NULL')}

def edit_map(db, table, product):
    return {r['variant']:r for r in db.execute(f'SELECT * FROM {table} WHERE product=?',(product,))}

def combined(manual, supplier):
    price = manual['price'] if manual is not None and manual['price'] is not None else supplier['price'] if supplier is not None else None
    return price, active_stock(manual if manual is not None and manual['stock'] is not None else supplier)

def catalog_overrides():
    with database() as db:
        prices = price_map(db,'supplier_values') | price_map(db,'edits')
        names = {r['product']:r['name'] for r in db.execute('SELECT product,name FROM product_content WHERE name IS NOT NULL')}
    return prices,names

def public_catalog():
    raw, _ = catalog()
    prices,names = catalog_overrides()
    return {'categories':raw['categories'], 'items':[
      [original[0],names.get(original[0],original[1]),original[2],prices.get(original[0],original[3]),None if original[0] in prices else original[4],*original[5:]]
      if original[0] in prices or original[0] in names else original for original in raw['items']
    ]}

def public_detail(product):
    original = detail(product)
    with database() as db:
        edits = edit_map(db,'edits',product)
        suppliers = edit_map(db,'supplier_values',product)
        content = db.execute('SELECT description FROM product_content WHERE product=?',(product,)).fetchone()
    options = [o + list(combined(edits.get(o[0]),suppliers.get(o[0]))) if o[0] in edits or o[0] in suppliers else o for o in original[2]]
    description = content['description'] if content and content['description'] is not None else original[3]
    summary = record(product).copy()
    price,_ = combined(edits.get(0),suppliers.get(0))
    if price is not None: summary[3:5] = [price,None]
    with database() as db:
        name = db.execute('SELECT name FROM product_content WHERE product=?',(product,)).fetchone()
    if name and name['name']: summary[1] = name['name']
    return [original[0],original[1],options,description,original[4],combined(edits.get(0),suppliers.get(0))[1],summary,*original[7:]]

def text(payload, key, size, required=False):
    value = payload.get(key,'')
    if not isinstance(value,str) or len(value)>size or (required and not value.strip()):
        raise Problem('Проверьте обязательные поля и длину текста.')
    return value.strip()

def integer(value, low, high):
    if type(value) is int:
        result = value
    elif isinstance(value,str) and value.isdecimal():
        result = int(value)
    else:
        raise Problem('Проверьте числовые поля.')
    if result < low or result > high:
        raise Problem('Значение выходит за допустимый диапазон.')
    return result

def amount(value, maximum=100_000_000):
    if value in ('', None):
        return None
    try:
        number = float(value)
    except (ValueError, TypeError):
        raise Problem('Укажите корректную цену.')
    if type(value) is bool or not 0 <= number <= maximum:
        raise Problem('Укажите корректную цену.')
    return round(number,2)

def variant_id(product,value):
    variant = integer(value,0,999_999_999)
    options = detail(product)[2]
    if variant and not any(v[0]==variant for v in options):
        raise Problem('Вариант не относится к товару.')
    return variant

def address_request(data):
    contact = text(data,'contact',140,True)
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',contact) and len(re.sub(r'\D','',contact)) < 7:
        raise Problem('Укажите телефон или электронную почту.')
    if data.get('consent')!='on':
        raise Problem('Подтвердите согласие на обработку данных.')
    return {'name':text(data,'name',100,True), 'contact':contact, 'city':text(data,'city',80,True)}

def attachment(file):
    if not file:
        return None,None,None
    if not isinstance(file,dict):
        raise Problem('Файл не распознан.')
    name = text(file,'name',220,True)
    kind = file.get('type')
    if kind not in ALLOWED_TYPES:
        raise Problem('Допустимы PDF, JPG и PNG.')
    try:
        content=base64.b64decode(file.get('base64',''),validate=True)
    except (ValueError,TypeError,binascii.Error):
        raise Problem('Файл не распознан.')
    if not 0 < len(content) <= MAX_FILE or not content.startswith(ALLOWED_TYPES[kind]):
        raise Problem('Проверьте формат файла и размер до 8 МБ.')
    safe_name = next((a for a in reversed(re.split(r'[\\/]',name)) if a), 'attachment')
    return safe_name,kind,content

def cached_source_variant(product,variant):
    with variant_lock:
        found = recent_variants.get((product,variant))
        return found[1] if found and time.monotonic()-found[0]<600 else {}

def source_variant(product,variant):
    found = cached_source_variant(product,variant)
    if found:
        return found
    url = f'{SOURCE_STORE}/wp-json/wc/store/v1/products/{variant}?_fields=id,parent,prices,images,is_on_backorder'
    try:
        with verified_opener().open(Request(url,headers={'User-Agent':'Grand Office storefront'}),timeout=3.5) as response:
            raw = response.read(256 * 1024 + 1)
        if len(raw) > 256 * 1024:
            return {}
        data = json.loads(raw)
        if not isinstance(data,dict) or data.get('id')!=variant or data.get('parent')!=product:
            return {}
        pricing = data.get('prices') or {}
        price = int(pricing.get('price') or 0) / 10**int(pricing.get('currency_minor_unit',0)) if pricing.get('currency_code')=='RUB' else None
        images = data.get('images') or []
        image = images[0].get('src') if images and isinstance(images[0],dict) else ''
        if not isinstance(image,str) or not image.startswith((ORIGINAL_STORE+'/wp-content/uploads/',SOURCE_STORE+'/wp-content/uploads/')):
            image = ''
        payload = {'price':price if price and price>0 else None,'image':image,'backorder':data.get('is_on_backorder') is True}
    except (OSError,ValueError,TypeError,AttributeError):
        return {}
    with variant_lock:
        if len(recent_variants)>=512:
            recent_variants.pop(next(iter(recent_variants)))
        recent_variants[product,variant] = (time.monotonic(),payload)
    return payload

def public_variant(product,variant):
    if not variant or variant_id(product,variant)!=variant:
        raise Problem('Вариант не найден.',404)
    public = source_variant(product,variant)
    with database() as db:
        manual = edit_map(db,'edits',product).get(variant)
        supplier = edit_map(db,'supplier_values',product).get(variant)
    price,stock = combined(manual,supplier)
    return {**public,'price':price if price is not None else public.get('price'),'stock':stock}

def request_order(db, lines):
    if not isinstance(lines,list) or not 1<=len(lines)<=100:
        raise Problem('Проверьте состав заказа.')
    result=[]
    for line in lines:
        if not isinstance(line,dict):
            raise Problem('Проверьте состав заказа.')
        product = integer(line.get('id'),1,999_999_999)
        row = record(product)
        qty = integer(line.get('qty'),1,999)
        option = variant_id(product,line.get('choice',0))
        options=detail(product)[2]
        if options and not option:
            raise Problem('Выберите вариант товара.')
        edit = db.execute('SELECT * FROM edits WHERE product=? AND variant=?',(product,option)).fetchone()
        supplier = db.execute('SELECT * FROM supplier_values WHERE product=? AND variant=?',(product,option)).fetchone()
        edited_price,current = combined(edit,supplier)
        if current is not None and qty > current:
            raise Problem(f'Уточните количество для товара {row[1]}.')
        source_price = cached_source_variant(product,option).get('price') if option else row[3]
        price = edited_price if edited_price is not None else source_price
        label_override = db.execute('SELECT name FROM product_content WHERE product=?',(product,)).fetchone()
        label = next((v[1] for v in options if v[0]==option),'')
        result.append({'id':product,'sku':row[2],'name':(label_override['name'] if label_override and label_override['name'] else row[1]),'variant':label,'qty':qty,'price':price})
    return result

@lru_cache(maxsize=1)
def site_config():
    return json.loads((ROOT / 'site.json').read_text(encoding='utf-8'))

def quote_selection(data,kit,count):
    supplied = data.get('kitLines')
    finish = text(data,'kitFinish',140)
    if supplied is None:
        if finish:
            raise Problem('Укажите варианты мебели для выбранной отделки.')
        return [(identifier,count,0) for identifier in kit['products']]
    groups = {group['id']: group for group in kit.get('groups', [])}
    if not isinstance(supplied,list) or not 1 <= len(supplied) <= len(groups):
        raise Problem('Проверьте состав комплекта.')
    selected = {}
    for line in supplied:
        if not isinstance(line,dict):
            raise Problem('Проверьте позиции комплекта.')
        choice = text(line,'group',35,True)
        item_id = integer(line.get('id'),1,999_999_999)
        quantity = integer(line.get('qty'),1,5000)
        if choice not in groups or choice in selected or item_id not in groups[choice]['models']:
            raise Problem('Проверьте выбранные модели.')
        variant = variant_id(item_id,line.get('choice',0))
        if finish and choice in {'desk','storage'}:
            label = next((option[1] for option in detail(item_id)[2] if option[0]==variant),'')
            if re.sub(r'\s+',' ',label.strip()).casefold() != re.sub(r'\s+',' ',finish.strip()).casefold():
                raise Problem('Проверьте общую отделку столов и тумб.')
        selected[choice] = (item_id,quantity,variant)
    if any(key not in selected for key,group in groups.items() if not group.get('optional')):
        raise Problem('Выберите столы и кресла для комплекта.')
    return list(selected.values())

def plan_measure(value, minimum, maximum):
    if type(value) not in (int,float) or not minimum <= value <= maximum:
        raise Problem('Проверьте размеры и позиции на плане.')
    return round(value,3)

def editable_plan(plan, kit_lines=None):
    width = plan_measure(plan.get('width'),2,60)
    depth = plan_measure(plan.get('depth'),2,60)
    objects = plan.get('items')
    if not isinstance(objects,list) or not 1 <= len(objects) <= 120:
        raise Problem('Добавьте предметы на план.')
    models = {model:group['id'] for group in site_config()['workspaceKit']['groups'] for model in group['models']}
    furniture = Counter()
    custom_desks = 0
    used_ids = set()
    entries = []
    boxes = []
    for item in objects:
        if not isinstance(item,dict):
            raise Problem('Предмет на плане не распознан.')
        ident = integer(item.get('id'),1,9_999_999)
        model = integer(item.get('product'),0,999_999_999)
        rotation = integer(item.get('rotation'),0,270)
        if ident in used_ids or rotation not in {0,90,180,270}:
            raise Problem('Проверьте номера предметов и углы поворота.')
        used_ids.add(ident)
        kind = item.get('type')
        extra = {}
        if model and models.get(model)==kind:
            row = record(model)
            if not row[11] or not all(row[11][:2]):
                raise Problem('У модели отсутствуют габариты.')
            span, height = (size/1000 for size in row[11][:2])
            label = row[1]
            furniture[model] += 1
        elif not model and kind=='desk':
            span = plan_measure(item.get('width'),.3,4)
            height = plan_measure(item.get('depth'),.3,4)
            desk_height = plan_measure(item.get('height',.75),.4,1.6)
            label = f'Стол по размеру {round(span*1000)} × {round(height*1000)} × {round(desk_height*1000)} мм'
            extra['height'] = desk_height
            custom_desks += 1
        elif not model and kind in ('door','column'):
            span = plan_measure(item.get('width'),.1,3)
            height = plan_measure(item.get('depth'),.1,3)
            label = 'Дверной проём' if kind=='door' else 'Колонна'
        else:
            raise Problem('На плане есть неизвестная модель или предмет.')
        x = plan_measure(item.get('x'),0,width)
        y = plan_measure(item.get('y'),0,depth)
        w, h = (height,span) if rotation%180 else (span,height)
        if x+w > width+.001 or y+h > depth+.001 or any(
            x+.001<s+dx and s+.001<x+w and y+.001<t+dy and t+.001<y+h for s,t,dx,dy in boxes
        ):
            raise Problem('Устраните пересечения и проверьте границы комнаты.')
        boxes.append((x,y,w,h))
        entries.append({'id':ident,'type':kind,'product':model,'label':label,
                        'x':x,'y':y,'width':span,'depth':height,'rotation':rotation,**extra})
    if not furniture and not custom_desks:
        raise Problem('Добавьте на план хотя бы один предмет мебели.')
    if kit_lines is not None and (custom_desks or dict(furniture)!={line['id']:line['qty'] for line in kit_lines}):
        raise Problem('Модели и количества в смете должны совпадать с планом.')
    office = text(plan,'office',16) or 'open'
    if office not in ('open','private','meeting','free'):
        raise Problem('Выберите тип офиса из списка.')
    return {'v':2,'office':office,'width':width,'depth':depth,'items':entries}

def quote_plan(data, count, desk, kit_lines):
    plan = data.get('roomPlan')
    if not plan:
        return None
    if isinstance(plan,dict) and plan.get('v')==2:
        return editable_plan(plan,kit_lines)
    if not isinstance(plan,dict) or plan.get('layout') not in ('single','double','islands'):
        raise Problem('Проверьте план расстановки.')
    metrics = {key:amount(plan.get(key),maximum) for key,maximum in [('width',60),('depth',60),('gap',4)]}
    if any(metrics[key] is None or metrics[key]<minimum for key,minimum in [('width',2),('depth',2),('gap',0.5)]):
        raise Problem('Проверьте размеры комнаты и расстояние между рядами.')
    if not desk or desk['qty'] != count or count > 40 or plan.get('seats',count)!=count or plan.get('desk',desk['id'])!=desk['id']:
        raise Problem('Проверьте число столов и модель в расстановке.')
    size = record(desk['id'])[11]
    if not size or not all(size[:2]):
        raise Problem('У выбранного стола отсутствуют габариты для расстановки.')
    width, depth = (millimeters/1000 for millimeters in size[:2])
    layout = plan['layout']
    gap = metrics['gap']
    main_row = depth+0.7
    if layout == 'single':
        required_width, required_depth = count*width, main_row
    elif layout == 'double':
        required_width = ((count+1)//2)*width
        required_depth = 2*main_row+gap if count>1 else main_row
    else:
        groups, last = divmod(count-1,4)
        required_width = groups*(2*width+gap)+min(last+1,2)*width
        required_depth = 2*main_row+gap if count>2 else main_row
    if required_width>metrics['width']+0.00001 or required_depth>metrics['depth']+0.00001:
        raise Problem('Выбранная расстановка выходит за границы комнаты.')
    return {**metrics,'layout':plan['layout']}

def request_deadline(data):
    deadline = text(data,'date',20)
    if deadline:
        try:
            deadline = date.fromisoformat(deadline).isoformat()
        except ValueError:
            raise Problem('Укажите дату готовности офиса.')
    return deadline

def project_request(db,data):
    count = integer(data['seats'],1,5000) if data.get('seats') not in (None,'') else None
    payload = {
        'seats': count, 'date': request_deadline(data), 'task': text(data,'task',1600),
        'address': text(data,'address',250), 'product': text(data,'product',350)
    }
    if data.get('topic') == 'delivery':
        payload['topic'] = 'delivery'
    if data.get('caseId'):
        case_id = text(data,'caseId',40)
        if case_id not in PROJECTS:
            raise Problem('Выберите проект из портфолио.')
        payload.update(caseId=case_id,example=PROJECTS[case_id])
    if data.get('productId'):
        identifier = integer(data['productId'],1,999_999_999)
        row = record(identifier)
        variant = variant_id(identifier,data.get('variantId',0))
        label = next((option[1] for option in detail(identifier)[2] if option[0]==variant),'')
        content = db.execute('SELECT name FROM product_content WHERE product=?',(identifier,)).fetchone()
        payload.update(product=content['name'] if content and content['name'] else row[1],
                       productId=identifier,sku=row[2],variant=label,variantId=variant,
                       quantity=integer(data.get('quantity'),1,5000))
    choice = text(data,'kit',40)
    config = site_config()
    kit = config.get('workspaceKit')
    if not choice:
        plan = data.get('roomPlan')
        if plan:
            if not isinstance(plan,dict) or plan.get('v')!=2:
                raise Problem('Проверьте план расстановки.')
            payload['roomPlan'] = editable_plan(plan)
        return payload
    if not kit or choice != kit['id'] or count is None:
        raise Problem('Выберите комплект из списка.')
    output = []
    for product,quantity,variant in quote_selection(data,kit,count):
        product_row = record(product)
        manual = edit_map(db,'edits',product).get(variant)
        supplier = edit_map(db,'supplier_values',product).get(variant)
        updated_price, _ = combined(manual,supplier)
        content = db.execute('SELECT name FROM product_content WHERE product=?',(product,)).fetchone()
        source_price = cached_source_variant(product,variant).get('price') if variant else product_row[3]
        output.append({
            'id': product, 'name': (content['name'] if content and content['name'] else product_row[1]),
            'sku': product_row[2], 'qty': quantity, 'variantId':variant,
            'variant':next((option[1] for option in detail(product)[2] if option[0]==variant),''),
            'price': updated_price if updated_price is not None else source_price
        })
    rates = config.get('localRates')
    local = text(data,'city',80,True).casefold() == config.get('officeCity','').casefold()
    furniture = None if any(row['price'] is None for row in output) else round(sum(row['price'] * row['qty'] for row in output),2)
    delivery = rates['deliveryFrom'] if local and rates else None
    assembly = round(furniture * rates['assemblyPercent'] / 100,2) if local and rates and furniture is not None else None
    total = round(furniture + delivery + assembly,2) if all(value is not None for value in (furniture,delivery,assembly)) else None
    desk_ids = next((group['models'] for group in kit.get('groups',[]) if group['id']=='desk'),kit['products'][:1])
    desk = next((row for row in output if row['id'] in desk_ids),None)
    payload.update(kit=kit['name'],finish=text(data,'kitFinish',140),lines=output,roomPlan=quote_plan(data,count,desk,output),estimate={
        'furniture':furniture,'deliveryFrom':delivery,'assembly':assembly,'totalFrom':total
    })
    return payload

def create_request(data,ip):
    token = text(data,'token',64,True)
    if not re.fullmatch(r'[a-zA-Z0-9-]{16,64}',token):
        raise Problem('Обновите страницу и повторите отправку.')
    kind = data.get('kind')
    if kind not in {'order','project'}:
        raise Problem('Проверьте тип обращения.')
    payload = address_request(data)
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        prior = db.execute('SELECT id FROM requests WHERE token=?',(token,)).fetchone()
        if prior:
            return {'id':prior['id']}
        bucket = int(time.time()//900)
        db.execute('INSERT INTO limits VALUES(?,?,1) ON CONFLICT(ip,bucket) DO UPDATE SET hits=hits+1',(ip,bucket))
        hits=db.execute('SELECT hits FROM limits WHERE ip=? AND bucket=?',(ip,bucket)).fetchone()['hits']
        if hits>12:
            raise Problem('Слишком много обращений. Повторите попытку позже.',429)
        db.execute('DELETE FROM limits WHERE bucket<?',(bucket-2,))
        filename,mime,content=None,None,None
        if kind=='order':
            payload.update(address=text(data,'address',250), delivery=text(data,'delivery',140),
                           date=request_deadline(data), task=text(data,'task',1600),
                           lines=request_order(db,data.get('lines')))
        else:
            payload.update(project_request(db,data))
            filename,mime,content=attachment(data.get('file'))
        values = (token,kind,now(),json.dumps(payload,ensure_ascii=False),filename,mime,content)
        db.execute('INSERT OR IGNORE INTO requests(token,kind,created,payload,file_name,file_type,file_data) VALUES(?,?,?,?,?,?,?)',values)
        return {'id':db.execute('SELECT id FROM requests WHERE token=?',(token,)).fetchone()['id']}

def change_product(data):
    product=integer(data.get('product'),1,999_999_999)
    variant=variant_id(product,data.get('variant',0))
    stock=data.get('stock')
    stock=None if stock in ('',None) else integer(stock,0,1_000_000)
    price=amount(data.get('price'))
    with database() as db:
        db.execute('INSERT INTO edits VALUES(?,?,?,?,?) ON CONFLICT(product,variant) DO UPDATE SET price=excluded.price,stock=excluded.stock,updated=excluded.updated',(product,variant,price,stock,now()))
        if not variant and ('name' in data or 'description' in data):
            name=text(data,'name',350) or None
            description=text(data,'description',3500) or None
            db.execute('INSERT INTO product_content VALUES(?,?,?) ON CONFLICT(product) DO UPDATE SET name=excluded.name,description=excluded.description',(product,name,description))
    return {'ok': True}

def link_offer(data):
    supplier=text(data,'supplier',40,True).lower()
    offer=text(data,'offer',100,True)
    product=integer(data.get('product'),1,999_999_999)
    variant=variant_id(product,data.get('variant',0))
    multiplier=amount(data.get('multiplier'),100)
    if not multiplier or multiplier < 0.01:
        raise Problem('Укажите коэффициент расчёта цены.')
    try:
        with database() as db:
            db.execute('INSERT INTO links VALUES(?,?,?,?,?) ON CONFLICT(supplier,offer) DO UPDATE SET product=excluded.product,variant=excluded.variant,multiplier=excluded.multiplier',(supplier,offer,product,variant,multiplier))
    except sqlite3.IntegrityError:
        raise Problem('У варианта уже есть привязка к поставщику.')
    return {'ok': True}

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None

def verified_opener():
    system_bundle = Path('/etc/ssl/cert.pem')
    fallback = str(system_bundle) if not ssl.get_default_verify_paths().cafile and system_bundle.is_file() else None
    return build_opener(NoRedirect(), HTTPSHandler(context=ssl.create_default_context(cafile=fallback)))

def feed_rows(supplier,data):
    if supplier=='expro' and not data:
        endpoint=urlsplit(EXPRO_URL)
        if endpoint.scheme!='https' or endpoint.hostname not in {'expro.ru','www.expro.ru'} or endpoint.username is not None:
            raise Problem('Задайте ссылку XML «Экспро» в настройке сервера.')
        try:
            with verified_opener().open(Request(EXPRO_URL,headers={'User-Agent':'Grand Office catalog sync'}),timeout=20) as response:
                raw=response.read(MAX_FEED+1)
            if len(raw)>MAX_FEED or re.search(rb'<!DOCTYPE|<!ENTITY',raw,re.I):
                raise Problem('Неподдерживаемый XML.')
            tree=ET.fromstring(raw)
            return [(v.get('id'),v.findtext('price'),v.findtext('count')) for v in tree.findall('./shop/offers/offer')]
        except (OSError,ET.ParseError):
            raise Problem('Выгрузка поставщика недоступна.')
    reader=csv.DictReader(io.StringIO(data.lstrip('\ufeff')))
    if not {'offer_id','price','stock'} <= set(reader.fieldnames or []):
        raise Problem('В файле нужны колонки offer_id, price, stock.')
    return [(v['offer_id'],v['price'],v['stock']) for v in reader]

def import_feed(data):
    supplier=text(data,'supplier',40,True).lower()
    source=text(data,'csv',2_000_000)
    apply=data.get('apply') is True
    errors=[]
    try:
        rows=feed_rows(supplier,source)
        if not rows:
            raise Problem('Выгрузка пуста.')
        with database() as db:
            links={r['offer']:r for r in db.execute('SELECT * FROM links WHERE supplier=?',(supplier,))}
            sample=[]
            matched=[]
            seen=set()
            for offer,cost,quantity in rows:
                if not offer or offer in seen:
                    raise Problem('В выгрузке пустой или повторный ID предложения.')
                seen.add(offer)
                row=links.get(offer)
                if not row:
                    continue
                try:
                    cost=amount(cost)
                    stock=integer(quantity,0,1_000_000)
                    price=amount(cost*row['multiplier']) if cost else None
                    if price is None:
                        raise Problem('Нет цены предложения.')
                except Problem:
                    errors.append(offer)
                    continue
                matched.append((row['product'],row['variant'],price,stock))
                if len(sample)<60:
                    sample.append({'offer':offer,'product':row['product'],'variant':row['variant'],'price':price,'stock':stock})
            if apply and errors:
                raise Problem('Исправьте строки с ошибочными ценами или количеством.')
            stage='Применено' if apply else 'Проверено'
            if apply:
                db.executemany('INSERT INTO supplier_values VALUES(?,?,?,?,?) ON CONFLICT(product,variant) DO UPDATE SET price=excluded.price,stock=excluded.stock,updated=excluded.updated', [(*r,now()) for r in matched])
            db.execute('INSERT INTO imports(supplier,created,state,parsed,applied,issue) VALUES(?,?,?,?,?,?)',(supplier,now(),stage,len(rows),len(matched) if apply else 0,','.join(errors[:30])))
            return {'rows':len(rows),'matches':len(matched),'unlinked':len(rows)-len(matched)-len(errors),'issues':errors[:30],'sample':sample,'state':stage}
    except Problem as err:
        with database() as db:
            db.execute('INSERT INTO imports(supplier,created,state,parsed,applied,issue) VALUES(?,?,?,?,?,?)',(supplier,now(),'Ошибка',0,0,str(err)))
        raise

class SiteServer(BaseHTTPRequestHandler):
    def response(self,status,data,kind='application/json; charset=utf-8',extra=None):
        body = json.dumps(data,ensure_ascii=False).encode('utf-8') if kind.startswith('application/json') and not isinstance(data,bytes) else data
        headers = dict(extra or {})
        if len(body) >= 8192 and kind.startswith(('application/json','text/','application/xml')):
            headers['Vary'] = 'Accept-Encoding'
            permits_gzip = any(re.fullmatch(r'gzip(?:;\s*q=(?:1(?:\.0+)?|0?\.\d*[1-9]\d*))?',coding.strip(),re.I)
                               for coding in self.headers.get('Accept-Encoding','').split(','))
            if permits_gzip:
                body = gzip.compress(body,compresslevel=5,mtime=0)
                headers['Content-Encoding'] = 'gzip'
        self.send_response(status)
        self.send_header('Content-Type',kind)
        self.send_header('Content-Length',str(len(body)))
        self.send_header('X-Content-Type-Options','nosniff')
        if self.path.startswith(('/api/','/office')):
            self.send_header('Cache-Control','no-store')
        for name,value in headers.items():
            self.send_header(name,value)
        self.end_headers()
        if self.command!='HEAD':
            self.wfile.write(body)

    def admin(self):
        configured = ADMIN_PASSWORD and len(ADMIN_PASSWORD)>=16
        expected = 'Basic '+base64.b64encode((ADMIN_USER+':'+ADMIN_PASSWORD).encode()).decode()
        if configured and secrets.compare_digest(self.headers.get('Authorization','').encode(),expected.encode()):
            return True
        self.response(401 if configured else 503,{'error':'Требуется доступ администратора.'},extra={'WWW-Authenticate':'Basic realm="Grand Office"'} if configured else None)
        return False

    def static(self,target):
        if not target.is_relative_to(ROOT) or not target.is_file():
            raise Problem('Страница не найдена.',404)
        mime=mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
        self.response(200,target.read_bytes(),mime + ('; charset=utf-8' if mime.startswith('text/') else ''))

    def route_get(self,path,args):
        if path=='/site.json':
            return self.response(200,{**site_config(),'backend':True,'paths':{key:value[0] for key,value in PAGES.items()},
                                      'sameStoreDomain':PUBLIC_ORIGIN==ORIGINAL_STORE},extra={'Cache-Control':'no-cache'})
        if path=='/api/health':
            return self.response(200,{'ok':True})
        if path=='/robots.txt':
            rules = ('User-agent: *\nDisallow: /office/\nDisallow: /api/\nSitemap: '+PUBLIC_ORIGIN+'/sitemap.xml\n'
                     if INDEXABLE else 'User-agent: *\nDisallow: /\n')
            return self.response(200,rules.encode(),'text/plain; charset=utf-8')
        if path=='/sitemap.xml' and INDEXABLE:
            return self.response(200,sitemap(),'application/xml; charset=utf-8')
        if path=='/api/catalog':
            return self.response(200,public_catalog())
        if match := re.fullmatch(r'/api/variants/(\d+)/(\d+)',path):
            return self.response(200,public_variant(*map(int,match.groups())))
        if re.fullmatch(r'/api/products/\d+',path):
            return self.response(200,public_detail(int(path.rsplit('/',1)[-1])))
        if path.startswith('/office') or path.startswith('/api/office'):
            if not self.admin():
                return
            if path in {'/office','/office/'}:
                return self.static(ROOT/'server/admin.html')
            if path=='/office/admin.js':
                return self.static(ROOT/'server/admin.js')
            if path=='/api/office/products':
                q=str(args.get('q',[''])[0]).casefold().strip()
                found=[r for r in catalog()[0]['items'] if not q or q in (' '.join((str(r[0]),r[1],r[2]))).casefold()][:40]
                with database() as db:
                    overrides={r['product']:r for r in db.execute('SELECT * FROM product_content')}
                return self.response(200,[{'id':r[0],'name':r[1],'sku':r[2],'price':r[3],'variants':detail(r[0])[2],
                    'customName':overrides[r[0]]['name'] if r[0] in overrides else None,
                    'customDescription':overrides[r[0]]['description'] if r[0] in overrides else None} for r in found])
            with database() as db:
                if path=='/api/office/requests':
                    rows=db.execute('SELECT id,kind,state,created,payload,file_name FROM requests ORDER BY id DESC LIMIT 300')
                    return self.response(200,[{**dict(row),'payload':json.loads(row['payload'])} for row in rows])
                if path=='/api/office/imports':
                    return self.response(200,[dict(r) for r in db.execute('SELECT * FROM imports ORDER BY id DESC LIMIT 40')])
                if re.fullmatch(r'/api/office/attachments/\d+',path):
                    row=db.execute('SELECT file_type,file_data FROM requests WHERE id=?',(int(path.rsplit('/',1)[-1]),)).fetchone()
                    if not row or row['file_data'] is None:
                        raise Problem('Файл не найден.',404)
                    ext={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png'}[row['file_type']]
                    return self.response(200,row['file_data'],row['file_type'],{'Content-Disposition':f'attachment; filename="attachment.{ext}"'})
            raise Problem('Страница не найдена.',404)
        resource=path.strip('/')
        allowed = resource in FILES or re.fullmatch(r'assets/[A-Za-z0-9_.-]+|data/(?:catalog|featured|collections|catalog-facts|browse/sections)\.json|data/products/[0-9]+\.json',resource)
        if allowed and resource!='index.html':
            return self.static(ROOT/resource)
        if path.startswith('/api/'):
            raise Problem('Страница не найдена.',404)
        try:
            page = routes().resolve(path,args)
        except NotFound:
            return self.response(404,document(storefront_template(),routes(),None,PUBLIC_ORIGIN,False),'text/html; charset=utf-8')
        if page.location()!=self.path:
            return self.response(301,b'','text/plain; charset=utf-8',{'Location':page.location()})
        details = public_detail(page.ident) if page.key=='product' else None
        prices,names = catalog_overrides() if page.key=='catalog' else ({},{})
        return self.response(200,document(storefront_template(),routes(),page,PUBLIC_ORIGIN,INDEXABLE and page.can_index(),details,prices,names),
                             'text/html; charset=utf-8',{'Cache-Control':'no-cache'})

    def request_address(self):
        source = self.client_address[0]
        if USE_PROXY_ADDRESS and ip_address(source).is_loopback:
            try:
                return str(ip_address(self.headers.get('X-Real-IP','')))
            except ValueError:
                pass
        return source

    def do_GET(self):
        parsed=urlsplit(self.path)
        try:
            self.route_get(parsed.path,parse_qs(parsed.query))
        except Problem as err:
            self.response(err.status,{'error':str(err)})

    do_HEAD=do_GET

    def do_POST(self):
        path=urlsplit(self.path).path
        if self.headers.get('Sec-Fetch-Site')=='cross-site' or self.headers.get_content_type()!='application/json':
            return self.response(400,{'error':'Неподдерживаемый запрос.'})
        if path != '/api/requests' and not path.startswith('/api/office/'):
            return self.response(404,{'error':'Страница не найдена.'})
        if path.startswith('/api/office/') and not self.admin():
            return
        try:
            size=integer(self.headers.get('Content-Length',''),1,12*1024*1024)
            data=json.loads(self.rfile.read(size))
            if not isinstance(data,dict):
                raise Problem('Неподдерживаемый формат.')
            if path=='/api/requests':
                if INDEXABLE and len(ADMIN_PASSWORD)<16:
                    raise Problem('Приём заявок временно недоступен. Свяжитесь с нами по телефону.',503)
                return self.response(201,create_request(data,self.request_address()))
            if path=='/api/office/products':
                return self.response(200,change_product(data))
            if path=='/api/office/links':
                return self.response(200,link_offer(data))
            if path=='/api/office/imports':
                return self.response(200,import_feed(data))
            if path=='/api/office/requests':
                status=text(data,'state',30,True)
                if status not in {'Новая','В работе','КП отправлено','Подтверждено','Оплачено','Закрыто'}:
                    raise Problem('Неверный статус.')
                with database() as db:
                    cursor=db.execute('UPDATE requests SET state=? WHERE id=?',(status,integer(data.get('id'),1,999_999_999)))
                    if cursor.rowcount!=1:
                        raise Problem('Обращение не найдено.',404)
                return self.response(200,{'ok':True})
            raise Problem('Страница не найдена.',404)
        except (UnicodeDecodeError,json.JSONDecodeError):
            self.response(400,{'error':'Неподдерживаемый формат.'})
        except Problem as err:
            self.response(err.status,{'error':str(err)})

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=8080)
    parser.add_argument('--bind',default='127.0.0.1')
    parser.add_argument('--import-expro',action='store_true')
    args=parser.parse_args()
    init()
    if args.import_expro:
        result=import_feed({'supplier':'expro','apply':True})
        print(json.dumps({k:v for k,v in result.items() if k!='sample'},ensure_ascii=False))
    else:
        print(f'http://{args.bind}:{args.port}',flush=True)
        ThreadingHTTPServer((args.bind,args.port),SiteServer).serve_forever()
