import argparse
import base64
import binascii
import csv
from contextlib import contextmanager
from datetime import date, datetime, timezone, timedelta
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
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

ROOT = Path(__file__).resolve().parents[1]
DB = Path(os.environ.get('GRAND_DB', ROOT / 'data-private/store.sqlite3'))
ADMIN_USER = os.environ.get('GRAND_ADMIN_USER', 'office')
ADMIN_PASSWORD = os.environ.get('GRAND_ADMIN_PASSWORD', '')
EXPRO_URL = os.environ.get('GRAND_EXPRO_URL', '')
SOURCE_STORE = 'https://grand-office59.ru'
recent_variants = {}
variant_lock = Lock()
MAX_FILE = 8 * 1024 * 1024
MAX_FEED = 30 * 1024 * 1024
STALE_AFTER = timedelta(hours=float(os.environ.get('GRAND_STOCK_TTL_HOURS', '36')))
FILES = {'index.html', 'style.css', 'store.js', 'app.js', 'site.json'}
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
    return raw, {row[0]: row for row in raw['items']}

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

def public_catalog():
    raw, _ = catalog()
    with database() as db:
        prices = price_map(db,'supplier_values') | price_map(db,'edits')
        names = {r['product']:r['name'] for r in db.execute('SELECT product,name FROM product_content WHERE name IS NOT NULL')}
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
    return [original[0],original[1],options,description,original[4],combined(edits.get(0),suppliers.get(0))[1],summary]

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
        if not isinstance(image,str) or not image.startswith(SOURCE_STORE+'/wp-content/uploads/'):
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

def project_request(db,data):
    count = integer(data.get('seats'),1,5000)
    deadline = text(data,'date',20)
    if deadline:
        try:
            deadline = date.fromisoformat(deadline).isoformat()
        except ValueError:
            raise Problem('Укажите дату готовности офиса.')
    payload = {
        'seats': count, 'date': deadline, 'task': text(data,'task',1600),
        'address': text(data,'address',250), 'product': text(data,'product',350)
    }
    choice = text(data,'kit',40)
    config = site_config()
    kit = config.get('workspaceKit')
    if not choice:
        return payload
    if not kit or choice != kit['id']:
        raise Problem('Выберите комплект из списка.')
    output = []
    for product in kit['products']:
        product_row = record(product)
        manual = edit_map(db,'edits',product).get(0)
        supplier = edit_map(db,'supplier_values',product).get(0)
        updated_price, _ = combined(manual,supplier)
        content = db.execute('SELECT name FROM product_content WHERE product=?',(product,)).fetchone()
        output.append({
            'id': product, 'name': (content['name'] if content and content['name'] else product_row[1]),
            'sku': product_row[2], 'qty': count, 'price': updated_price if updated_price is not None else product_row[3]
        })
    rates = config.get('localRates')
    local = text(data,'city',80,True).casefold() == config.get('officeCity','').casefold()
    furniture = None if any(row['price'] is None for row in output) else round(sum(row['price'] * count for row in output),2)
    delivery = rates['deliveryFrom'] if local and rates else None
    assembly = round(furniture * rates['assemblyPercent'] / 100,2) if local and rates and furniture is not None else None
    total = round(furniture + delivery + assembly,2) if all(value is not None for value in (furniture,delivery,assembly)) else None
    payload.update(kit=kit['name'],lines=output,estimate={
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
            payload.update(address=text(data,'address',250), delivery=text(data,'delivery',140),lines=request_order(db,data.get('lines')))
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
        body = json.dumps(data,ensure_ascii=False).encode('utf-8') if kind.startswith('application/json') else data
        self.send_response(status)
        self.send_header('Content-Type',kind)
        self.send_header('Content-Length',str(len(body)))
        self.send_header('X-Content-Type-Options','nosniff')
        if self.path.startswith(('/api/','/office')):
            self.send_header('Cache-Control','no-store')
        for name,value in (extra or {}).items():
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
            return self.response(200,{**site_config(),'backend':True})
        if path=='/api/health':
            return self.response(200,{'ok':True})
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
        allowed = resource in FILES or re.fullmatch(r'assets/[A-Za-z0-9_.-]+|data/catalog\.json|data/products/[0-9]+\.json',resource)
        if path=='/':
            return self.static(ROOT/'index.html')
        if allowed:
            return self.static(ROOT/resource)
        raise Problem('Страница не найдена.',404)

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
                return self.response(201,create_request(data,self.client_address[0]))
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
