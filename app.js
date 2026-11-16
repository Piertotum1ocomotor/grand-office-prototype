'use strict';

const { escape: e, normalize, money, format } = site;
const main = document.querySelector('#main');
let catalog;
let hasBackend = false;
let city = site.session('city', 'Пермь');
let cart = site.session('basket', []);
if (!Array.isArray(cart)) cart = [];
let revision = 0;
const pageSize = 24;
const positions = new Map();
let previousRoute = location.hash;
let catalogOrigin = '#/catalog';

const fromProduct = ([id, name, sku, price, max, image, categories, stock, backorder, url]) => (
  {id, name, sku, price, max, image, categories, stock, backorder, url}
);
const crumbs = (links) => '<nav class="breadcrumb" aria-label="Хлебные крошки"><a href="#/">Главная</a>' +
  links.map(([name, href]) => '<span aria-hidden="true">/</span>' +
    (href ? '<a href="' + e(href) + '">' + e(name) + '</a>' : '<span aria-current="page">' + e(name) + '</span>')).join('') + '</nav>';
const page = (title, body, levels = []) => '<div class="shell page">' + crumbs([...levels,[title]]) + '<h1>' + e(title) + '</h1>' + body + '</div>';
const photo = (src, alt = '', extra = '') => src ? '<img src="' + e(src) + '" alt="' + e(alt) + '" ' + extra + '>' : '<div class="no-photo" aria-label="Фото отсутствует">Гранд-Офис</div>';
const card = (item) => `<article class="product"><a class="product-photo" href="#/product/${item.id}" aria-label="${e(item.name)}">${photo(item.image,'','loading="lazy" width="380" height="235"')}</a><div class="product-card"><h3><a href="#/product/${item.id}">${e(item.name)}</a></h3>${item.sku ? '<p class="meta">Арт. '+e(item.sku)+'</p>' : ''}<p class="price">${money(item.price,item.max)}</p><p class="small">${item.backorder ? 'Под заказ' : 'Наличие уточняется'}</p></div></article>`;
const categoryCard = ([name, image, category]) => `<a class="category" href="#/catalog?c=${encodeURIComponent(category)}">${photo('./assets/'+image,'','loading="lazy"')}<span>${e(name)}</span></a>`;
const projectCard = (p) => `<a class="category project-card" href="#/projects/${p.id}">${photo('./assets/'+p.image,'','loading="lazy"')}<span>${e(p.name)}</span></a>`;

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
    <section class="project-feature">${photo('./assets/staff.webp','Рабочая зона на несколько сотрудников','loading="lazy"')}
      <div><p class="eyebrow">Серия Riva</p><h2>Комплект рабочих мест</h2>
        <p>Столы и кресла на 1, 4 или 8 мест. Посмотрите состав или запросите расчёт по плану помещения.</p><a class="btn" href="#/project">Посмотреть комплекты</a></div>
    </section>
    <section class="section"><div class="section-head"><h2>Наши проекты</h2><a class="text-link" href="#/projects">Все проекты</a></div><div class="category-grid four">${site.projects.map(projectCard).join('')}</div></section>
    <section class="service-strip"><div><h2>Доставка и сборка</h2><p>В Перми и за её пределами. Стоимость и дату подтвердим по составу заказа и адресу.</p></div><a class="btn secondary" href="#/delivery">Условия доставки</a></section>
    </div>`;
}

const catById = new Map();
const catBySlug = new Map();
const productById = new Map();
function prepare(data) {
  if (!data) return;
  data.categories.forEach((c) => {
    catById.set(c.id,c);
    if (c.slug) catBySlug.set(c.slug,c);
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
  if (key === 'chairs') return /кресло|кресла|стул|стулья/.test(normalize(item.name));
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

function findDimensions(name) {
  const dimensions = name.match(/(\d{2,4})\s*[×xх]\s*(\d{2,4})\s*[×xх]\s*(\d{2,4})/i);
  return dimensions ? dimensions.slice(1).map(Number) : null;
}

function catalogPage(settings) {
  if (!catalog) return page('Каталог', '<p class="intro">Каталог временно недоступен. <a class="text-link" href="'+site.original+'/shop/">Открыть каталог «Гранд-Офиса»</a></p>');
  const c = settings.get('c') || '';
  const query = settings.get('q') || '';
  const sort = settings.get('sort') || '';
  const budget = Math.max(0,Number(settings.get('max')) || 0);
  const width = Math.max(0,Number(settings.get('w')) || 0);
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  const groups = catalog.categories.filter((entry) => !entry.parent && entry.slug).sort((a,b) => a.name.localeCompare(b.name,'ru'));
  const selected = catBySlug.get(c) || catById.get(Number(c));
  const matches = [...productById.values()].filter((entry) => {
    if (!matchesCategory(entry,c) || (budget && (entry.price == null || entry.price > budget))) return false;
    if (width && !(findDimensions(entry.name)?.[0] <= width)) return false;
    const searchable = normalize(entry.name + ' ' + entry.sku);
    return words.every((word) => searchable.includes(word));
  });
  if (sort === 'up') matches.sort((a,b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  if (sort === 'down') matches.sort((a,b) => (b.price ?? -1) - (a.price ?? -1));
  const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
  const offset = Math.min(totalPages, Math.max(1, parseInt(settings.get('p') || '1',10) || 1));
  const title = selected?.name || (c==='chairs' ? 'Кресла и стулья' : 'Каталог офисной мебели');
  const pagination = (n) => {
    const values = new URLSearchParams(settings);
    values.set('p',n);
    return '#/catalog?' + values;
  };
  return page(title,`<form id="filters" class="filters-grid">
      <label><span class="field-label">Название или артикул</span><input class="field" name="q" maxlength="120" value="${e(query)}" placeholder="Например, Riva"></label>
      <label><span class="field-label">Категория</span><select class="field" name="c"><option value="">Все категории</option><option value="chairs" ${c==='chairs'?'selected':''}>Кресла и стулья</option>${groups.map(g=>`<option value="${g.id}" ${selected?.id===g.id?'selected':''}>${e(g.name)}</option>`).join('')}</select></label>
      <label><span class="field-label">Цена до, ₽</span><input class="field" type="number" name="max" min="0" max="100000000" value="${budget || ''}"></label>
      <label><span class="field-label">Ширина до, мм</span><input class="field" type="number" name="w" min="0" max="10000" value="${width||''}"></label>
      <label><span class="field-label">Сортировка</span><select class="field" name="sort"><option value="">По умолчанию</option><option value="up" ${sort==='up'?'selected':''}>Сначала дешевле</option><option value="down" ${sort==='down'?'selected':''}>Сначала дороже</option></select></label>
      <button class="btn" type="submit">Применить</button></form>
      <div class="catalog-heading"><p class="count-label">Найдено: ${new Intl.NumberFormat('ru-RU').format(matches.length)}</p>${query || selected || c || budget || width ? '<a class="text-link" href="#/catalog">Сбросить фильтры</a>':''}</div>
      ${matches.length ? '<div class="product-grid catalog-grid">' + matches.slice((offset-1)*pageSize,offset*pageSize).map(card).join('') + '</div>' : '<div class="empty">По этому запросу ничего не найдено. Попробуйте изменить фильтры.</div>'}
      ${totalPages > 1 ? `<nav class="pagination" aria-label="Страницы каталога">${offset>1?'<a class="btn secondary" href="'+e(pagination(offset-1))+'">Назад</a>':''}<span>Страница ${offset} из ${totalPages}</span>${offset<totalPages?'<a class="btn secondary" href="'+e(pagination(offset+1))+'">Далее</a>':''}</nav>`:''}`);
}

function logistics(item) {
  const local = normalize(city) === 'пермь';
  const root = item.categories.map((id) => categoryRoot(catById.get(id))?.name).join(' ');
  const text = normalize(item.name + ' ' + root);
  let range;
  if (/кресл|стуль/.test(text)) range = '3–5 дней';
  else if (/руководител/.test(text)) range = '3–10 дней';
  else if (/приемной|переговорн/.test(text)) range = '5–12 дней';
  else if (/персонал|стол/.test(text)) range = '3–7 дней';
  return local ? `Ориентир по Перми: доставка от 1 500 ₽${range?', '+range:''}. Сборка и подъём рассчитываются отдельно.` : `Для города ${city} стоимость и срок доставки уточняются по адресу.`;
}

function priceOf(item, option) {
  if (option?.[2] != null) return option[2];
  return item.max > item.price && option ? null : item.price;
}

function itemPage(item, detail) {
  const [images=[],specs=[],opts=[],description=''] = detail || [];
  const pics = images.length ? images : item.image ? [item.image] : [];
  const selected = opts.find((option)=>option[0] === site.session('selected-'+item.id, null));
  const dimensions = findDimensions(item.name);
  const liveStock = selected?.[3] ?? (hasBackend && !opts.length ? detail?.[5] : null);
  return `<div class="shell page">${crumbs([['Каталог',catalogOrigin],[item.name]])}
      <div class="product-layout"><section aria-label="Фотографии товара"><figure class="gallery">${pics[0]?photo(pics[0],item.name):photo('')}</figure>
      ${pics.length>1 ? '<div class="gallery-thumbs">'+pics.slice(0,8).map((src,i)=>`<button type="button" data-photo="${e(src)}" aria-label="Фотография ${i+1}">${photo(src,'','loading="lazy"')}</button>`).join('')+'</div>':''}</section>
      <section class="product-info"><h1>${e(item.name)}</h1>${item.sku?'<p class="meta">Артикул '+e(item.sku)+'</p>':''}
      <p class="product-price">${selected?(priceOf(item,selected)==null ? '<span class="small">Цена варианта уточняется</span>' : money(priceOf(item,selected))):money(item.price,item.max)}</p>
      ${opts.length? `<label><span class="field-label">Вариант</span><select class="field" id="product-option" data-id="${item.id}"><option value="">Выберите вариант</option>${opts.map((o)=>`<option value="${o[0]}" ${o===selected?'selected':''}>${e(o[1] || ('Вариант ' + o[0]))}</option>`).join('')}</select></label>`:''}
      <div class="logistics"><p class="stock">${liveStock>0 ? 'Доступно у поставщика: '+liveStock+' шт.' : (item.backorder?'Под заказ':'Наличие уточняется')}</p><p class="small">${e(logistics(item))}</p></div>
      <div class="actions"><button class="btn" data-add="${item.id}" ${(opts.length && !selected) || liveStock===0?'disabled':''}>В корзину</button><a class="btn secondary" href="#/project?product=${item.id}">Запросить расчёт</a></div><p class="result" id="cart-result" role="status" hidden></p>
      ${item.url?'<p class="small source-link"><a class="text-link" href="'+e(item.url)+'">Карточка в действующем магазине</a></p>':''}</section></div>
      ${description?'<section class="spec"><h2>О товаре</h2><p>'+e(description)+'</p></section>':''}
      ${dimensions? '<section class="spec"><h2>Габариты</h2><p>'+e(dimensions.join(' × '))+' мм</p></section>' : ''}
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
      <div class="summary"><div><span>Стоимость товаров</span><strong>${cart.some((r)=>r.price==null)?'Уточняется':format(lineTotal())}</strong></div></div>
      <a class="btn" href="#/checkout">Оформить заказ</a></aside></div>`);
}

function contactFields() {
  return `<label><span class="field-label">Имя</span><input class="field" name="name" maxlength="100" autocomplete="name" required></label>
    <label><span class="field-label">Телефон или электронная почта</span><input class="field" name="contact" maxlength="140" autocomplete="off" required></label>
    ${hasBackend ? '<label class="consent"><input type="checkbox" name="consent" required> Согласен на обработку данных для ответа на обращение. <a class="text-link" href="https://grand-office59.ru/privacy-policy/">Политика конфиденциальности</a></label>' : ''}`;
}
function checkoutPage() {
  if (!cart.length) return cartPage();
  return page('Оформление заказа',`<div class="project-demo checkout"><form id="request-form" data-kind="order" class="panel">
    <label><span class="field-label">Город</span><input class="field" name="city" value="${e(city)}" required maxlength="80"></label>
    <label><span class="field-label">Адрес доставки</span><input class="field" name="address" maxlength="250" autocomplete="street-address"></label>
    <label><span class="field-label">Дополнительные услуги</span><select class="field" name="delivery"><option>Доставка</option><option>Доставка и сборка</option><option>Доставка, подъём и сборка</option><option>Самовывоз по согласованию</option></select></label>
    ${contactFields()}<button class="btn" type="submit">${hasBackend?'Отправить заказ':'Открыть письмо с заказом'}</button>
    <p class="small">Стоимость услуг и способ оплаты согласует менеджер.</p><p class="result" role="status" hidden></p></form>
    <aside class="panel"><h2>Состав заказа</h2><div class="summary">${cart.map((row)=>`<div><span>${e(row.name)} × ${row.qty}</span><span>${row.price==null?'Уточняется':format(row.price*row.qty)}</span></div>`).join('')}</div></aside></div>`,[['Корзина','#/cart']]);
}

function series() {
  const desk = [...productById.values()].find((p)=>p.sku==='ПЛ.СП-4' || /ПЛ\.СП-4.+Riva/i.test(p.name));
  const chair = productById.get(244689) || productById.get(2609);
  return [desk,chair].filter(Boolean);
}
function projectPage(target) {
  const lines = series();
  const example = lines.length===2 && lines.every((p)=>p.price!=null) ? lines.reduce((sum,p)=>sum+p.price,0) : null;
  return `<div class="shell page">${crumbs([['Комплектация офисов']])}<section class="project-hero"><div class="copy"><h1>Комплектация офисов</h1><p class="intro">Подберём мебель, подготовим планировку и смету, организуем доставку и монтаж.</p><button class="btn" data-scroll="project-form">Получить расчёт</button></div>${photo('./assets/meeting.webp','Стол и кресла в переговорной')}</section>
    <section class="section"><div class="section-head"><h2>Этапы комплектации</h2></div><div class="steps">
    <div><h3>Задача и план</h3><p>Уточняем число мест, сроки, планировку и бюджет.</p></div><div><h3>Подбор и смета</h3><p>Согласуем модели, материалы, состав и стоимость поставки.</p></div><div><h3>Доставка и монтаж</h3><p>После согласования договора поставляем и монтируем мебель по графику.</p></div></div></section>
    <div class="project-demo"><section class="panel"><h2>Комплект Riva</h2><p class="small">Стол и кресло на каждое рабочее место. Доставка и сборка отдельно.</p>
      <label><span class="field-label">Количество рабочих мест</span><select class="field" id="set-count"><option value="1">1 место</option><option value="4" selected>4 места</option><option value="8">8 мест</option></select></label><div class="summary" id="estimate" data-price="${example ?? ''}"></div>
      <button class="btn secondary" data-save-spec>Скачать состав комплекта</button></section>
      <form class="panel" id="request-form" data-kind="project" ${target?'data-product="'+target.id+'"':''}><h2 id="project-form">Запросить смету</h2>
      ${target?'<p class="small">'+e(target.name)+'</p>':''}
      <label><span class="field-label">Город</span><input class="field" name="city" maxlength="80" value="${e(city)}" required></label>
      <div class="form-two"><label><span class="field-label">Рабочих мест</span><input class="field" type="number" name="seats" min="1" max="5000" value="4" required></label><label><span class="field-label">Желаемая дата</span><input class="field" type="date" name="date"></label></div>
      <label><span class="field-label">Задача</span><textarea class="field" name="task" rows="3" maxlength="1600" placeholder="Что нужно поставить или смонтировать"></textarea></label>
      ${hasBackend?'<label><span class="field-label">План или ТЗ, PDF или изображение до 8 МБ</span><input class="field" type="file" name="file" accept="application/pdf,image/jpeg,image/png"></label>':''}
      ${contactFields()}<button class="btn" type="submit">${hasBackend?'Отправить запрос':'Открыть письмо для расчёта'}</button>
      ${!hasBackend?'<p class="small">План или ТЗ можно приложить к письму перед отправкой.</p>':''}<p class="result" role="status" hidden></p></form></div>
      <section class="section"><div class="section-head"><h2>Выполненные проекты</h2><a class="text-link" href="#/projects">Все проекты</a></div><div class="category-grid four">${site.projects.map(projectCard).join('')}</div></section>
    </div>`;
}
function updateEstimate(qty) {
  const target = document.querySelector('#estimate');
  if (!target) return;
  const price = target.dataset.price;
  target.innerHTML = series().map(p=>`<div><a class="text-link" href="#/product/${p.id}">${e(p.name)}</a><span>${qty} шт.</span></div>`).join('')+
    `<div><span>За одно место</span><strong>${price ? money(Number(price)):'По запросу'}</strong></div><div><span>Стоимость мебели</span><strong>${price ? money(Number(price)*qty):'По запросу'}</strong></div>`;
}
function infoPage(key,id) {
  if (key === 'delivery') return page('Доставка и сборка',`<p class="intro">В Перми и Пермском крае доставляем и собираем мебель на объекте. Поставки в другие города рассчитываются отдельно.</p><div class="panel info-panel"><h2>Ориентиры по Перми</h2><dl>${site.delivery.map(([label,time])=>'<div><dt>'+e(label)+'</dt><dd>'+e(time)+'</dd></div>').join('')}</dl><p>Доставка от 1 500 ₽, подъём от 800 ₽ за этаж, сборка — 10% от стоимости мебели по стандартным условиям. Тариф и срок подтверждаем по адресу, габаритам и наличию заказа.</p><div class="actions"><a class="btn" href="#/project">Рассчитать поставку</a><a class="btn secondary" href="#/service">Оплата и сервис</a></div></div>`);
  if (key === 'service') return page('Услуги и сервис',`<div class="section steps"><div><h3>Оплата и документы</h3><p>Менеджер уточнит состав, доставку и способ оплаты. Для организаций можно запросить счёт и документы по заказу.</p></div><div><h3>Сборка</h3><p>Сборку и подъём согласуем по адресу и составу. Дату монтажа фиксируем при подтверждении поставки.</p></div><div><h3>Гарантия и рекламации</h3><p>Условия гарантии зависят от изделия. Если есть повреждение или не хватает детали, сообщите номер заказа, артикул и приложите фото.</p></div></div><a class="btn" href="#/contacts">Связаться с нами</a>`);
  if (key === 'about') return page('О компании',`<section class="project-feature section">${photo('./assets/office.webp','Офисная мебель «Гранд-Офис»')}<div><h2>От планировки до сборки</h2><p>«Гранд-Офис» комплектует рабочие пространства, кабинеты, зоны приёма и переговорные. Помогаем выбрать мебель, согласовать поставку и организовать сборку.</p><a class="btn" href="#/projects">Посмотреть проекты</a></div></section>`);
  if (key === 'contacts' || key === 'showroom') {
    const title = key==='showroom'?'Шоурум':'Контакты';
    return page(title,`<p class="intro">${key==='showroom'?'Уточните время визита и наличие модели для примерки по телефону.':'Подбор мебели, расчёт поставки и вопросы по заказу.'}</p>
      <section class="panel info-panel"><dl><div><dt>Адрес офиса</dt><dd>Пермь, ул. Екатерининская, 10</dd></div><div><dt>Телефон</dt><dd><a class="text-link" href="tel:+73422155898">${site.phone}</a></dd></div><div><dt>Электронная почта</dt><dd><a class="text-link" href="mailto:${site.email}">${site.email}</a></dd></div></dl><div class="actions"><a class="btn" href="tel:+73422155898">Позвонить</a><a class="btn secondary" href="https://yandex.ru/maps/?text=${encodeURIComponent('Пермь, Екатерининская улица, 10')}">Открыть на карте</a></div></section>`);
  }
  if (key==='projects') {
    const project = site.projects.find(p=>p.id===id);
    if (project) return page(project.name,`<section class="project-feature section">${photo('./assets/'+project.image,project.name)}<div><h2>Офисная комплектация</h2><p>Для похожего пространства подберём мебель по планировке и числу рабочих мест.</p><a class="btn" href="#/project">Рассчитать комплектацию</a></div></section>`,[['Проекты','#/projects']]);
    return page('Выполненные проекты',`<div class="category-grid four section">${site.projects.map(projectCard).join('')}</div><a class="btn" href="#/project">Обсудить ваш проект</a>`);
  }
  return page('Страница не найдена','<p class="intro"><a class="text-link" href="#/">Вернуться на главную</a></p>');
}

function getRoute() {
  const [route, args] = location.hash.replace(/^#\/?/,'').split('?');
  const [key,id] = route.split('/');
  return {key,id,args:new URLSearchParams(args)};
}

async function render(move = false) {
  const current = ++revision;
  const {key,id,args} = getRoute();

  document.querySelectorAll('[data-nav]').forEach(a=> a.dataset.nav===key ? a.setAttribute('aria-current','page'):a.removeAttribute('aria-current'));
  if (key === 'catalog' || key === 'product' || key === 'project') {
    if (!catalog) main.innerHTML = '<p class="shell page" role="status">Загрузка каталога…</p>';
    await loadCatalog;
  }
  if (current!==revision) return;
  if (!key || key==='main') main.innerHTML=home();
  else if (key==='catalog') {catalogOrigin=location.hash;main.innerHTML=catalogPage(args);}
  else if (key==='project') {
    main.innerHTML=projectPage(productById.get(Number(args.get('product'))));
    updateEstimate(4);
  } else if (key==='product' && productById.has(Number(id))) {
    const p = productById.get(Number(id));
    const data = await site.getDetails(p.id).catch(()=>null);
    if (current!==revision) return;
    main.innerHTML=itemPage(p,data);
  } else if (key==='cart') main.innerHTML=cartPage();
  else if (key==='checkout') main.innerHTML=checkoutPage();
  else main.innerHTML=infoPage(key,id);
  if (move) {
    main.focus({preventScroll:true});
    window.scrollTo(0,positions.get(location.hash) || 0);
  }
  const heading = main.querySelector('h1')?.textContent;
  document.title = heading ? heading + ' — Гранд-Офис' : 'Гранд-Офис';
}

function downloadSpec() {
  const qty = Number(document.querySelector('#set-count').value);
  const body = ['Комплект рабочих мест — Гранд-Офис','Количество мест: '+qty,
    ...series().map(p=>p.name+' — '+qty+' шт. — '+money(p.price,p.max)),
    'Срок, стоимость доставки и сборки уточняются при расчёте.', site.email].join('\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF',body],{type:'text/plain;charset=utf-8'}));
  const link=document.createElement('a'); link.href=url;link.download='Комплект Гранд-Офис.txt';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}

main.addEventListener('click', async (event)=>{
  const control=event.target.closest('button');
  if (!control) return;
  const {photo, add, remove, scroll} = control.dataset;
  if (photo) main.querySelector('.gallery img').src=photo;
  if (scroll) document.getElementById(scroll)?.scrollIntoView({block:'start'});
  if (control.hasAttribute('data-save-spec')) downloadSpec();
  if (remove!==undefined) { cart.splice(Number(remove),1);saveCart();render(); }
  if (!add) return;
  const item = productById.get(Number(add));
  const choice = Number(document.querySelector('#product-option')?.value || 0);
  const data = await site.getDetails(item.id).catch(()=>null);
  const option = data?.[2]?.find(o=>o[0]===choice);
  const key = item.id + ':' + choice;
  const row=cart.find(r=>r.key===key);
  const cap = option?.[3] ?? (hasBackend && !data?.[2]?.length ? data?.[5] : null) ?? 999;
  if (!cap) return;
  if (row) row.qty=Math.min(cap,999,row.qty+1);
  else cart.push({key,id:item.id,choice,variant:option?.[1],name:item.name,sku:item.sku,image:item.image,price:priceOf(item,option),qty:1,cap});
  saveCart();
  const result=main.querySelector('#cart-result');
  if (result) { result.hidden=false;result.innerHTML='Товар добавлен. <a class="text-link" href="#/cart">Открыть корзину</a>'; }
});
main.addEventListener('change',event=>{
  const element=event.target;
  if (element.id==='set-count') {
    updateEstimate(Number(element.value));
    main.querySelector('[name="seats"]').value=element.value;
  }
  if (element.id==='product-option') {
    const choice=Number(element.value);
    site.save('selected-'+element.dataset.id,choice);
    render().then(()=>document.querySelector('#product-option')?.focus());
  }
  if ('qty' in element.dataset) {
    const selected=cart[Number(element.dataset.qty)];
    selected.qty=Math.max(1,Math.min(selected.cap || 999,Math.trunc(element.valueAsNumber)||1));
    saveCart();render();
  }
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
  else lines.push('Рабочих мест: '+data.seats,'Дата: '+(data.date||'уточняется'),'Задача: '+(data.task||'уточняется'), data.product?'Товар: '+data.product:'');
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
  if (form.dataset.product) data.product=productById.get(Number(form.dataset.product))?.name || '';
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
    const receipt=await site.post('requests',{kind,token:form.dataset.token,...data,lines:kind==='order'?cart.map(({id,choice,qty})=>({id,choice,qty})):[]});
    status.textContent=(kind==='order'?'Заказ № ':'Заявка № ')+receipt.id+' принята. Менеджер свяжется с вами для подтверждения.';
    if (kind==='order') {cart=[];saveCart();}
    form.reset();
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
  city=cityInput.value.trim();site.save('city',city);document.querySelector('#city-name').textContent=city;render();
});
document.querySelector('#city-name').textContent=city;
saveCart();
const loadCatalog=site.catalog.then(data=>{catalog=data;prepare(data);});
site.backend.then(value=>{if(value){hasBackend=true;if(['project','checkout'].includes(getRoute().key)) render();}});
window.addEventListener('hashchange',()=>{
  if (location.hash==='#main') return;
  positions.set(previousRoute,window.scrollY);
  previousRoute=location.hash;
  render(true);
});
render();
