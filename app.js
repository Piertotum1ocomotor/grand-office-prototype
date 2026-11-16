'use strict';

const { escape: e, normalize, money, format } = site;
const main = document.querySelector('#main');
let catalog;
let officeConfig = {};
const seatPresets = [1,4,8];
let hasBackend = false;
let city = site.session('city', 'Пермь');
let cart = site.session('basket', []);
if (!Array.isArray(cart)) cart = [];
let revision = 0;
const pageSize = 24;
const positions = new Map();
let previousRoute = location.hash;
let catalogOrigin = '#/catalog';

const fromProduct = ([id, name, sku, price, max, image, categories, stock, backorder, url, type, dimensions]) => (
  {id, name, sku, price, max, image, categories, stock, backorder, url, type, dimensions}
);
const crumbs = (links) => '<nav class="breadcrumb" aria-label="Хлебные крошки"><a href="#/">Главная</a>' +
  links.map(([name, href]) => '<span aria-hidden="true">/</span>' +
    (href ? '<a href="' + e(href) + '">' + e(name) + '</a>' : '<span aria-current="page">' + e(name) + '</span>')).join('') + '</nav>';
const page = (title, body, levels = []) => '<div class="shell page">' + crumbs([...levels,[title]]) + '<h1>' + e(title) + '</h1>' + body + '</div>';
const photo = (src, alt = '', extra = '') => src ? '<img src="' + e(src) + '" alt="' + e(alt) + '" ' + extra + '>' : '<div class="no-photo" aria-label="Фото отсутствует">Гранд-Офис</div>';
const dimensionPattern = /(?<!\d)\d{2,4}\s*[×xх*]\s*\d{2,4}\s*[×xх*]\s*\d{2,4}(?!\d)/i;
const dimensionsLabel = (dims) => dims?.every(Boolean) ? dims.join(' × ') + ' мм' : (dims?.[0] ? 'Ширина ' + dims[0] + ' мм' : '');
const card = (item) => {
  const title = item.name.replace(dimensionPattern,'').trim().replace(/[,(–-]+$/,'').trim() || item.name;
  const values = [item.sku ? 'Арт. '+item.sku : '', dimensionsLabel(item.dimensions)].filter(Boolean);
  return `<article class="product"><a class="product-photo" href="#/product/${item.id}" aria-label="${e(title)}">${photo(item.image,'','loading="lazy" width="380" height="235"')}</a><div class="product-card"><h3><a href="#/product/${item.id}">${e(title)}</a></h3>${values.length ? '<p class="meta">'+e(values.join(' · '))+'</p>' : ''}<p class="price">${money(item.price,item.max)}</p><p class="small">${item.backorder ? 'Под заказ' : 'Наличие уточняется'}</p></div></article>`;
};
const categoryCard = ([name, image, category]) => `<a class="category" href="#/catalog?c=${encodeURIComponent(category)}">${photo('./assets/'+image,'','loading="lazy"')}<span>${e(name)}</span></a>`;

function projectShowcase() {
  return `<div class="project-carousel"><ul class="project-track" tabindex="0" aria-label="Проекты Гранд-Офиса">${site.projects.map(project=>`<li><a class="project-tile" href="#/projects/${project.id}">${photo('./assets/'+project.image,project.zone,'loading="lazy" width="656" height="505"')}<div><h3>${e(project.name)}</h3><p>${e(project.zone)}</p></div></a></li>`).join('')}</ul>
  <div class="actions carousel-buttons"><button class="btn secondary" data-projects="-1" aria-label="Предыдущий проект">Назад</button><button class="btn secondary" data-projects="1" aria-label="Следующий проект">Далее</button></div></div>`;
}

function serviceFacts() {
  const rates = officeConfig.localRates;
  if (!rates) return '';
  return `<dl class="service-facts"><div><dt>Доставка по Перми</dt><dd>от ${format(rates.deliveryFrom)}</dd><dd class="fact-description">Подтвердим по адресу и объёму заказа.</dd></div>
    <div><dt>Подъём</dt><dd>от ${format(rates.liftFromPerFloor)} за этаж</dd><dd class="fact-description">Зависит от лифта, габаритов и этажа.</dd></div>
    <div><dt>Стандартная сборка</dt><dd>${rates.assemblyPercent}%</dd><dd class="fact-description">От стоимости мебели. Дату согласуем.</dd></div></dl>`;
}

function home() {
  return `<div class="shell">
    <section class="hero" aria-labelledby="home-title">
      <div class="hero-copy"><p class="eyebrow">Пермь и Пермский край</p><h1 id="home-title">Офисная мебель и комплектация офисов</h1>
      <p>Мебель для рабочих мест, переговорных и кабинетов. Подберём, доставим и соберём.</p>
      <div class="actions"><a class="btn" href="#/catalog">Выбрать мебель</a><a class="btn secondary" href="#/project">Рассчитать комплектацию</a></div></div>
      <div class="hero-photo">${photo('./assets/office.webp','Офис с деревянными столами и терракотовыми креслами','fetchpriority="high"')}</div>
    </section>
    <section class="section"><div class="section-head"><h2>Мебель для офиса</h2><a class="text-link" href="#/catalog">Весь каталог</a></div>
      <div class="category-grid four">${site.startCategories.map(categoryCard).join('')}</div></section>
    <section class="project-feature kit-hero">${photo('./assets/riva-interior.webp','Пример рабочих мест с мебелью Riva в интерьере','loading="lazy" width="900" height="720"')}
      <div><p class="eyebrow">Серия Riva</p><h2>Соберите рабочие места</h2>
        <p>Выберите столы, кресла и тумбы. Посмотрите цену каждой позиции и попробуйте расставить мебель по размерам комнаты.</p>
        <div class="actions"><a class="btn" href="#/project?section=kit">Собрать комплект</a><a class="text-link" href="#/projects/workspace-layout">Открыть планировщик</a></div></div>
    </section>
    <section class="section"><div class="section-head"><h2>Наши проекты</h2><a class="text-link" href="#/projects">Все проекты</a></div>${projectShowcase()}</section>
    <section class="section home-delivery"><div class="section-head"><h2>Доставка и сборка</h2><a class="text-link" href="#/delivery">Сроки и условия</a></div>${serviceFacts()}</section>
    </div>`;
}

const catById = new Map();
const catBySlug = new Map();
const catChildren = new Map();
const productById = new Map();
function prepare(data) {
  if (!data) return;
  productById.clear();
  data.categories.forEach((c) => {
    catById.set(c.id,c);
    if (c.slug) catBySlug.set(c.slug,c);
    if (!catChildren.has(c.parent)) catChildren.set(c.parent,[]);
    catChildren.get(c.parent).push(c);
  });
  data.items.forEach((row) => productById.set(row[0],fromProduct(row)));
}

function categoryRoot(cat) {
  let item = cat;
  for (let i=0; i<12 && item?.parent && catById.has(item.parent); i++) item = catById.get(item.parent);
  return item;
}
function matchesCategory(item, key) {
  if (!key) return true;
  if (Object.hasOwn(productTypes,key)) return item.type === key;
  const chosen = catBySlug.get(key) || catById.get(Number(key));
  if (!chosen) return true;
  return item.categories.some((id) => {
    let current = catById.get(id);
    for (let i=0; i<12 && current; i++) {
      if (current.id === chosen.id) return true;
      current = catById.get(current.parent);
    }
    return false;
  });
}

const productTypes = {
  tables: ['Столы', /^(?:стол(?:ы|а|ов|у|ам|ами|е|ах|ом)?|столик(?:и|а|ов)?)$/],
  chairs: ['Кресла', /^(?:кресл(?:о|а|ов|у|ам|ами|е|ах|ом)?|стул(?:ья|а|ьев|у|ьям|ом|е)?)$/],
  cabinets: ['Шкафы', /^(?:шкаф(?:ы|а|ов|у|ам|ами|е|ах|ом)?|гардероб(?:ы|а|ов)?)$/],
  pedestals: ['Тумбы', /^тумб(?:а|ы|у|е|ой|ам|ах)?$/],
  shelving: ['Стеллажи', /^стеллаж(?:и|а|ей|у|ам|ом)?$/],
  sofas: ['Диваны', /^диван(?:ы|а|ов|у|ам|ами|е|ах|ом)?$/]
};
const quickTypes = ['tables','chairs','cabinets'];

function searchProducts(query) {
  const string = normalize(query).trim();
  const entries = [...productById.values()];
  if (!string) return entries;
  const exact = entries.filter(entry=>normalize(entry.sku).trim()===string);
  if (exact.length) return exact;
  const words = string.split(/\s+/);
  const types = new Set();
  const terms = words.filter(word=>{
    const key = Object.keys(productTypes).find(type=>productTypes[type][1].test(word));
    if (key) types.add(key);
    return !key;
  });
  return entries.filter(entry=>{
    if (types.size && !types.has(entry.type)) return false;
    const searchable = normalize(entry.name + ' ' + entry.sku);
    return terms.every(word=>searchable.includes(word));
  });
}

function catalogueSections(groups,c,toCatalog) {
  const selected = catBySlug.get(c) || catById.get(Number(c));
  const path = new Set();
  for (let item=selected; item && !path.has(item.id); item=catById.get(item.parent)) path.add(item.id);
  const link = (entry,title=entry.name) => `<a href="${e(toCatalog({c:entry.id,q:null,p:null}))}" ${entry.id===selected?.id?'aria-current="page"':''}>${e(title)}</a>`;
  const branch = (entry,depth=0) => {
    const children = catChildren.get(entry.id);
    if (!children?.length || depth===10) return link(entry);
    return `<details ${path.has(entry.id)?'open':''}><summary>${e(entry.name)}</summary><div>${link(entry,depth?'Все в подразделе':'Все в разделе')}${children.map(child=>branch(child,depth+1)).join('')}</div></details>`;
  };
  return `<details class="catalog-directory" ${matchMedia('(min-width: 961px)').matches?'open':''}>
    <summary>Разделы каталога</summary><nav aria-label="Разделы каталога">${groups.map(group=>branch(group)).join('')}</nav></details>`;
}

function catalogPage(settings) {
  if (!catalog) return page('Каталог', '<p class="intro">Каталог временно недоступен. <a class="text-link" href="'+site.original+'/shop/">Открыть каталог «Гранд-Офиса»</a></p>');
  const c = settings.get('c') || '';
  const query = (settings.get('q') || '').slice(0,120);
  const sort = settings.get('sort') || '';
  const budget = Math.max(0,Number(settings.get('max')) || 0);
  const width = Math.max(0,Number(settings.get('w')) || 0);
  const includeUnknown = settings.get('unknown')==='1';
  const groups = catalog.categories.filter((entry) => !entry.parent && entry.slug).sort((a,b) => a.name.localeCompare(b.name,'ru'));
  const selected = catBySlug.get(c) || catById.get(Number(c));
  const matches = searchProducts(query).filter(entry=>{
    if (!matchesCategory(entry,c) || (budget && (entry.price == null || entry.price > budget))) return false;
    const itemWidth = entry.dimensions?.[0];
    return !width || (itemWidth==null ? includeUnknown : itemWidth <= width);
  });
  if (sort === 'up') matches.sort((a,b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  if (sort === 'down') matches.sort((a,b) => (b.price ?? -1) - (a.price ?? -1));
  const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
  const offset = Math.min(totalPages, Math.max(1, parseInt(settings.get('p') || '1',10) || 1));
  const title = selected?.name || (Object.hasOwn(productTypes,c) ? productTypes[c][0] : '') || 'Каталог офисной мебели';
  const toCatalog = (patch) => {
    const values = new URLSearchParams(settings);
    for (const [key,value] of Object.entries(patch)) if (value) values.set(key,value); else values.delete(key);
    return '#/catalog' + (values.size ? '?' + values : '');
  };
  const advanced = Boolean(selected || budget || width || sort);
  return page(title,`<div class="catalog-shell"><aside class="catalog-sidebar">${catalogueSections(groups,c,toCatalog)}</aside><div class="catalog-results"><div class="catalog-tools">
    <nav class="quick-categories" aria-label="Тип товара">${['',...quickTypes].map(key=>`<a class="chip" href="${e(toCatalog({c:key,p:null,q:null}))}" ${c===key?'aria-current="page"':''}>${key ? productTypes[key][0]:'Все товары'}</a>`).join('')}</nav>
    <details class="catalog-filters" ${advanced && matchMedia('(min-width: 721px)').matches?'open':''}><summary>Фильтры${advanced?' · применены':''}</summary>
      <form id="filters" class="filters-grid"><input type="hidden" name="q" value="${e(query)}">
      <label><span class="field-label">Категория</span><select class="field" name="c"><option value="">Все категории</option>${Object.entries(productTypes).map(([key,[label]])=>`<option value="${key}" ${c===key?'selected':''}>${label}</option>`).join('')}${groups.map(g=>`<option value="${g.id}" ${selected?.id===g.id?'selected':''}>${e(g.name)}</option>`).join('')}</select></label>
      <label><span class="field-label">Цена до, ₽</span><input class="field" type="number" name="max" min="0" max="100000000" value="${budget || ''}"></label>
      <label><span class="field-label">Ширина до, мм</span><input class="field" type="number" name="w" min="0" max="10000" value="${width||''}"></label>
      <label><span class="field-label">Сортировка</span><select class="field" name="sort"><option value="">По умолчанию</option><option value="up" ${sort==='up'?'selected':''}>Сначала дешевле</option><option value="down" ${sort==='down'?'selected':''}>Сначала дороже</option></select></label>
      <button class="btn" type="submit">Применить</button>
      <label class="unknown-width"><input type="checkbox" name="unknown" value="1" ${includeUnknown?'checked':''}> Показывать товары без указанной ширины</label></form>
    </details></div>
    <div class="catalog-heading"><p class="count-label">${query?'«'+e(query)+'» · ':''}Найдено: ${new Intl.NumberFormat('ru-RU').format(matches.length)}</p>${query || c || advanced ? '<a class="text-link" href="#/catalog">Сбросить</a>':''}</div>
    ${matches.length ? '<div class="product-grid catalog-grid">' + matches.slice((offset-1)*pageSize,offset*pageSize).map(card).join('') + '</div>' : '<div class="empty">По этому запросу ничего не найдено. Попробуйте изменить фильтры.</div>'}
    ${totalPages > 1 ? `<nav class="pagination" aria-label="Страницы каталога">${offset>1?'<a class="btn secondary" href="'+e(toCatalog({p:offset-1}))+'">Назад</a>':''}<span>Страница ${offset} из ${totalPages}</span>${offset<totalPages?'<a class="btn secondary" href="'+e(toCatalog({p:offset+1}))+'">Далее</a>':''}</nav>`:''}</div></div>`);
}

function logistics(item) {
  const local = normalize(city).trim() === normalize(officeConfig.officeCity);
  const delivery = officeConfig.localRates?.deliveryFrom;
  const root = item.categories.map((id) => categoryRoot(catById.get(id))?.name).join(' ');
  const text = normalize(item.name + ' ' + root);
  let range;
  if (/кресл|стуль/.test(text)) range = '3–5 дней';
  else if (/руководител/.test(text)) range = '3–10 дней';
  else if (/приемной|переговорн/.test(text)) range = '5–12 дней';
  else if (/персонал|стол/.test(text)) range = '3–7 дней';
  return local && delivery!=null ? `Ориентир по Перми: доставка от ${format(delivery)}${range?', '+range:''}. Сборка и подъём рассчитываются отдельно.` : `Для города ${city} стоимость и срок доставки уточняются по адресу.`;
}

function priceOf(item, option, variation) {
  return option ? variation?.price ?? option[2] ?? null : item.price;
}

function itemPage(item, detail, variant) {
  const [images=[],specs=[],opts=[],description=''] = detail || [];
  const baseImages = images.length ? images : item.image ? [item.image] : [];
  const matchingPhoto = variant?.image && variant.image!==baseImages[0] ? variant.image : '';
  const pics = matchingPhoto ? [...new Set([matchingPhoto,...baseImages])] : baseImages;
  const selected = opts.find((option)=>option[0] === site.session('selected-'+item.id, null));
  const dimensions = dimensionsLabel(item.dimensions);
  const liveStock = variant?.stock ?? selected?.[3] ?? (hasBackend && !opts.length ? detail?.[5] : null);
  return `<div class="shell page">${crumbs([['Каталог',catalogOrigin],[item.name]])}
      <div class="product-layout"><section aria-label="Фотографии товара"><figure class="gallery">${pics[0]?photo(pics[0],item.name):photo('')}</figure>${selected?'<p class="small photo-caption">'+e(matchingPhoto ? 'Фото выбранного варианта' : 'Общее фото модели')+'</p>':''}
      ${pics.length>1 ? '<div class="gallery-thumbs">'+pics.slice(0,8).map((src,i)=>`<button type="button" data-photo="${e(src)}" data-variant-photo="${src===matchingPhoto}" aria-label="Фотография ${i+1}">${photo(src,'','loading="lazy"')}</button>`).join('')+'</div>':''}</section>
      <section class="product-info"><h1>${e(item.name)}</h1>${item.sku?'<p class="meta">Артикул '+e(item.sku)+'</p>':''}
      <p class="product-price">${selected?(priceOf(item,selected,variant)==null ? '<span class="small">Цена варианта уточняется</span>' : money(priceOf(item,selected,variant))):money(item.price,item.max)}</p>
      ${opts.length? `<label><span class="field-label">Вариант</span><select class="field" id="product-option" data-id="${item.id}"><option value="">Выберите вариант</option>${opts.map((o)=>`<option value="${o[0]}" ${o===selected?'selected':''}>${e(o[1] || ('Вариант ' + o[0]))}</option>`).join('')}</select></label>`:''}
      <p class="small" id="variant-status" role="status" hidden></p><div class="logistics"><p class="stock">${liveStock>0 ? 'Доступно у поставщика: '+liveStock+' шт.' : ((variant?.backorder ?? item.backorder)?'Под заказ':'Наличие уточняется')}</p><p class="small">${e(logistics(item))}</p></div>
      <div class="actions"><button class="btn" data-add="${item.id}" ${(opts.length && !selected) || liveStock===0?'disabled':''}>В корзину</button><a class="btn secondary" href="#/project?product=${item.id}">Запросить расчёт</a></div><p class="result" id="cart-result" role="status" hidden></p>
      ${item.url?'<p class="small source-link"><a class="text-link" href="'+e(item.url)+'">Карточка в действующем магазине</a></p>':''}</section></div>
      ${description?'<section class="spec"><h2>О товаре</h2><p>'+e(description)+'</p></section>':''}
      ${dimensions? '<section class="spec"><h2>Габариты</h2><p>'+e(dimensions)+'</p></section>' : ''}
      ${specs.length?'<section class="spec"><h2>Характеристики</h2><dl>'+specs.map(([a,b])=>'<div><dt>'+e(a)+'</dt><dd>'+e(b)+'</dd></div>').join('')+'</dl></section>':''}
      </div>`;
}

function lineTotal() {
  return cart.reduce((sum, line) => sum + (line.price ?? 0) * line.qty, 0);
}
function saveCart() {
  site.save('basket',cart);
  document.querySelector('#cart-count').textContent = cart.reduce((sum,row)=>sum+row.qty,0);
}
function cartPage() {
  if (!cart.length) return page('Корзина','<p class="intro">Добавьте мебель из каталога.</p><a class="btn" href="#/catalog">В каталог</a>');
  return page('Корзина',`<div class="cart-layout"><section aria-label="Товары">${cart.map((row,i)=>`<div class="cart-row">
      ${photo(row.image || '')}<div><a href="#/product/${row.id}">${e(row.name)}</a><p class="small">${e(row.variant||row.sku||'')} · ${money(row.price)}${row.price!=null?' за шт.':''}</p></div>
      <input type="number" class="field" min="1" max="${row.cap || 999}" step="1" value="${row.qty}" data-qty="${i}" aria-label="Количество — ${e(row.name)}"><button data-remove="${i}">Убрать</button>
      </div>`).join('')}</section>
      <aside class="panel"><h2>Получение заказа</h2><p class="small">Город: ${e(city)}. Срок, доступность и услуги подтверждаются для вашего заказа.</p>
      <div class="summary"><div><span>Стоимость товаров</span><strong id="basket-total" aria-live="polite">${cart.some((r)=>r.price==null)?'Уточняется':format(lineTotal())}</strong></div></div>
      <a class="btn" href="#/checkout">Оформить заказ</a></aside></div>`);
}

function transportNote() {
  return hasBackend ? '' : '<p class="request-note">После заполнения откроется черновик письма. Отправьте его из своей почты, чтобы менеджер получил запрос.</p>';
}

function contactFields() {
  return `<label><span class="field-label">Имя</span><input class="field" name="name" maxlength="100" autocomplete="name" required></label>
    <label><span class="field-label">Телефон или электронная почта</span><input class="field" name="contact" maxlength="140" autocomplete="off" required></label>
    ${hasBackend ? '<label class="consent"><input type="checkbox" name="consent" required> Согласен на обработку данных для ответа на обращение. <a class="text-link" href="https://grand-office59.ru/privacy-policy/">Политика конфиденциальности</a></label>' : ''}`;
}
function checkoutPage() {
  if (!cart.length) return cartPage();
  return page('Оформление заказа',`<div class="project-demo checkout"><form id="request-form" data-kind="order" class="panel">${transportNote()}
    <label><span class="field-label">Город</span><input class="field" name="city" value="${e(city)}" required maxlength="80"></label>
    <label><span class="field-label">Адрес доставки</span><input class="field" name="address" maxlength="250" autocomplete="street-address"></label>
    <label><span class="field-label">Дополнительные услуги</span><select class="field" name="delivery"><option>Доставка</option><option>Доставка и сборка</option><option>Доставка, подъём и сборка</option><option>Самовывоз по согласованию</option></select></label>
    ${contactFields()}<button class="btn" type="submit">${hasBackend?'Отправить заказ':'Открыть письмо с заказом'}</button>
    <p class="small">Стоимость услуг и способ оплаты согласует менеджер.</p><p class="result" role="status" hidden></p></form>
    <aside class="panel"><h2>Состав заказа</h2><div class="summary">${cart.map((row)=>`<div><span>${e(row.name)} × ${row.qty}</span><span>${row.price==null?'Уточняется':format(row.price*row.qty)}</span></div>`).join('')}</div></aside></div>`,[['Корзина','#/cart']]);
}

let kitPreferences = site.session('kit-preferences',{});
let roomPlan = workspace.planSettings(site.session('room-plan',{}));
if (!kitPreferences || typeof kitPreferences!=='object') kitPreferences = {};

function kitGroups() {
  return officeConfig.workspaceKit?.groups || [];
}

function validSeats(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= 5000 ? count : null;
}

function seatsLabel(count) {
  const ending = new Intl.PluralRules('ru').select(count);
  return count + ' ' + ({one:'место',few:'места',many:'мест',other:'мест'})[ending];
}

function kitSelection(qty) {
  return kitGroups().map(group=>{
    const saved = kitPreferences[group.id] || {};
    const available = group.models.filter(id=>productById.has(id));
    const id = available.includes(saved.id) || (group.optional && saved.id===0) ? saved.id : (group.optional ? 0 : available[0]);
    return {group,id,product:productById.get(id),qty:id ? (validSeats(saved.qty) || qty) : 0};
  });
}

function kitEstimate(qty, destination) {
  const selection = kitSelection(qty);
  const products = selection.filter(item=>item.product && item.qty);
  const ready = selection.length > 0 && selection.every(item=>item.group.optional || item.product);
  const priced = ready && products.every(item=>item.product.price!=null);
  const value = priced ? Math.round(products.reduce((sum,item)=>sum+item.product.price*item.qty,0)*100)/100 : null;
  const local = normalize(destination).trim() === normalize(officeConfig.officeCity);
  const rates = officeConfig.localRates;
  const assembly = local && rates && value != null ? Math.round(value*rates.assemblyPercent)/100 : null;
  const delivery = local && rates ? rates.deliveryFrom : null;
  const total = value == null || assembly == null || delivery == null ? null : Math.round((value+assembly+delivery)*100)/100;
  return {products,ready,qty,value,assembly,delivery,total,local,rates,from:products.some(({product})=>product.max>product.price)};
}

function kitOptionLabel(group,item) {
  const model = item.name.split(/\s+/)[0];
  if (group==='desk') return 'Riva ' + model + (item.dimensions?.[0] && item.dimensions?.[1] ? ' · '+item.dimensions.slice(0,2).join(' × ')+' мм' : '');
  if (group==='storage') {
    const drawers = item.name.match(/\d+\s+ящик[^\s]*/i)?.[0];
    return 'Riva ' + model + (drawers ? ' · '+drawers : '');
  }
  return item.name.replace(/^(офисное кресло эконом|кресло)\s+/i,'');
}

function kitRows(qty) {
  return kitSelection(qty).map(({group,id,qty:units})=>{
    const options = group.models.map(id=>productById.get(id)).filter(Boolean);
    return `<div class="kit-row"><label><span class="field-label">${e(group.label)}</span><select class="field" data-kit-model="${group.id}">
      ${group.optional?'<option value="0">Не добавлять</option>':''}${options.map(item=>`<option value="${item.id}" ${id===item.id?'selected':''}>${e(kitOptionLabel(group.id,item))} · ${money(item.price,item.max)}</option>`).join('')}</select></label>
      <label><span class="field-label">Количество</span><input class="field" type="number" min="1" max="5000" value="${units}" data-kit-qty="${group.id}" aria-label="Количество — ${e(group.label)}" ${id?'':'disabled'}></label></div>`;
  }).join('');
}

function syncKitRows(qty) {
  for (const {group,id,qty:units} of kitSelection(qty)) {
    const field = document.querySelector(`[data-kit-qty="${group.id}"]`);
    if (!field) continue;
    field.value = units;
    field.disabled = !id;
  }
}

function updateKitChoice(element) {
  const group = element.dataset.kitModel || element.dataset.kitQty;
  const value = Number(element.value);
  const previous = kitPreferences[group] || {};
  if (element.dataset.kitModel) {
    kitPreferences[group] = {...previous,id:value};
    if (group==='storage' && !previous.id && value) kitPreferences[group].qty=1;
  } else if (validSeats(value)) kitPreferences[group] = {...previous,qty:value};
  site.save('kit-preferences',kitPreferences);
  const count = Number(document.querySelector('#set-count').value);
  syncKitRows(count);
  updateEstimate();
}

function projectPage(target, qty) {
  const planHelp = hasBackend ? 'Приложите план или ТЗ к запросу.' : 'Приложите план или ТЗ к письму перед отправкой.';
  const choices = seatPresets.includes(qty) ? seatPresets : [...seatPresets,qty];
  return `<div class="shell page">${crumbs([['Комплектация офисов']])}<section class="project-hero"><div class="copy"><h1>Комплектация офисов</h1><p class="intro">Подберём мебель, подготовим планировку и смету, организуем доставку и монтаж.</p><button class="btn" data-scroll="project-form">Получить расчёт</button><p class="small form-hint">${planHelp}</p></div>${photo('./assets/meeting.webp','Стол и кресла в переговорной')}</section>
    <section class="section"><div class="section-head"><h2>Этапы комплектации</h2></div><div class="steps">
    <div><h3>Задача и план</h3><p>Уточняем число мест, сроки, планировку и бюджет.</p></div><div><h3>Подбор и смета</h3><p>Согласуем модели, материалы, состав и стоимость поставки.</p></div><div><h3>Доставка и монтаж</h3><p>После согласования договора поставляем и монтируем мебель по графику.</p></div></div></section>
    <div class="project-demo"><section class="panel" id="kit-builder" tabindex="-1"><h2>Соберите комплект Riva</h2><p class="small">Количество столов и кресел по умолчанию совпадает с числом мест. Любую позицию можно заменить.</p>
      <label class="field-label" for="set-count">Количество рабочих мест</label><select class="field" id="set-count">${choices.map(count=>`<option value="${count}" ${count===qty?'selected':''}>${seatsLabel(count)}</option>`).join('')}</select><div class="kit-choices">${kitRows(qty)}</div><div class="summary" id="estimate" aria-live="polite"></div>
      <div id="kit-availability"></div>
      <div class="actions kit-actions"><button class="btn" data-check-kit hidden></button><button class="btn secondary" data-save-spec>Скачать состав</button></div>
      <p class="small"><a class="text-link" id="planner-link" href="#/projects/workspace-layout?seats=${qty}">Открыть планировщик</a></p></section>
      <form class="panel" id="request-form" data-kind="project" ${target?'data-product="'+target.id+'"':''}><h2 id="project-form" tabindex="-1">Запросить смету</h2>
      ${transportNote()}
      ${target?'<p class="small">'+e(target.name)+'</p>':''}
      <label class="field-label" for="request-kit">Что рассчитать</label><select class="field" id="request-kit" name="kit"><option value="">Подбор по моему плану</option><option value="riva" ${target?'':'selected'} ${kitEstimate(qty,city).ready?'':'disabled'}>Комплект Riva</option></select>
      <p class="small" id="quote-kit" aria-live="polite"></p>
      <label><span class="field-label">Город</span><input class="field" name="city" maxlength="80" value="${e(city)}" required></label>
      <label><span class="field-label">Адрес и условия подъёма</span><input class="field" name="address" maxlength="250" autocomplete="street-address" placeholder="Улица, этаж, есть ли грузовой лифт"></label>
      <div class="form-two"><label><span class="field-label">Рабочих мест</span><input class="field" type="number" name="seats" min="1" max="5000" value="${qty}" required></label><label><span class="field-label">К какой дате офис должен быть готов</span><input class="field" type="date" name="date"></label></div>
      <label><span class="field-label">Задача и бюджет</span><textarea class="field" name="task" rows="3" maxlength="1600" placeholder="Что нужно поставить и какой бюджет вы заложили"></textarea></label>
      ${hasBackend?'<label><span class="field-label">План или ТЗ, PDF или изображение до 8 МБ</span><input class="field" type="file" name="file" accept="application/pdf,image/jpeg,image/png"></label>':''}
      ${contactFields()}<button class="btn" type="submit">${hasBackend?'Отправить запрос':'Открыть письмо для расчёта'}</button>
      <p class="small">В смете подтвердим стоимость с услугами, наличие всей партии и дату завершения монтажа.</p>
      ${!hasBackend?'<p class="small">'+planHelp+'</p>':''}<p class="result" role="status" hidden></p></form></div>
      <section class="section"><div class="section-head"><h2>Выполненные проекты</h2><a class="text-link" href="#/projects">Все проекты</a></div><div class="actions"><a class="text-link" href="#/projects/sber">Клиентский зал Сбера</a></div></section>
    </div>`;
}

function updateEstimate() {
  const target = document.querySelector('#estimate');
  if (!target) return;
  const form = document.querySelector('#request-form');
  const qty = Number(document.querySelector('#set-count').value);
  const quote = kitEstimate(qty,form.elements.city.value);
  const priceLabel = (amount, from = false) => amount == null ? 'По запросу' : (from ? 'от ' : '') + format(amount);
  target.innerHTML = quote.products.map(({product,qty})=>`<div class="priced-item"><span><a class="text-link" href="#/product/${product.id}">${e(product.name.replace(dimensionPattern,'').trim())}</a><small>${qty} шт. × ${priceLabel(product.price,product.max>product.price)}</small></span><strong>${priceLabel(product.price==null?null:product.price*qty,product.max>product.price)}</strong></div>`).join('') +
    `
    <div><span>Стоимость мебели</span><strong>${priceLabel(quote.value,quote.from)}</strong></div>
    <div><span>Доставка</span><strong>${priceLabel(quote.delivery,true)}</strong></div>
    <div><span>Сборка${quote.assembly==null?'':` (${quote.rates.assemblyPercent}%)`}</span><strong>${priceLabel(quote.assembly,quote.from)}</strong></div>
    <div><span>Ориентир без подъёма</span><strong>${priceLabel(quote.total,true)}</strong></div>`;
  const logisticsNote = quote.local && quote.rates
    ? `Подъём — от ${format(quote.rates.liftFromPerFloor)} за этаж. Доставку и сборку подтвердим по адресу и условиям на объекте.`
    : 'Доставку, подъём и сборку рассчитаем по адресу.';
  document.querySelector('#kit-availability').innerHTML = `<p class="small">${logisticsNote}</p><p class="small">Проверим наличие всей партии и срок монтажа по запросу.</p>`;
  const check = document.querySelector('[data-check-kit]');
  check.hidden = !quote.ready;
  check.textContent = 'Проверить наличие на ' + seatsLabel(qty);
  document.querySelector('[data-save-spec]').disabled = !quote.ready;
  document.querySelector('#planner-link').href = '#/projects/workspace-layout?seats=' + qty;
  document.querySelector('#quote-kit').textContent = form.elements.kit.value === officeConfig.workspaceKit?.id
    ? 'Комплект Riva: ' + seatsLabel(qty) + '. Проверим наличие всей партии.'
    : '';
}

function syncQuoteCount(qty) {
  const select = document.querySelector('#set-count');
  for (const option of Array.from(select.options)) {
    if (!seatPresets.includes(Number(option.value)) && Number(option.value)!==qty) option.remove();
  }
  if (!Array.from(select.options).some(option=>Number(option.value)===qty)) select.add(new Option(seatsLabel(qty),qty));
  select.value = String(qty);
  syncKitRows(qty);
  updateEstimate();
}

function workspaceLayout(qty) {
  const desk = kitSelection(qty).find(item=>item.group.id==='desk');
  return page('Планировщик рабочих мест',`<p class="intro">Выберите столы, число мест и схему. Введите размеры комнаты, чтобы сравнить её с габаритами расстановки.</p>
    <div class="planner-grid">
      <section class="panel planner-controls" id="plan-controls"><h2>Помещение</h2>
      <div class="form-two"><label><span class="field-label">Ширина, м</span><input class="field" type="number" min="2" max="60" step="0.1" name="width" value="${roomPlan.width}"></label>
      <label><span class="field-label">Глубина, м</span><input class="field" type="number" min="2" max="60" step="0.1" name="depth" value="${roomPlan.depth}"></label></div>
      <label><span class="field-label">Места</span><input class="field" type="number" min="1" max="40" name="seats" value="${Math.min(qty,40)}"></label>
      <label><span class="field-label">Модель стола</span><select class="field" name="desk">${desk?.group.models.map(id=>productById.get(id)).filter(Boolean).map(item=>`<option value="${item.id}" ${desk.id===item.id?'selected':''}>Riva · ${e(dimensionsLabel(item.dimensions))}</option>`).join('') || ''}</select></label>
      <label><span class="field-label">Расстановка</span><select class="field" name="layout">${workspace.layouts.map(([key,label])=>`<option value="${key}" ${roomPlan.layout===key?'selected':''}>${label}</option>`).join('')}</select></label>
      <label><span class="field-label">Расстояние между рядами или группами, м</span><input class="field" type="number" min="0.5" max="4" step="0.1" name="gap" value="${roomPlan.gap}"></label>
      <a class="btn" id="plan-to-kit" href="#/project?section=kit&seats=${qty}">Применить к комплекту</a></section>
      <section class="panel plan-visual"><h2>Расстановка столов</h2><div id="room-preview"></div><p id="room-status" class="plan-status" aria-live="polite"></p>
      <p class="small">На схеме предусмотрено по 0,7 м на зону кресла. Двери, колонны, тумбы и проходы вдоль стен уточняются по плану.</p></section>
    </div>`,[['Комплектация','#/project']]);
}

function updateRoomPreview(save = false) {
  const controls = document.querySelector('#plan-controls');
  if (!controls) return;
  const read = name=>controls.querySelector('[name="'+name+'"]').value;
  const count = Number(read('seats'));
  const desk = productById.get(Number(read('desk')));
  const room = workspace.planSettings(Object.fromEntries(['width','depth','gap','layout'].map(key=>[key,read(key)])));
  const valid = [...controls.querySelectorAll('input')].every(input=>input.value && input.checkValidity());
  const layout = valid ? workspace.arrange(count,desk?.dimensions,room) : null;
  const target = document.querySelector('#room-preview');
  const status = document.querySelector('#room-status');
  const apply = document.querySelector('#plan-to-kit');
  apply.dataset.planSeats = layout ? String(count) : '';
  apply.dataset.planDesk = desk?.id || '';
  apply.setAttribute('aria-disabled',String(!layout));
  if (save) { roomPlan=room; site.save('room-plan',roomPlan); }
  if (!layout) {
    target.innerHTML='';
    status.textContent='Проверьте размеры комнаты, расстояние и количество мест от 1 до 40.';
    return;
  }
  apply.href='#/project?section=kit&seats='+count;
  const inside = layout.width <= room.width+.00001 && layout.depth <= room.depth+.00001;
  const w = Math.max(room.width,layout.width);
  const h = Math.max(room.depth,layout.depth);
  const pct = (value,total)=>(value/total*100).toFixed(3)+'%';
  const rect = (x,y,width,depth)=>'left:'+pct(x,w)+';top:'+pct(y,h)+';width:'+pct(width,w)+';height:'+pct(depth,h);
  const shape = layout.tables.map(({x,y,width,depth,chairTop,chair,number})=>`<i class="diagram-desk" style="${rect(x,y,width,depth)}">${number}</i><i class="diagram-chair" style="${rect(x+width*.28,chairTop+.08,width*.44,chair-.16)}"></i>`).join('');
  target.innerHTML=`<div class="room-diagram" style="aspect-ratio:${w}/${h};max-width:${Math.min(100,w/h*65)}%" aria-hidden="true"><div class="diagram-walls" style="${rect(0,0,room.width,room.depth)}"></div>${shape}</div>`;
  status.textContent=(inside?'Помещается по габаритам. ':'Выходит за границы комнаты. ')+'Расстановка занимает '+new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(layout.width)+' × '+new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(layout.depth)+' м.';
  status.classList.toggle('does-not-fit',!inside);
}

function deliveryPage() {
  return page('Доставка и сборка',`
    <p class="intro">Доставляем мебель по Перми и Пермскому краю. Поставки в другие города рассчитываем по адресу, объёму и сроку заказа.</p>
    ${serviceFacts()}
    <section class="section service-details"><div><h2>Ориентиры по срокам</h2><dl class="delivery-timing">${site.delivery.map(([label,time])=>`<div><dt>${e(label)}</dt><dd>${e(time)}</dd></div>`).join('')}</dl><p class="small">Интервалы зависят от наличия и объёма заказа. Даты доставки и монтажа согласуем при оформлении.</p></div>
    <aside class="panel delivery-checklist"><h2>Что нужно для точного расчёта</h2><ul><li>Адрес, этаж и наличие грузового лифта.</li><li>Количество изделий и размеры самых крупных деталей.</li><li>Доступ для разгрузки и желаемая дата готовности.</li></ul><p>Для офиса приложите план или список мебели.</p><a class="btn" href="#/project">Запросить расчёт</a></aside></section>
    <section class="section"><div class="section-head"><h2>Сборка на объекте</h2></div><div class="steps service-steps">
      <div><h3>Согласуем дату</h3><p>По стандартным условиям сборка проводится в рабочее время. Сборку в день доставки согласуем по заказу.</p></div>
      <div><h3>Проверим доступ</h3><p>Подъём, установка навесных элементов и нестандартные условия согласуются и оплачиваются отдельно.</p></div>
      <div><h3>Уточним объём</h3><p>Демонтаж и утилизация старой мебели в стандартную сборку не входят. Опишите эти работы при запросе.</p></div></div></section>
    <section class="section"><h2>Вопросы по доставке</h2><div class="faq">
      <details><summary>Можно привезти мебель к дате переезда?</summary><p>Укажите, когда офис должен быть готов. Менеджер проверит наличие партии, отдельно согласует дату доставки и завершения сборки.</p></details>
      <details><summary>Можно заказать поставку в другой город?</summary><p>Да. Для расчёта укажите город, адрес и состав заказа. Тарифы для Перми приведены отдельно.</p></details>
      <details><summary>Что делать, если при доставке не хватает детали?</summary><p>Зафиксируйте недостачу или повреждение, подготовьте фото и сообщите номер заказа менеджеру.</p></details>
    </div><a class="text-link" href="#/service">Оплата, документы и сервис</a></section>`);
}

function servicePage() {
  return page('Услуги и сервис',`<p class="intro">Помогаем с комплектацией, документами по заказу и вопросами после поставки.</p>
    <div class="steps service-steps">
      <div><h3>Подбор и дизайн-проект</h3><p>Пришлите план и число сотрудников. Подберём рабочие места, переговорные, хранение и мебель для зоны приёма.</p><a class="text-link" href="#/project">Рассчитать комплектацию</a></div>
      <div><h3>Доставка, подъём и монтаж</h3><p>Оценим объём, адрес, подъём на этаж и условия сборки. Для проекта согласуем график работ.</p><a class="text-link" href="#/delivery">Тарифы и сроки</a></div>
      <div><h3>Оплата и документы</h3><p>Для организаций подготовим коммерческое предложение и счёт. Условия оплаты и комплект документов согласуйте с менеджером.</p><a class="text-link" href="#/contacts">Контакты</a></div></div>
    <section class="section service-details"><div><h2>Гарантия и обращение по заказу</h2><p>Условия гарантии зависят от изделия. При повреждении или некомплекте укажите номер заказа и артикул, опишите проблему и приложите фотографии. Если мебель уже собрана, сообщите об этом менеджеру.</p></div>
    <aside class="panel"><h3>Связаться с сервисом</h3><p class="small">Подготовьте номер заказа, чтобы мы быстрее нашли поставку.</p><a class="text-link" href="mailto:${site.email}">${site.email}</a><br><a class="text-link" href="tel:+73422155898">${site.phone}</a></aside></section>`);
}

function contactsPage(showroom) {
  const contacts = officeConfig.contacts;
  const address = contacts?.address || 'Пермь, ул. Екатерининская, 10';
  const mapId = contacts?.mapId || '220992897587';
  const mapLink = 'https://yandex.ru/maps/org/grand_ofis/'+mapId+'/';
  const mapParams = new URLSearchParams({oid:mapId,ol:'biz',z:'16'});
  if (contacts?.coordinates) mapParams.set('ll',contacts.coordinates.join(','));
  const mapFrame = 'https://yandex.ru/map-widget/v1/?'+mapParams;
  return page(showroom?'Шоурум':'Контакты',`<p class="intro">${showroom?'Перед визитом уточните часы работы и наличие модели, которую хотите посмотреть.':'Свяжитесь с нами, чтобы подобрать мебель, рассчитать поставку или уточнить условия по заказу.'}</p>
    <section class="contacts-grid"><div class="panel"><h2>Офис в Перми</h2><dl class="contact-details">
    <div><dt>Адрес</dt><dd>${e(address)}</dd></div><div><dt>Телефон</dt><dd><a class="text-link" href="tel:+73422155898">${site.phone}</a></dd></div><div><dt>Почта</dt><dd><a class="text-link" href="mailto:${site.email}">${site.email}</a></dd></div>
    ${contacts?.stop?'<div><dt>Ближайшая остановка</dt><dd>'+e(contacts.stop)+'</dd></div>':''}</dl>
    <div class="actions"><a class="btn" href="tel:+73422155898">Позвонить</a><a class="btn secondary" href="${mapLink}">Маршрут и график</a></div></div>
    <div class="contact-map"><iframe title="Яндекс Карта — Гранд-Офис на Екатерининской, 10" src="${e(mapFrame)}" loading="lazy" allowfullscreen></iframe></div></section>
    <section class="section"><div class="section-head"><h2>Как найти офис</h2></div><div class="contacts-grid entrance-grid">${photo('./assets/company.webp','Вход и вывеска Гранд-Офис на Екатерининской улице','loading="lazy" width="1158" height="850"')}
      <div class="panel"><h3>Перед визитом</h3><p>Ориентир — вывеска «Гранд-Офис» на фасаде. Позвоните заранее, если хотите посмотреть конкретное кресло, стол или образец отделки.</p><h3>Для расчёта офиса</h3><p>Пришлите план, число рабочих мест и дату переезда. Для доставки сообщите адрес, этаж и наличие грузового лифта.</p><a class="text-link" href="#/project">Запросить смету</a></div></div></section>`);
}

function aboutPage() {
  return page('О компании',`<p class="intro">«Гранд-Офис» поставляет офисную мебель в Перми и Пермском крае. Помогаем с отдельной покупкой и оснащением офиса под ключ.</p>
    <section class="project-feature about-feature">${photo('./assets/company.webp','Офис компании Гранд-Офис в Перми','loading="lazy" width="1158" height="850"')}
      <div><h2>От планировки до монтажа</h2><p>Подбираем мебель для рабочих мест, кабинетов, переговорных и клиентских зон. Согласуем расстановку, комплектацию и график поставки.</p><div class="actions"><a class="btn" href="#/project">Обсудить проект</a><a class="text-link" href="#/contacts">Как нас найти</a></div></div></section>
    <section class="section"><div class="section-head"><h2>Как работаем</h2></div><div class="steps service-steps">
      <div><h3>Комплектация по задаче</h3><p>Начинаем с плана, числа сотрудников и бюджета. Подбираем мебель по размерам, отделке и назначению зоны.</p></div>
      <div><h3>Производители и склад</h3><p>Работаем с мебельными фабриками и собственным складом в Перми. Наличие и сроки подтверждаем по конкретным моделям.</p></div>
      <div><h3>Поставка и сопровождение</h3><p>Согласуем состав заказа и документы, доставим и соберём мебель на объекте. Поможем с вопросами по гарантийному обслуживанию.</p></div></div></section>
    <section class="section"><div class="section-head"><h2>Проекты компании</h2><a class="text-link" href="#/projects">Смотреть портфолио</a></div>${projectShowcase()}</section>`);
}

function projectsPage(id) {
  const item = site.projects.find(project=>project.id===id);
  if (item) return page(item.name,`<div class="case-highlight case-detail"><figure class="case-cover">${photo('./assets/'+item.image,item.zone,'width="656" height="505"')}</figure><div class="case-summary"><h2>${e(item.zone)}</h2><p>${e(item.description)}</p><a class="btn" href="#/project">Рассчитать похожий офис</a></div></div>
      <section class="spec"><h2>Мебель в кадре</h2><dl>${item.items.map(([zone,furniture])=>`<div><dt>${e(zone)}</dt><dd>${e(furniture)}</dd></div>`).join('')}</dl></section>
      <section class="section"><div class="section-head"><h2>Другие проекты</h2></div>${projectShowcase()}</section>`,[['Проекты','#/projects']]);
  return page('Выполненные проекты',`<p class="intro">Посмотрите клиентские залы, открытые офисы и рабочие зоны из портфолио. Для своего помещения можно собрать мебель и проверить расстановку по размерам комнаты.</p><div class="section">${projectShowcase()}</div>
    <section class="project-feature kit-hero">${photo('./assets/riva-interior.webp','Рабочая мебель Riva в офисе','loading="lazy"')}<div><h2>Расстановка для вашего офиса</h2><p>Выберите мебель и сравните один ряд, два ряда и группы столов. Параметры можно перенести в расчёт комплекта.</p><a class="btn" href="#/projects/workspace-layout">Открыть планировщик</a></div></section>`);
}

function infoPage(key,id) {
  if (key==='delivery') return deliveryPage();
  if (key==='service') return servicePage();
  if (key==='about') return aboutPage();
  if (key==='contacts' || key==='showroom') return contactsPage(key==='showroom');
  if (key==='projects') return projectsPage(id);
  return page('Страница не найдена','<p class="intro"><a class="text-link" href="#/">Вернуться на главную</a></p>');
}

function getRoute() {
  const [route, args] = location.hash.replace(/^#\/?/,'').split('?');
  const [key,id] = route.split('/');
  return {key,id,args:new URLSearchParams(args)};
}

const loadConfig=site.config.then(config=>{officeConfig=config;});
async function loadCatalog() {
  if (catalog) return;
  const raw = await site.catalog();
  if (raw && !catalog) { catalog=raw; prepare(raw); }
}

async function loadDetail(id) {
  if (!Number.isInteger(id) || id<1) return null;
  const data = await site.getDetails(id).catch(()=>null);
  if (data?.[6] && !productById.has(id)) productById.set(id,fromProduct(data[6]));
  return data;
}

async function loadProjectItems(product) {
  await loadConfig;
  if (!hasBackend) {
    const entries = await site.getFeatured();
    for (const row of entries) if (!productById.has(row[0])) productById.set(row[0],fromProduct(row));
  }
  const ids = [...new Set([...kitGroups().flatMap(group=>group.models),product].filter(Boolean))];
  await Promise.all(ids.filter(id=>!productById.has(id)).map(loadDetail));
}

async function render(move = false) {
  const current = ++revision;
  const {key,id,args} = getRoute();
  const product = Number(id);
  const target = Number(args.get('product'));
  let details, variant;

  document.querySelectorAll('[data-nav]').forEach(a=> a.dataset.nav===key ? a.setAttribute('aria-current','page'):a.removeAttribute('aria-current'));
  const search = document.querySelector('#search-input');
  if (key==='catalog') {
    search.value=args.get('q') || '';
    if (!catalog) main.innerHTML = '<p class="shell page" role="status">Загрузка каталога…</p>';
    await loadCatalog();
  } else if (key==='project' || id==='workspace-layout') {
    await loadProjectItems(target);
  } else if (key==='product') {
    await loadConfig;
    details = await loadDetail(product);
    const selected = site.session('selected-'+product,null);
    if (details?.[2]?.some(item=>item[0]===selected)) variant = await site.variation(product,selected);
  } else await loadConfig;
  if (current!==revision) return;
  if (!key || key==='main') main.innerHTML=home();
  else if (key==='catalog') {catalogOrigin=location.hash;main.innerHTML=catalogPage(args);}
  else if (key==='project') {
    main.innerHTML=projectPage(productById.get(target),validSeats(args.get('seats')) || 4);
    updateEstimate();
  } else if (id==='workspace-layout') {
    main.innerHTML=workspaceLayout(validSeats(args.get('seats')) || 8);
    updateRoomPreview();
  } else if (key==='product' && productById.has(product)) main.innerHTML=itemPage(productById.get(product),details,variant);
  else if (key==='cart') main.innerHTML=cartPage();
  else if (key==='checkout') main.innerHTML=checkoutPage();
  else main.innerHTML=infoPage(key,id);
  if (key==='project' && args.get('section')==='kit') {
    const kit=document.querySelector('#kit-builder');
    kit?.focus({preventScroll:true});
    kit?.scrollIntoView({block:'start'});
  } else if (move) {
    main.focus({preventScroll:true});
    window.scrollTo(0,positions.get(location.hash) || 0);
  }
  main.querySelectorAll('.project-track').forEach(syncCarousel);
  const heading = main.querySelector('h1')?.textContent;
  document.title = heading ? heading + ' — Гранд-Офис' : 'Гранд-Офис';
}

function kitSummary(qty, destination) {
  const quote = kitEstimate(qty,destination);
  if (!quote.ready) return [];
  const pricing = quote.value == null ? [] : [
    'Мебель: ' + (quote.from?'от ':'') + format(quote.value),
    ...(quote.delivery==null ? [] : ['Доставка: от ' + format(quote.delivery)]),
    ...(quote.assembly==null ? [] : ['Сборка: ' + (quote.from?'от ':'') + format(quote.assembly)]),
    ...(quote.total==null ? [] : ['Ориентир без подъёма: от ' + format(quote.total)]),
  ];
  const plan = kitPreferences.plan;
  const layout = plan && workspace.layouts.find(([key])=>key===plan.layout);
  return ['Комплект Riva на ' + seatsLabel(qty),
    ...quote.products.map(({product,qty})=>[product.name,product.sku ? 'арт. '+product.sku:'',qty+' шт.',money(product.price,product.max)].filter(Boolean).join(' · ')),
    ...pricing,
    ...(layout ? ['Помещение: '+plan.width+' × '+plan.depth+' м. '+layout[1]+', расстояние '+plan.gap+' м.'] : [])];
}

function downloadSpec() {
  const qty = Number(document.querySelector('#set-count').value);
  const destination = document.querySelector('#request-form').elements.city.value;
  const body = ['Гранд-Офис', 'Город: '+destination, ...kitSummary(qty,destination),
    'Просьба подтвердить наличие всей партии, итоговую стоимость с услугами и срок монтажа.', site.email].join('\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF',body],{type:'text/plain;charset=utf-8'}));
  const link=document.createElement('a'); link.href=url;link.download='Комплект Riva.txt';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}

function syncCarousel(track) {
  const carousel=track.closest('.project-carousel');
  carousel.querySelector('[data-projects="-1"]').disabled=track.scrollLeft<2;
  carousel.querySelector('[data-projects="1"]').disabled=track.clientWidth+track.scrollLeft>=track.scrollWidth-2;
}
main.addEventListener('scroll',event=>{
  if (event.target.classList?.contains('project-track')) syncCarousel(event.target);
},true);
window.addEventListener('resize',()=>main.querySelectorAll('.project-track').forEach(syncCarousel));

main.addEventListener('click', async (event)=>{
  const apply = event.target.closest('#plan-to-kit');
  if (apply) {
    if (!apply.dataset.planSeats || !apply.dataset.planDesk) {event.preventDefault();return;}
    updateRoomPreview(true);
    kitPreferences.desk = {id:Number(apply.dataset.planDesk),qty:Number(apply.dataset.planSeats)};
    kitPreferences.plan = {...roomPlan};
    site.save('kit-preferences',kitPreferences);
  }
  const control=event.target.closest('button');
  if (!control) return;
  const {photo, add, remove, scroll} = control.dataset;
  if (control.dataset.projects) {
    const track = control.closest('.project-carousel').querySelector('.project-track');
    const step = track.firstElementChild.getBoundingClientRect().width + (parseFloat(getComputedStyle(track).columnGap) || 0);
    track.scrollBy({left:step*Number(control.dataset.projects),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
  if (photo) {
    main.querySelector('.gallery img').src=photo;
    const caption = main.querySelector('.photo-caption');
    if (caption) caption.textContent = control.dataset.variantPhoto==='true' ? 'Фото выбранного варианта' : 'Общее фото модели';
  }
  if (scroll) {
    const target = document.getElementById(scroll);
    target?.focus({preventScroll:true});
    target?.scrollIntoView({block:'start'});
  }
  if (control.hasAttribute('data-save-spec')) downloadSpec();
  if (control.hasAttribute('data-check-kit')) {
    const form = document.querySelector('#request-form');
    form.elements.kit.value = officeConfig.workspaceKit.id;
    form.elements.seats.value = document.querySelector('#set-count').value;
    updateEstimate();
    document.getElementById('project-form').focus();
  }
  if (remove!==undefined) {
    cart.splice(Number(remove),1);
    saveCart();
    await render();
    const next = main.querySelector(`[data-remove="${Math.min(Number(remove),cart.length-1)}"]`) || main.querySelector('.btn');
    next?.focus();
  }
  if (!add) return;
  const item = productById.get(Number(add));
  const choice = Number(document.querySelector('#product-option')?.value || 0);
  const data = await site.getDetails(item.id).catch(()=>null);
  const option = data?.[2]?.find(o=>o[0]===choice);
  const variation = option ? await site.variation(item.id,choice) : null;
  const key = item.id + ':' + choice;
  const row=cart.find(r=>r.key===key);
  const cap = variation?.stock ?? option?.[3] ?? (hasBackend && !data?.[2]?.length ? data?.[5] : null) ?? 999;
  if (!cap) return;
  if (row) row.qty=Math.min(cap,999,row.qty+1);
  else cart.push({key,id:item.id,choice,variant:option?.[1],name:item.name,sku:item.sku,image:variation?.image || item.image,price:priceOf(item,option,variation),qty:1,cap});
  saveCart();
  const result=main.querySelector('#cart-result');
  if (result) { result.hidden=false;result.innerHTML='Товар добавлен. <a class="text-link" href="#/cart">Открыть корзину</a>'; }
});
main.addEventListener('change',event=>{
  const element=event.target;
  if (element.id==='set-count') {
    const form = document.querySelector('#request-form');
    form.elements.seats.value=element.value;
    if (!form.dataset.product) form.elements.kit.value = officeConfig.workspaceKit?.id || '';
    syncKitRows(Number(element.value));
    updateEstimate();
  }
  if (element.name==='kit') updateEstimate();
  if (element.dataset.kitModel || element.dataset.kitQty) updateKitChoice(element);
  if (element.closest('#plan-controls')) updateRoomPreview(true);
  if (element.id==='product-option') {
    const choice=Number(element.value);
    site.save('selected-'+element.dataset.id,choice);
    const button = main.querySelector('[data-add]');
    const status = main.querySelector('#variant-status');
    if (button) button.disabled = true;
    if (status && choice) {status.hidden=false;status.textContent='Загружаем фото и цену варианта…';}
    render().then(()=>document.querySelector('#product-option')?.focus({preventScroll:true}));
  }
  if ('qty' in element.dataset) {
    const selected=cart[Number(element.dataset.qty)];
    selected.qty=Math.max(1,Math.min(selected.cap || 999,Math.trunc(element.valueAsNumber)||1));
    element.value = selected.qty;
    saveCart();
    document.querySelector('#basket-total').textContent = cart.some(row=>row.price==null) ? 'Уточняется' : format(lineTotal());
  }
});

main.addEventListener('input',event=>{
  const input=event.target;
  if (input.closest('#plan-controls')) updateRoomPreview();
  if (input.form?.dataset.kind!=='project') return;
  if (input.name==='city') updateEstimate();
  if (input.name==='seats' && validSeats(input.value)) syncQuoteCount(validSeats(input.value));
});

async function toEncoded(file) {
  if (!file || !file.size) return null;
  if (file.size>8*1024*1024 || !['application/pdf','image/jpeg','image/png'].includes(file.type)) throw new Error('Выберите PDF, JPG или PNG размером до 8 МБ.');
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve({name:file.name,type:file.type,base64:String(reader.result).split(',')[1]});
    reader.onerror=()=>reject(new Error('Не удалось прочитать файл.'));
    reader.readAsDataURL(file);
  });
}
function mailBody(kind, data) {
  const lines = [kind==='order'?'Заказ мебели':'Запрос сметы','Имя: '+data.name,'Контакт: '+data.contact,'Город: '+data.city];
  if (kind==='order') lines.push('Адрес: '+(data.address||'уточняется'),'Получение: '+data.delivery,'', ...cart.map(r=>[r.name,r.variant,r.sku,r.qty+' шт.'].filter(Boolean).join(' · ')));
  else {
    lines.push('Рабочих мест: '+data.seats,'Дата готовности офиса после монтажа: '+(data.date ? data.date.split('-').reverse().join('.') : 'уточняется'),data.address?'Адрес и подъём: '+data.address:'',data.task?'Задача и бюджет: '+data.task:'');
    if (data.kit && data.kit===officeConfig.workspaceKit?.id) lines.push(...kitSummary(Number(data.seats),data.city));
    else if (data.product) lines.push('Товар: '+data.product);
    lines.push('Просьба подтвердить в смете наличие всей партии, итоговую сумму с доставкой, подъёмом и сборкой и дату завершения монтажа.');
  }
  return lines.filter(Boolean).join('\n');
}

main.addEventListener('submit',async(event)=>{
  const form=event.target;
  event.preventDefault();
  if (form.id==='filters') {
    const params=new URLSearchParams();
    for (const [key,value] of new FormData(form)) if (String(value).trim()) params.set(key,String(value).trim());
    location.hash='#/catalog?'+params;
    return;
  }
  if (form.id!=='request-form') return;
  const data=Object.fromEntries(new FormData(form));
  const kind=form.dataset.kind;
  if (form.dataset.product && !data.kit) data.product=productById.get(Number(form.dataset.product))?.name || '';
  const status=form.querySelector('.result');
  if (!hasBackend) {
    status.hidden=false;
    status.innerHTML='Откроется почтовое приложение. <a class="text-link" href="'+e(site.mail(kind==='order'?'Заказ мебели':'Запрос комплектации',mailBody(kind,data)))+'">Открыть письмо</a>';
    location.href=site.mail(kind==='order'?'Заказ мебели':'Запрос комплектации',mailBody(kind,data));
    return;
  }
  const button=form.querySelector('[type="submit"]');
  if (button.disabled) return;
  button.disabled=true;
  form.dataset.token ||= crypto.randomUUID();
  try {
    data.file=await toEncoded(data.file);
    if (kind==='project' && data.kit) {
      data.kitLines=kitEstimate(Number(data.seats),data.city).products.map(({group,product,qty})=>({group:group.id,id:product.id,qty}));
      data.roomPlan=kitPreferences.plan;
    }
    const receipt=await site.post('requests',{kind,token:form.dataset.token,...data,lines:kind==='order'?cart.map(({id,choice,qty})=>({id,choice,qty})):[]});
    status.textContent=(kind==='order'?'Заказ № ':'Заявка № ')+receipt.id+' принята. Менеджер свяжется с вами для подтверждения.';
    if (kind==='order') {cart=[];saveCart();}
    form.reset();
    if (kind==='project') { form.elements.seats.value=document.querySelector('#set-count').value; updateEstimate(); }
    delete form.dataset.token;
  } catch (error) { status.textContent=error.message; }
  finally { status.hidden=false;button.disabled=false; }
});

document.querySelector('#global-search').addEventListener('submit',(event)=>{
  event.preventDefault(); const value=document.querySelector('#search-input').value.trim();
  location.hash='#/catalog'+(value?'?q='+encodeURIComponent(value):'');
});
const dialog=document.querySelector('#city-dialog');
const cityInput=document.querySelector('#city-input');
document.querySelector('#city-button').addEventListener('click',()=>{cityInput.value=city;dialog.returnValue='';dialog.showModal();});
dialog.addEventListener('close',()=>{
  if (dialog.returnValue!=='save' || !cityInput.value.trim()) return;
  city=cityInput.value.trim();site.save('city',city);document.querySelector('#city-name').textContent=city;
  const form=document.querySelector('#request-form');
  if (form) {
    form.elements.city.value=city;
    if (form.dataset.kind==='project') updateEstimate();
  } else render();
});
document.querySelector('#city-name').textContent=city;
saveCart();
site.backend.then(value=>{hasBackend=value;return render();});
window.addEventListener('hashchange',()=>{
  if (location.hash==='#main') return;
  positions.set(previousRoute,window.scrollY);
  previousRoute=location.hash;
  render(true);
});
