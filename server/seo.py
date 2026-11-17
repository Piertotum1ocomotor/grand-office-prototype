from html import escape
from urllib.parse import urlsplit

from routing import PAGES

PAGE_SIZE = 24


def link(path, text):
    return f'<a class="text-link" href="{escape(path, quote=True)}">{escape(text)}</a>'


def image(url, alt):
    if urlsplit(url).scheme != 'https':
        return ''
    return f'<img src="{escape(url, quote=True)}" alt="{escape(alt, quote=True)}" width="380" height="235" loading="lazy">'


def price_label(price, upper=None):
    if price is None:
        return 'Цена по запросу'
    value = f'{price:,.2f}'.rstrip('0').rstrip('.').replace(',', '\u00a0').replace('.', ',')
    return ('от ' if upper is not None and upper>price else '') + value + ' ₽'


def product_content(page, routes, product_detail):
    images, specs, _, description, _, _, row, *_ = product_detail
    card_image = image(images[0] if images else row[5],row[1])
    name, sku = row[1:3]
    crumbs = [link(PAGES['catalog'][0],'Каталог')]
    for ident in row[6][:1]:
        if ident in routes.category_paths:
            crumbs.append(link(routes.category_paths[ident],routes.categories[ident]['name']))
    fields = ''.join(f'<div><dt>{escape(label)}</dt><dd>{escape(value)}</dd></div>' for label,value in specs)
    return (
        '<nav class="breadcrumb" aria-label="Хлебные крошки">'+ ' / '.join(crumbs)+'</nav>'
        f'<div class="product-layout"><figure class="gallery">{card_image}</figure>'
        f'<section class="product-info"><h1>{escape(name)}</h1><p class="meta">Арт. {escape(sku)}</p>'
        f'<p class="product-price">{price_label(row[3],row[4])}</p>'
        +link(PAGES['project'][0]+'?product='+str(page.ident),'Запросить расчёт')+'</section></div>'
        + (f'<section class="spec"><h2>О товаре</h2><p>{escape(description)}</p></section>' if description else '')
        + (f'<section class="spec"><h2>Характеристики</h2><dl>{fields}</dl></section>' if fields else '')
    )


def catalog_content(page, routes, prices, names):
    if page.params.keys() - {'p'}:
        return f'<h1>{escape(page.title)}</h1><p class="intro">Подбираем мебель по указанным параметрам.</p>'
    children = [ident for ident in routes.category_paths
                if routes.categories[ident]['parent']==(page.ident or 0) and routes.category_rows[ident]]
    navigation = ''.join('<li>'+link(routes.category_paths[ident],routes.categories[ident]['name'])+'</li>' for ident in children)
    entries = routes.category_rows[page.ident] if page.ident else routes.ranked
    total = max(1,(len(entries)+PAGE_SIZE-1)//PAGE_SIZE)
    number = page.params.get('p','1')
    number = min(total,max(1,int(number))) if len(number)<=9 and number.isdecimal() else 1
    rows = entries[(number-1)*PAGE_SIZE:number*PAGE_SIZE]
    cards = ''.join(
        f'<article class="product"><a class="product-photo" href="{escape(routes.product_paths[row[0]],quote=True)}">'
        +image(row[5],names.get(row[0],row[1]))+'</a><div class="product-card"><h3>'
        +link(routes.product_paths[row[0]],names.get(row[0],row[1]))+'</h3><p class="price">'
        +price_label(prices.get(row[0],row[3]),None if row[0] in prices else row[4])+'</p></div></article>'
        for row in rows
    )
    nearby = sorted({1,number-1,number,number+1,total} & set(range(1,total+1)))
    pages = ' · '.join(link(page.path+('' if value==1 else '?p='+str(value)),str(value)) for value in nearby)
    return (
        f'<h1>{escape(page.title)}</h1>' +
        (f'<nav class="catalog-directory" aria-label="Разделы каталога"><ul>{navigation}</ul></nav>' if navigation else '') +
        f'<div class="product-grid catalog-grid">{cards}</div>' +
        (f'<nav class="pagination" aria-label="Страницы каталога">{pages}</nav>' if total>1 else '')
    )


def document(template, routes, page, origin, indexed, product_detail=None, prices=None, names=None):
    if page is None:
        title, description, token = 'Страница не найдена', '', '#/missing'
        body = '<h1>Страница не найдена</h1>'+link('/','На главную')
    else:
        title, description, token = page.title, page.description, page.route_token()
        if page.key == 'product':
            description = (product_detail[3] or page.title)[:160]
            title = product_detail[6][1]
            body = product_content(page,routes,product_detail)
        elif page.key == 'catalog':
            body = catalog_content(page,routes,prices or {},names or {})
        else:
            body = f'<h1>{escape(title)}</h1><p class="intro">{escape(description)}</p>'
            if page.key in ('','project','projects'):
                body += '<p>'+link(PAGES['catalog'][0],'Выбрать мебель')+' · '+link(PAGES['contacts'][0],'Контакты')+'</p>'
    html = template.replace('<html lang="ru">',f'<html lang="ru" data-route="{escape(token,quote=True)}">')
    html = html.replace('<head>','<head>\n  <base href="/">',1)
    html = html.replace('<title>Гранд-Офис — офисная мебель и комплектация офисов</title>',f'<title>{escape(title)} — Гранд-Офис</title>')
    html = html.replace('content="Офисная мебель в Перми. Столы, кресла и комплектация офисов с доставкой и сборкой."',
                        f'content="{escape(description,quote=True)}"')
    html = html.replace('<main id="main" tabindex="-1"></main>',f'<main id="main" tabindex="-1"><div class="shell page">{body}</div></main>')
    html = html.replace('href="#main"',f'href="{escape(page.location() if page else "/",quote=True)}#main"')
    for key,(path,_,_) in PAGES.items():
        token = '#/'+key
        html = html.replace(f'href="{token}"',f'href="{path}" data-route="{token}"')
    if page and origin:
        html = html.replace('  <meta name="theme-color"',f'  <link rel="canonical" href="{escape(origin+page.canonical(),quote=True)}">\n  <meta name="theme-color"')
    if indexed:
        html = html.replace('  <meta name="robots" content="noindex,nofollow">\n','')
    return html.encode('utf-8')
