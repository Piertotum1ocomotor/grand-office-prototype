from dataclasses import dataclass, field
from urllib.parse import quote, urlencode, unquote, urlsplit

# Keep the published addresses where the corresponding page exists.
PAGES = {
    '': ('/', 'Офисная мебель и комплектация офисов', 'Мебель для рабочих мест, переговорных и кабинетов с доставкой и сборкой в Перми.'),
    'catalog': ('/shop/', 'Каталог офисной мебели', 'Столы, кресла, шкафы и мебель для переговорных.'),
    'project': ('/korporativnym-klientam/', 'Комплектация офисов', 'Подбор мебели, планировка и смета для офиса.'),
    'delivery': ('/dostavka-i-sborka-2/', 'Доставка и сборка', 'Условия доставки, подъёма и сборки офисной мебели.'),
    'service': ('/uslugi-i-servis/', 'Услуги и сервис', 'Оплата, документы, гарантия и сопровождение заказа.'),
    'about': ('/o-kompanii/', 'О компании', 'Гранд-Офис комплектует офисы и поставляет мебель в Перми.'),
    'contacts': ('/kontakty/', 'Контакты', 'Гранд-Офис, Пермь, ул. Екатерининская, 10. Телефон +7 (342) 215-58-98.'),
    'showroom': ('/shourum/', 'Шоурум', 'Посмотрите мебель и образцы отделки. Адрес, график и маршрут в шоурум Гранд-Офиса в Перми.'),
    'planner': ('/planirovshhik-ofisa/', 'Планировщик офиса', 'Расставьте офисную мебель по размерам помещения, сохраните план и запросите смету.'),
    'projects': ('/nashi-proekty/', 'Выполненные проекты', 'Фотографии реализованных проектов Гранд-Офиса.'),
    'cart': ('/cart/', 'Корзина', ''),
    'checkout': ('/checkout/', 'Запрос поставки', ''),
}
PROJECTS = {'sber':'Сбер', 'rshb':'Россельхозбанк', 'lukoil':'ЛУКОЙЛ', 'gazprom':'Газпром'}
ALIASES = {
    '/shop-2/':'catalog', '/catalog/':'catalog', '/project/':'project',
    '/dizajn-proekt/':'project', '/dostavka-i-sborka/':'delivery', '/delivery/':'delivery',
    '/servis/':'service', '/oplata/':'service', '/vozvrat/':'service', '/service/':'service',
    '/about/':'about', '/contacts/':'contacts', '/showroom/':'showroom',
    '/planner/':'planner', '/projects/workspace-layout/':'planner', '/nashi-proekty/workspace-layout/':'planner',
    '/kejsy/':'projects', '/projects/':'projects', '/index.html/':'',
}
PROJECT_PATH = PAGES['projects'][0]
NON_INDEXED = {'cart','checkout'}

class NotFound(Exception):
    pass


def encode_path(path):
    return quote(path, safe="/-._~")


def key_for_path(path):
    path = unquote(path)
    if path == '/':
        return path
    return path.rstrip('/')+'/'


@dataclass
class Page:
    key: str
    path: str
    title: str
    description: str = ''
    ident: object = None
    params: dict = field(default_factory=dict)
    indexed: bool = True

    def route_token(self):
        params = dict(self.params)
        if self.key == 'catalog' and self.ident:
            params['c'] = str(self.ident)
        suffix = '/' + str(self.ident) if self.key in ('product','projects') and self.ident else ''
        return '#/' + self.key + suffix + ('?' + urlencode(params) if params else '')

    def location(self):
        return self.path + ('?' + urlencode(self.params) if self.params else '')

    def canonical(self):
        if self.key == 'catalog' and self.params.keys()=={'p'}:
            return self.location()
        return self.path

    def can_index(self):
        if self.key == 'catalog':
            return self.indexed and not (self.params.keys() - {'p'})
        return self.indexed and not self.params


class Routes:
    def __init__(self, catalog, unlisted_products=()):
        categories = {entry['id']:entry for entry in catalog['categories']}
        self.category_paths = {}
        self.category_ids = {}
        self.categories = categories
        self.products = {row[0]:row for row in catalog['items']}
        self.product_paths = {}
        self.product_ids = {}
        self.unlisted_products = set(unlisted_products)
        self.category_by_slug = {}
        for ident, cat in categories.items():
            slugs, seen = [], set()
            item = cat
            while item and item.get('slug') and item['id'] not in seen:
                seen.add(item['id'])
                slugs.insert(0,item['slug'])
                item = categories.get(item['parent'])
            if not slugs:
                continue
            path = key_for_path(cat.get('path') or '/product-category/' + '/'.join(slugs) + '/')
            self.category_paths[ident] = encode_path(path)
            self.category_ids[path] = ident
            self.category_by_slug[cat['slug']] = ident
        for ident,row in self.products.items():
            path = key_for_path(urlsplit(row[9]).path)
            if not path.startswith('/product/'):
                path = f'/product/{ident}/'
            self.product_paths[ident] = encode_path(path)
            self.product_ids[path] = ident
        self.page_keys = {entry[0]:key for key,entry in PAGES.items()}
        self.category_rows = {ident:[] for ident in self.category_paths}
        priority = {ident:position for position,ident in enumerate([887,244689,86,986,176,197,204,1046,211,2609,188286,157457])}
        ranked = sorted(catalog['items'], key=lambda row: (row[12]!='furniture',priority.get(row[0],len(priority))))
        self.ranked = ranked
        for row in ranked:
            visited = set()
            for ident in row[6]:
                while ident in categories and ident not in visited:
                    visited.add(ident)
                    if ident in self.category_rows:
                        self.category_rows[ident].append(row)
                    ident = categories[ident]['parent']

    def category(self, value):
        return self.category_by_slug.get(value) or (int(value) if len(value)<=10 and value.isascii() and value.isdecimal() and int(value) in self.category_paths else None)

    def resolve(self, pathname, query):
        path = key_for_path(pathname)
        args = {key:values[0] for key,values in query.items() if values and values[0]}
        match = self.product_ids.get(path)
        if path.startswith('/product/') and not match:
            token = path.split('/')[2]
            if path == '/product/'+token+'/' and token.isascii() and token.isdecimal() and len(token)<=10:
                match = int(token)
        if match in self.products:
            row = self.products[match]
            return Page('product',self.product_paths[match],row[1],ident=match,params=args,indexed=match not in self.unlisted_products)
        cat = self.category_ids.get(path)
        if not cat and path.startswith('/catalog/') and path.count('/')==3:
            cat = self.category(path.split('/')[2])
        key = self.page_keys.get(path, ALIASES.get(path))
        if key == 'catalog':
            chosen = args.pop('c', '')
            cat = cat or self.category(chosen)
            if chosen in {'tables','chairs','cabinets','pedestals','shelving','sofas'} and 't' not in args:
                args['t'] = chosen
        if 'p' in args and (key == 'catalog' or cat):
            value = args.pop('p')
            if value.isascii() and value.isdecimal() and len(value)<=9:
                number=int(value)
                if not args:
                    total=len(self.category_rows[cat] if cat else self.ranked)
                    number=min(max(1,(total+23)//24),number)
                if number>1:
                    args['p']=str(number)
        if cat:
            return Page('catalog',self.category_paths[cat],self.categories[cat]['name'],ident=cat,params=args,indexed=bool(self.category_rows[cat]))
        if key is not None:
            canonical, title, description = PAGES[key]
            return Page(key,canonical,title,description,params=args,indexed=key not in NON_INDEXED)
        for prefix in (PROJECT_PATH,'/projects/'):
            if path.startswith(prefix):
                ident=path[len(prefix):-1]
                if ident in PROJECTS:
                    return Page('projects',PROJECT_PATH+ident+'/',PROJECTS[ident],ident=ident,params=args)
        raise NotFound

    def sitemap_paths(self):
        yield from (path for key,(path,_,_) in PAGES.items() if key not in NON_INDEXED)
        yield from (PROJECT_PATH+ident+'/' for ident in PROJECTS)
        yield from (path for ident,path in self.product_paths.items() if ident not in self.unlisted_products)
        yield from (path for ident,path in self.category_paths.items() if self.category_rows[ident])
