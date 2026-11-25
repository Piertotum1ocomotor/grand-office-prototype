'use strict';

const { escape: e, normalize, money, format } = site;
const main = document.querySelector('#main');
const pathRouting = document.documentElement.hasAttribute('data-route');
let catalog;
let catalogItems;
let catalogFacts;
let correctedParts;
let finishVocabulary;
let chairSeriesGroups = [];
const chairSeriesByKey = new Map();
let officeConfig = {};
const seatPresets = [1,4,8];
let hasBackend = false;
let city = site.session('city', 'Пермь');
let cart = site.session('basket', []);
if (!Array.isArray(cart)) cart = [];
let revision = 0;
const pageSize = 24;
const catalogPagesPerFile = 8;
const smallCatalogBucket = 32;
const positions = new Map();
const chairBrandAliases = {Chairman:'Чаирман',Riva:'Рива',Norden:'Норден'};
let previousRoute = currentRoute();
let pendingCatalogScroll;
if ('scrollRestoration' in history) history.scrollRestoration='manual';

async function loadCatalogFacts() {
  if (catalogFacts) return;
  catalogFacts = await site.getCatalogFacts();
  correctedParts = new Set(catalogFacts.parts);
  finishVocabulary = new Map(catalogFacts.finishes.map(label=>[searchWords(label).join(' '),label]));
  chairSeriesGroups = Object.entries(catalogFacts.chairSeries || {}).map(([brand,models])=>({
    id:brand,
    name:brand,
    items:Object.entries(models).map(([model,ids])=>{
      const name = brand+' '+model;
      const alias = chairBrandAliases[brand];
      const category = {name,slug:name,id:name,searchName:alias ? name+' / '+alias+' '+model : name};
      chairSeriesByKey.set(name,{category,ids:new Set(ids)});
      return {category};
    })
  }));
}
const catalogDimensions = (id, dimensions) => catalogFacts && Object.hasOwn(catalogFacts.dimensions,id) ?
  catalogFacts.dimensions[id] : dimensions;
const catalogKind = (id, kind) => correctedParts?.has(id) ? 'parts' : kind;
const needsDimensionCheck = item => catalogFacts && Object.hasOwn(catalogFacts.dimensions,item.id) &&
  (!item.dimensions || item.dimensions.some(value=>value==null));
const finishesFor = id => (catalogFacts?.productFinishes[id] || []).map(index=>catalogFacts.finishes[index]);
const finishKey = value => normalize(value).trim().replace(/\s*\/\s*/g,'/').replace(/\s+/g,' ');

let finishSwatches = {};
let swatchColumns=0, swatchRows=0;
let swatchRequest;
function loadFinishSwatches() {
  swatchRequest ??= fetch('./data/finish-swatches.json').then(response=>{
    if (!response.ok) throw new Error('Образцы отделок недоступны');
    return response.json();
  }).then(({columns,rows,samples})=>{
    if (!Number.isSafeInteger(columns) || columns<2 || !Number.isSafeInteger(rows) || rows<2 ||
        !samples || typeof samples!=='object' || Array.isArray(samples)) throw new Error('Некорректные образцы отделок');
    swatchColumns=columns;
    swatchRows=rows;
    finishSwatches=samples;
  }).catch(()=>{swatchRequest=undefined;});
  return swatchRequest;
}

const fromProduct = ([id, name, sku, price, max, image, categories, stock, backorder, url, type, dimensions, kind]) => (
  {id, name, sku, price, max, image, categories, stock, backorder, url, type,
    dimensions:catalogDimensions(id,dimensions),kind:catalogKind(id,kind)}
);
const fromBrowse = ([id,name,sku,price,max,image,categories,backorder,type,dimensions,kind]) => (
  {id,name,sku,price,max,image:image ? site.original+'/wp-content/uploads/'+image : '',categories,backorder,type,
    dimensions:catalogDimensions(id,dimensions),kind:catalogKind(id,kind)}
);
const crumbs = (links) => '<nav class="breadcrumb" aria-label="Хлебные крошки"><a href="#/">Главная</a>' +
  links.map(([name, href]) => '<span aria-hidden="true">/</span>' +
    (href ? '<a href="' + e(href) + '">' + e(name) + '</a>' : '<span aria-current="page">' + e(name) + '</span>')).join('') + '</nav>';
const page = (title, body, levels = []) => '<div class="shell page">' + crumbs([...levels,[title]]) + '<h1>' + e(title) + '</h1>' + body + '</div>';
const photo = (src, alt = '', extra = '') => src ? '<img src="' + e(src) + '" alt="' + e(alt) + '" ' + extra + '>' : '<div class="no-photo" aria-label="Фото отсутствует">Гранд-Офис</div>';
const dimensionPattern = /(?<!\d)\d{2,4}\s*[×xх*]\s*\d{2,4}\s*[×xх*]\s*\d{2,4}(?!\d)/i;
const dimensionsLabel = (dims) => dims?.[0] && dims[1] ? dims.filter(Boolean).join(' × ') + ' мм' : (dims?.[0] ? 'Ширина ' + dims[0] + ' мм' : '');
const productTitle = (name) => name.replace(dimensionPattern,'').trim().replace(/[,(–-]+$/,'').trim() || name;
function finishSample(label) {
  const key=finishKey(label);
  const sample=Object.hasOwn(finishSwatches,key) ? finishSwatches[key] : null;
  if (Array.isArray(sample) && sample.length===2) {
    const [column,row]=sample;
    if (Number.isSafeInteger(column) && column>=0 && column<swatchColumns && Number.isSafeInteger(row) && row>=0 && row<swatchRows) {
      const size=swatchColumns*100+'% '+swatchRows*100+'%';
      const position=column/(swatchColumns-1)*100+'% '+row/(swatchRows-1)*100+'%';
      return '<span class="finish-sample finish-sample-image" aria-hidden="true" style="background-size:'+size+';background-position:'+position+'"></span>';
    }
  }
  return '<span class="finish-sample finish-sample-neutral" aria-hidden="true"></span>';
}

function finishSwatchButton([value,label], selected) {
  return '<button class="finish-swatch'+(value===''?' finish-default':'')+'" type="button" data-finish-value="'+e(value)+
    '" data-finish-label="'+e(label)+'" aria-label="'+e(label)+'" aria-pressed="'+(value===selected)+'">'+
    (value===''?e(label):finishSample(label))+'</button>';
}

function finishSwatchList(options, selected, limit) {
  const displayed=options.slice(0,limit);
  const hidden=options.slice(limit);
  if (hidden.some(([value])=>value===selected)) {
    const index=hidden.findIndex(([value])=>value===selected);
    [displayed[limit-1],hidden[index]]=[hidden[index],displayed[limit-1]];
  }
  const buttons=items=>items.map(option=>finishSwatchButton(option,selected)).join('');
  return '<div class="finish-options">'+buttons(displayed)+(hidden.length?
    '<details class="finish-more"><summary>Ещё '+hidden.length+'</summary><div class="finish-options">'+buttons(hidden)+'</div></details>':'')+'</div>';
}

function finishPreview(labels) {
  if (!labels.length) return '';
  const options=labels.map((label,index)=>[String(index),label]);
  return '<div class="finish-field finish-preview" role="group" aria-label="Отделки">'+
    finishSwatchList(options,null,4)+'<p class="finish-name" aria-hidden="true"></p></div>';
}

function finishField(id, title, placeholder, items, value, attributes='') {
  const options=items.map(([key,label])=>[String(key),label]);
  if (placeholder!==null) options.unshift(['',placeholder]);
  const selected=options.find(([key])=>key===String(value)) || options[0];
  return '<div class="finish-field" role="group" aria-labelledby="'+id+'-label"><span class="field-label" id="'+id+'-label">'+e(title)+'</span>'+
    '<select id="'+id+'" '+attributes+' hidden>'+options.map(([key,label])=>'<option value="'+e(key)+'"'+
    (key===selected[0]?' selected':'')+'>'+e(label)+'</option>').join('')+'</select>'+
    finishSwatchList(options,selected[0],8)+'<p class="finish-name" aria-hidden="true">'+e(selected[0]?selected[1]:'')+'</p></div>';
}

const cardPhoto = image => photo(image,'','loading="lazy" width="380" height="235"');
const card = (item, origin) => {
  const title = productTitle(item.name);
  const price = money(item.price,item.max);
  const values = [item.kind==='parts'?'Комплектующая':item.kind==='modules'?'Модуль':'',item.sku ? 'Арт. '+item.sku : '',
    dimensionsLabel(item.dimensions),needsDimensionCheck(item)?'Габариты уточняются':''].filter(Boolean);
  const link = '#/product/'+item.id+'?from='+encodeURIComponent(origin);
  return `<article class="product" data-product-id="${item.id}"><a class="product-photo" href="${e(link)}" aria-label="${e(title)}" data-base-photo="${e(item.image || '')}">${cardPhoto(item.image)}</a><div class="product-card"><h3><a href="${e(link)}" title="${e(title)}">${e(title)}</a></h3><p class="meta">${e(values.join(' · '))}</p>${finishPreview(finishesFor(item.id))}<p class="price" data-base-price="${e(price)}">${price}</p><p class="small">${item.backorder ? 'Под заказ' : 'Наличие уточняется'}</p><p class="sr-only" role="status" data-product-preview-status></p></div></article>`;
};
const departmentLink = ([, , category]) => catalogLink('',category==='chairs' ? {t:category} : {c:category});
const categoryTile = (name, image, href) =>
  `<a class="category" href="${e(href)}">${photo(image,'','loading="lazy"')}<span>${e(name)}</span></a>`;
const categoryCard = department => categoryTile(department[0],'./assets/original-home/'+department[1],departmentLink(department));

function projectShowcase(excluded) {
  return `<div class="project-carousel"><ul class="project-track" tabindex="0" aria-label="Проекты Гранд-Офиса">${site.projects.filter(project=>project.id!==excluded).map(project=>`<li><a class="project-tile" href="#/projects/${project.id}">${photo('./assets/'+project.image,project.zone,'loading="lazy" width="656" height="505"')}<div><h3>${e(project.name)}</h3><p>${e(project.zone)}</p></div></a></li>`).join('')}</ul>
  <div class="actions carousel-buttons"><button class="btn secondary" data-projects="-1" aria-label="Предыдущий проект">Назад</button><button class="btn secondary" data-projects="1" aria-label="Следующий проект">Далее</button></div></div>`;
}

function projectSection(title = 'Выполненные проекты') {
  return `<section class="section"><div class="section-head"><h2>${e(title)}</h2><a class="text-link" href="#/projects">Все проекты</a></div>${projectShowcase()}</section>`;
}

function serviceFacts() {
  const rates = officeConfig.localRates;
  if (!rates) return '';
  return `<dl class="service-facts"><div><dt>Доставка по Перми</dt><dd>от ${format(rates.deliveryFrom)}</dd><dd class="fact-description">Подтвердим по адресу и объёму заказа.</dd></div>
    <div><dt>Подъём</dt><dd>от ${format(rates.liftFromPerFloor)} за этаж</dd><dd class="fact-description">Зависит от лифта, габаритов и этажа.</dd></div>
    <div><dt>Стандартная сборка</dt><dd>${rates.assemblyPercent}%</dd><dd class="fact-description">От стоимости мебели. Дату согласуем.</dd></div></dl>`;
}

const officeQuote = '#/project?section=form';
const officeBrief = 'Укажите размеры помещения, число рабочих мест и желаемую дату готовности.';

const companyBenefits = [
  ['Более 15 лет','опыта команды'],
  ['Более 500','выполненных проектов'],
  ['Дизайн-проект','бесплатно по плану помещения'],
  ['До двух лет','гарантии в зависимости от модели']
];
const companyFigures = [
  ['Более 15 лет','опыта команды на рынке'],
  ['Более 30','контрактов с фабриками России и Европы'],
  ['Более 500','реализованных проектов'],
  ['Более 100 000 м²','оборудованных помещений']
];
const projectStages = [
  ['Консультация','Уточняем задачи, бюджет, число рабочих мест и сроки переезда.'],
  ['Замер и планировка','Изучаем план помещения, при необходимости выезжаем на замер. Предлагаем варианты зонирования и расстановки.'],
  ['Подбор и смета','Подбираем серии, модели и отделку. Готовим коммерческое предложение с ценами и сроками.'],
  ['Договор и предоплата','Согласуем условия оплаты и фиксируем сроки поставки в договоре.'],
  ['Доставка и монтаж','Привозим, собираем и расставляем мебель по согласованному плану.'],
  ['Сервис','Помогаем с гарантийными обращениями, обслуживанием и доукомплектацией офиса.']
];
const informationCards = rows => rows.map(([title,copy])=>'<div><h3>'+e(title)+'</h3><p>'+e(copy)+'</p></div>').join('');

function home() {
  return `<div class="shell">
    <section class="hero home-hero" aria-labelledby="home-title">
      <div class="hero-copy"><div class="home-hero-title"><p class="eyebrow">Офисная мебель в Перми</p><h1 id="home-title">Проектируем логику пространства</h1>
      <p>Спланируем офис, подберём мебель, подготовим смету, доставим и соберём.</p></div>
      <div class="actions"><a class="btn" href="${officeQuote}">Запросить расчёт офиса</a><a class="btn secondary" href="#/catalog">Перейти в каталог</a></div></div>
      <div class="hero-photo">${photo('./assets/original-home/hero.webp','Кабинет с деревянным столом и терракотовыми креслами','width="1536" height="1024" fetchpriority="high"')}</div>
    </section>
    <section class="section"><div class="section-head"><h2>Мебель для офиса</h2><a class="text-link" href="#/catalog">Весь каталог</a></div>
      <div class="actions home-types"><a class="chip home-collections-chip" href="#/catalog?view=collections">Все коллекции</a><a class="chip" href="#/catalog?t=tables">Столы</a><a class="chip" href="#/catalog?t=chairs">Кресла и стулья</a><a class="chip" href="#/catalog?t=cabinets">Шкафы</a><a class="chip" href="#/catalog?t=pedestals">Тумбы</a><a class="chip" href="#/catalog?t=shelving">Стеллажи</a></div>
      <div class="category-grid department-tiles">${catalogDepartments.map(categoryCard).join('')}</div></section>
    <section class="project-feature kit-hero">${photo('./assets/riva-interior.webp','Пример рабочих мест с мебелью Riva в интерьере','loading="lazy" width="900" height="720"')}
      <div><p class="eyebrow">Серия Riva</p><h2>Соберите рабочие места</h2>
        <p>Выберите столы, кресла и тумбы. Посмотрите цену каждой позиции и попробуйте расставить мебель по размерам комнаты.</p>
        <div class="actions"><a class="btn" href="#/project?section=kit">Собрать комплект</a><a class="btn secondary" href="#/planner">Открыть планировщик</a></div></div>
    </section>
    ${projectSection('Наши проекты')}
    <section class="section"><div class="section-head"><h2>Доставка и сборка</h2><a class="text-link" href="#/delivery">Сроки и условия</a></div>${serviceFacts()}</section>
    <section class="section home-company" aria-labelledby="home-company-title">
      <div class="home-company-copy"><p class="eyebrow">О компании</p><h2 id="home-company-title">Комплектуем офисы под ключ</h2>
        <p class="home-company-intro">«Гранд-Офис» работает с 2019 года. Готовим план расстановки и смету, подбираем мебель по бюджету, доставляем и собираем её по плану.</p>
        <dl class="home-company-facts">${companyBenefits.map(([value,label])=>'<div><dt>'+e(value)+'</dt><dd>'+e(label)+'</dd></div>').join('')}</dl>
        <a class="text-link" href="#/about">Подробнее о компании</a></div>
      <figure class="home-company-photo">${photo('./assets/company.webp','Офис «Гранд-Офис» на Екатерининской, 10','loading="lazy" width="1158" height="850"')}</figure>
    </section>
    </div>`;
}

const catById = new Map();
const catBySlug = new Map();
const catChildren = new Map();
const productById = new Map();
const productDetails = new Map();
const collectionsById = new Map();
let collectionSections = [];
let collectionDirectoryReady = false;
let collectionDirectoryError = false;
function prepareCategories(categories) {
  categories.forEach((c) => {
    catById.set(c.id,c);
    if (c.slug) catBySlug.set(c.slug,c);
    if (!catChildren.has(c.parent)) catChildren.set(c.parent,[]);
    catChildren.get(c.parent).push(c);
  });
}

function collectionCategory(category) {
  for (let depth=0; category && depth<12; depth++) {
    if (collectionsById.has(category.id)) return category;
    category = catById.get(category.parent);
  }
  return null;
}

function collectionForProduct(item, preferred) {
  if (preferred && matchesCategory(item,preferred)) return preferred;
  const memberships = new Set(item.categories.map(id=>collectionCategory(catById.get(id))?.id));
  for (const id of collectionsById.keys()) if (memberships.has(id)) return catById.get(id);
  return null;
}

function categoryRoot(cat) {
  let item = cat;
  for (let i=0; i<12 && item?.parent && catById.has(item.parent); i++) item = catById.get(item.parent);
  return item;
}
function matchesCategory(item, chosen) {
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
const searchSizePattern = /(?<![\d.,])(\d{1,4}(?:[.,]\d+)?)\s*[×xх*]\s*(\d{1,4}(?:[.,]\d+)?)(?:\s*[×xх*]\s*(\d{1,4}(?:[.,]\d+)?))?(?:\s*(мм|mm|см|cm)(?![\p{L}\d]))?(?![\d.,])/iu;
const searchWords = text => normalize(text).match(/[\p{L}\p{N}]+/gu) || [];
function searchInputParts(query) {
  const match = query.match(searchSizePattern);
  const multiplier = /^(?:см|cm)$/i.test(match?.[4] || '') ? 10 : 1;
  const size = match?.slice(1,4).filter(Boolean).map(value=>Math.round(Number(value.replace(',','.'))*multiplier));
  const words = searchWords(query.replace(searchSizePattern,' '));
  const types = new Set();
  const terms = [];
  for (const [i,word] of words.entries()) {
    const key = Object.keys(productTypes).find(type=>productTypes[type][1].test(word));
    if (key) types.add(key);
    else if (!/^(?:с|со|в|из|на|для)$/.test(word) || word==='с' && words[i-1]==='нова') terms.push(word);
  }
  const officeTable = types.size===1 && types.has('tables') && words.some(word=>/^офисн[а-я]*$/.test(word));
  return {types,size,officeTable,terms:terms.filter(word=>!types.size || !/^офисн[а-я]*$/.test(word))};
}

const skuText = text => String(text || '').normalize('NFKC').trim().toLocaleLowerCase('ru')
  .replace(/^арт(?:икул)?[.\s]+/u,'');
const skuKey = text => foldLookalikes(skuText(text)).replace(/[\s./_\p{Dash_Punctuation}]+/gu,'');
const skuQueryPattern = /^[\p{L}\d][\p{L}\d\s./_\p{Dash_Punctuation}]*$/u;
const looksLikeSku = text => text.length<=120 && /\d/.test(text) && skuQueryPattern.test(text) &&
  !searchSizePattern.test(text) && !/\p{L}{4,}\s|\s\p{L}{4,}/u.test(text);
const modelCodePattern = /(?<![\p{L}\p{N}])[\p{L}][\p{L}\d]*(?:[./_\p{Dash_Punctuation}][\p{L}\d]+)*(?![\p{L}\p{N}])/gu;
let skuIndex;
let lastProductSearch;

function productSkuIndex() {
  if (skuIndex?.items===catalogItems) return skuIndex;
  const literal = new Map(), codes = new Map();
  function add(index,key,item) {
    if (!index.has(key)) index.set(key,[]);
    const items=index.get(key);
    if (items.at(-1)!==item) items.push(item);
  }
  for (const item of catalogItems) {
    if (item.sku) {
      add(literal,skuText(item.sku),item);
      add(codes,skuKey(item.sku),item);
    }
    const title = item.name.replace(searchSizePattern,' ');
    for (const token of title.match(modelCodePattern) || []) {
      if (/\d/.test(token) && token.length>=3 && token.length<=32) add(codes,skuKey(token),item);
    }
  }
  return skuIndex={items:catalogItems,literal,codes};
}

function skuDistance(first, second, limit) {
  if (Math.abs(first.length-second.length)>limit) return limit+1;
  let previous = Array.from({length:second.length+1},(_,i)=>i);
  let beforePrevious;
  for (let i=1;i<=first.length;i++) {
    const row=[i];
    for (let j=1;j<=second.length;j++) {
      row[j]=Math.min(previous[j]+1,row[j-1]+1,previous[j-1]+Number(first[i-1]!==second[j-1]));
      if (i>1 && j>1 && first[i-1]===second[j-2] && first[i-2]===second[j-1])
        row[j]=Math.min(row[j],beforePrevious[j-2]+1);
    }
    if (Math.min(...row)>limit) return limit+1;
    beforePrevious=previous;
    previous=row;
  }
  return previous.at(-1);
}

function searchBySku(text) {
  if (!looksLikeSku(text)) return null;
  const {literal,codes}=productSkuIndex();
  const key=skuKey(text);
  const exact=literal.get(text) || codes.get(key);
  if (exact) return {items:exact,exact:true,types:new Set()};
  const numeric=/^\d+$/.test(key);
  if (key.length<(numeric?5:4) || key.length>32) return null;
  const limit = key.length>=9 ? 2 : key.length>=5 ? 1 : 0;
  const candidates=[];
  for (const [code,items] of codes) {
    if (numeric!==/^\d+$/.test(code)) continue;
    const prefix = code.startsWith(key) && code.length-key.length<=4;
    const distance = limit ? skuDistance(key,code,limit) : Infinity;
    if (prefix || distance<=limit) candidates.push({code,items,prefix,distance});
  }
  candidates.sort((a,b)=>Number(b.prefix)-Number(a.prefix) || a.distance-b.distance ||
    Math.abs(a.code.length-key.length)-Math.abs(b.code.length-key.length) || a.code.localeCompare(b.code,'ru'));
  const items=[...new Set(candidates.flatMap(candidate=>candidate.items))];
  return items.length ? {items,similar:true,types:new Set()} : null;
}

function searchProducts(query) {
  if (lastProductSearch?.query===query && lastProductSearch.index===catalogItems) return lastProductSearch.result;
  const result=searchBySku(skuText(query)) || searchByProductName(query);
  lastProductSearch={query,index:catalogItems,result};
  return result;
}

function searchByProductName(query) {
  const {types,terms,size,officeTable} = searchInputParts(normalize(query).trim());
  const keys = terms.map(word=>/^сетк(?:а|ой|у|е|и)$/.test(word)?'сетк':word);
  const items = catalogItems.filter(entry=>{
    if (types.size && !types.has(entry.type)) return false;
    if (officeTable && !matchesTablePurpose(entry,'work')) return false;
    if (size && !size.every((value,i)=>entry.dimensions?.[i]===value)) return false;
    if (!keys.length) return true;
    const searchable = searchWords(entry.name+' '+entry.sku);
    return keys.every(word=>searchable.some(token=>token.startsWith(word)));
  });
  return {items,types};
}

const catalogNumber = new Intl.NumberFormat('ru-RU');
const partLabels = {furniture:'Готовая мебель',modules:'Модули',parts:'Комплектующие'};
const tablePurposes = {work:'Рабочие',meeting:'Для переговоров',coffee:'Журнальные'};
const chairPurposes = {operator:'Для персонала',executive:'Для руководителя',guest:'Для посетителей',gaming:'Игровые'};
const tableShapes = {straight:'Прямые',corner:'Угловые',round:'Круглые',oval:'Овальные'};
const allPurposes={...tablePurposes,...chairPurposes};
const catalogRanges=[
  {label:'Цена',unit:'₽',low:'min',high:'max',limit:100000000,step:.01},
  {label:'Ширина',unit:'мм',low:'wmin',high:'w',limit:10000,dimension:0},
  {label:'Глубина',unit:'мм',low:'dmin',high:'d',limit:10000,dimension:1},
  {label:'Высота',unit:'мм',low:'hmin',high:'h',limit:10000,dimension:2}
];
const rangeFields=catalogRanges.flatMap(({low,high})=>[low,high]);
const dimensionFields=rangeFields.slice(2);
const filterFields=[...rangeFields,'use','shape','k','series','chairSeries','finish','unknown'];

function catalogBound(raw,range) {
  if (raw==null || !String(raw).trim()) return null;
  const value=Number(raw);
  return Number.isFinite(value) && value>=0 && value<=range.limit && (range.step || Number.isInteger(value)) ? value : null;
}

function getCatalogRanges(settings) {
  return catalogRanges.map(range=>({...range,min:catalogBound(settings.get(range.low),range),max:catalogBound(settings.get(range.high),range)}));
}

const hasBounds=range=>range.min!=null || range.max!=null;
const inRange=(value,{min,max})=>value!=null && (min==null || value>=min) && (max==null || value<=max);
function matchesTablePurpose(item, purpose) {
  if (item.type!=='tables') return false;
  const name=normalize(item.name);
  if (purpose==='work') return !/журнальн|переговор|конференц|туалетн|приставн|подставн|обеденн|сервировочн|теннисн/.test(name);
  if (purpose==='meeting') return /переговор|конференц/.test(name);
  return /журнальн/.test(name);
}
const chairCategories={
  operator:['kresla-dlya-personala'],
  executive:['kresla-dlya-rukovoditelya'],
  guest:['konferencz-kresla','ofisnye-stulya'],
  gaming:['igrovye-kresla']
};
const chairNames={operator:/для персонала|операторск/,executive:/для руководител|руководительск/,guest:/для посетител|конференц/,gaming:/игров|геймер/};
function matchesPurpose(item,purpose) {
  if (Object.hasOwn(tablePurposes,purpose)) return matchesTablePurpose(item,purpose);
  return item.type==='chairs' && (chairNames[purpose].test(normalize(item.name)) ||
    item.categories.some(id=>chairCategories[purpose].includes(categoryRoot(catById.get(id))?.slug)));
}

function matchesTableShape(item,shape) {
  if (item.type!=='tables' || item.kind!=='furniture') return false;
  const name=normalize(item.name).split(/\s+(?:с|со|на)\s+(?:тумб|опор|полк|ножк|экран)/,1)[0];
  const shapes={straight:/\b(?:straight)\b|прям(?:ой|оугольн|ые)/,corner:/углов|г-образн/,round:/кругл/,oval:/овал/};
  if (shape==='straight' && /углов|г-образн|кругл|овал/.test(name)) return false;
  return shapes[shape].test(name);
}

function matchesSeries(item,term) {
  if (!term || normalize(item.name).includes(term)) return true;
  return item.categories.some(id=>{
    let category=catById.get(id);
    for (let level=0;category && level<12;level++) {
      if (normalize(category.name).includes(term)) return true;
      category=catById.get(category.parent);
    }
    return false;
  });
}
const selectedCategory = (key) => catBySlug.get(key) || catById.get(Number(key));
const selectedSeries = key => collectionCategory(selectedCategory(key));
const scopeTypes = category => !category ? Object.keys(productTypes) : catalogFacts?.categoryTypes ?
  catalogFacts.categoryTypes[category.id] || [] : collectionsById.get(category.id)?.types || Object.keys(productTypes);
const catalogLink = (settings, patch = {}) => {
  const values = new URLSearchParams(settings);
  for (const [key,value] of Object.entries(patch)) if (value) values.set(key,value); else values.delete(key);
  return '#/catalog' + (values.size ? '?' + values : '');
};
function catalogSettings(args) {
  const settings = new URLSearchParams(args);
  const legacy = settings.get('c');
  if (Object.hasOwn(productTypes,legacy)) {
    if (!settings.has('t')) settings.set('t',legacy);
    settings.delete('c');
  }
  if (settings.get('t')!=='chairs' || settings.has('c') || settings.has('series')) settings.delete('chairSeries');
  if (!getCatalogRanges(settings).slice(1).some(hasBounds)) settings.delete('unknown');
  return settings;
}

const categoryPatch=(entry)=>({c:entry.slug || entry.id,t:null,use:null,shape:null,k:null,series:null,chairSeries:null,finish:null,view:null,p:null,cp:null,cq:null,pick:null});
function categoryItems(entries, selected, settings) {
  const path = new Set();
  for (let item=selected; item && !path.has(item.id); item=catById.get(item.parent)) path.add(item.id);
  function link(entry,title=entry.name) {
    return '<a href="'+e(catalogLink(settings,categoryPatch(entry)))+'" '+(entry.id===selected?.id?'aria-current="page"':'')+'>'+e(title)+'</a>';
  }
  return entries.filter(entry=>!entry.empty || path.has(entry.id)).map(entry=>{
    const children = (catChildren.get(entry.id) || []).filter(child=>!child.empty || path.has(child.id));
    if (!children?.length) return link(entry);
    const open = path.has(entry.id);
    return '<details data-category="'+entry.id+'" '+(open?'open':'')+'><summary>'+e(entry.name)+'</summary><div>'+
      link(entry,'Все в разделе')+(open?categoryItems(children,selected,settings):'')+'</div></details>';
  }).join('');
}

function catalogResults(settings,{selected,type,part,query,series,seriesCategory,chairSeries,purpose,shape,ranges}) {
  const search = searchProducts(query);
  const [priceBounds,...sizeBounds]=ranges;
  const dimensions=sizeBounds.filter(hasBounds);
  const seriesTerm=normalize(series.trim());
  const includeUnknown=settings.get('unknown')==='1';
  const finish=settings.get('finish');
  const known=[],missing=[];
  for (const entry of search.items) {
    if (!matchesCategory(entry,selected) || (type && entry.type!==type)) continue;
    if (chairSeries && !chairSeries.ids.has(entry.id)) continue;
    if (part && entry.kind!==part) continue;
    if (purpose && !matchesPurpose(entry,purpose)) continue;
    if (shape && !matchesTableShape(entry,shape)) continue;
    if (!part && !search.exact && (type || search.types.size || purpose || shape) && entry.kind!=='furniture') continue;
    if (hasBounds(priceBounds) && !inRange(entry.price,priceBounds)) continue;
    if (seriesCategory ? !matchesCategory(entry,seriesCategory) : !matchesSeries(entry,seriesTerm)) continue;
    if (finish && !finishesFor(entry.id).includes(finish)) continue;
    if (dimensions.some(range=>entry.dimensions?.[range.dimension]>0 && !inRange(entry.dimensions[range.dimension],range))) continue;
    const incomplete=dimensions.some(range=>!(entry.dimensions?.[range.dimension]>0));
    if (!incomplete) known.push(entry);
    else if (includeUnknown) missing.push(entry);
  }
  const sort = settings.get('sort');
  const byPrice = sort==='up' ? (a,b)=>(a.price ?? Infinity)-(b.price ?? Infinity)
    : sort==='down' ? (a,b)=>(b.price ?? -1)-(a.price ?? -1) : ()=>0;
  const kindOrder = {furniture:0,modules:1,parts:2};
  const order = (a,b)=>kindOrder[a.kind]-kindOrder[b.kind] || byPrice(a,b);
  const results=[...known.sort(order),...missing.sort(order)];
  return search.similar ? results.slice(0,16) : results;
}

function catalogRangeFields(range) {
  const label=range.label+', '+range.unit;
  const field=(name,caption,value)=>'<label><span>'+caption+'</span><input class="field" type="number" name="'+name+
    '" aria-label="'+range.label+' '+caption.toLowerCase()+', '+range.unit+'" min="0" max="'+range.limit+
    '" step="'+(range.step || 1)+'" inputmode="'+(range.step?'decimal':'numeric')+'" value="'+(value ?? '')+'"></label>';
  return '<fieldset class="catalog-range"><legend>'+label+'</legend><div class="range-inputs">'+
    field(range.low,'От',range.min)+field(range.high,'До',range.max)+'</div></fieldset>';
}

function catalogFilterSelect(name,label,choices,value,placeholder) {
  return '<label><span class="field-label">'+label+'</span><select class="field" name="'+name+'"><option value="">'+placeholder+'</option>'+
    Object.entries(choices).map(([key,text])=>'<option value="'+key+'" '+(value===key?'selected':'')+'>'+text+'</option>').join('')+'</select></label>';
}

function collectionScope(category) {
  const section = collectionSections.find(entry=>entry.id===category?.id ||
    entry.groups.some(group=>group.id===category?.id));
  return section || null;
}

function showCollections(settings, category) {
  if (selectedSeries(settings.get('series'))) return false;
  return settings.get('view')==='collections' && !collectionCategory(category) || collectionSections.length>0 && (
    Boolean(collectionScope(category)) && settings.get('view')!=='products' &&
    !['q','t','p','sort',...filterFields].some(key=>settings.get(key)));
}

function collectionNavigation(category) {
  return catalogLink('',category ? {c:category.slug} : {view:'collections'});
}

const catalogDepartments = [
  ['Мебель для руководителей','executive.webp','mebel-v-kabinet-rukovoditelya'],
  ['Мебель для сотрудников','staff.webp','ofisnaya-mebel-dlya-personala'],
  ['Кресла и стулья','chairs.webp','chairs'],
  ['Мебель для приёмной','reception.webp','stojki-resepshn'],
  ['Мебель для переговорных','meeting.webp','mebel-dlya-peregovornyh'],
  ['Зоны отдыха и ожидания','lounge.webp','ofisnye-divany'],
  ['Металлическая мебель и сейфы','metal.webp','metallicheskaya-mebel'],
  ['Специализированная мебель','special.webp','promyshlennaya-mebel'],
  ['Обеденная зона','dining.webp','mebel-dlya-ofisnoj-kuhni']
];

const specialDepartment='promyshlennaya-mebel';
const specialCategories=['mebel-dlya-dispetcherskih','mebel-dlya-gostinicz-i-otelej'];
const chairDepartmentCategories=['kresla-dlya-rukovoditelya','kresla-dlya-personala','ofisnye-stulya','konferencz-kresla','mnogomestnye-sekczii-stulev','igrovye-kresla'];

function departmentSubcategories(slug) {
  if (slug==='chairs') return chairDepartmentCategories.map(selectedCategory).filter(Boolean);
  if (slug===specialDepartment) return specialCategories.map(selectedCategory).filter(Boolean);
  const category = selectedCategory(slug);
  const classes = collectionScope(category)?.groups.filter(group=>group.id!==category?.id).map(group=>catById.get(group.id)) || [];
  const children = (catChildren.get(category?.id) || []).filter(entry=>!entry.empty && !classes.includes(entry));
  if (slug==='metallicheskaya-mebel' && catBySlug.has('sejfy')) children.push(catBySlug.get('sejfy'));
  return [...classes,...children];
}

function showDepartmentIndex(settings) {
  return !['c','view','q','t','p','sort',...filterFields].some(key=>settings.get(key));
}

function catalogDepartmentsPage() {
  const collections = '<a class="catalog-browse-card catalog-entry-card catalog-entry-collections" href="'+e(collectionNavigation())+'">'+
    '<div class="catalog-entry-label"><h2>Коллекции</h2><p>Столы, тумбы и шкафы одной серии.</p><span class="text-link">Смотреть коллекции</span></div>'+
    '<figure class="catalog-entry-cover brand-photo">'+photo('./assets/riva-interior.webp','','width="900" height="720"')+'</figure></a>';
  const types = Object.entries(productTypes).map(([type,[name]])=>
    categoryTile(type==='chairs'?'Кресла и стулья':name,'./assets/catalog/'+type+'.webp',catalogLink('',{t:type}))).join('');
  return page('Каталог',collections+
    '<section class="catalog-entry-departments" aria-labelledby="departments-title">'+
    '<h2 id="departments-title">Мебель по назначению</h2><div class="category-grid department-tiles">'+catalogDepartments.map(categoryCard).join('')+'</div></section>'+
    '<section class="catalog-entry-types" aria-labelledby="catalog-types-title"><div class="section-head"><h2 id="catalog-types-title">Тип мебели</h2>'+
    '<a class="text-link" href="#/catalog?view=products">Все товары</a></div><nav class="category-grid department-tiles catalog-type-tiles" aria-label="Тип мебели">'+types+'</nav></section>');
}

const lookalikeLetters = [...'авсенкмортху'];
const foldLookalikes = text => text.replace(/[авсенкмортху]/g,char=>
  'abcehkmoptxy'[lookalikeLetters.indexOf(char)]);
const collectionSearchKey = value => foldLookalikes(normalize(value)).replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const collectionPrefix = /^(?:офисная мебель|мебель для персонала|кабинеты? руководителя|мебель для гостиниц(?: и отелей)?|офисные перегородки|столы для переговоров|стойк[аи] ресепше?н)\s+/i;
function collectionNameRank(category, query) {
  const name = (category.searchName || category.name).replace(collectionPrefix,'');
  const aliases = name.split(/[\/|]/).map(collectionSearchKey).filter(Boolean);
  const wordCount = value => value.split(' ').length;
  if (aliases.includes(query) && aliases.every(alias=>wordCount(alias)<=wordCount(query))) return 3;
  if (aliases.some(alias=>alias.startsWith(query))) return 2;
  const full = collectionSearchKey(name);
  if (query.split(' ').every(word=>full.split(' ').some(token=>token.startsWith(word)))) return 1;
  return 0;
}

function findCollections(value, section, tier) {
  const query = collectionSearchKey(value.trim().replace(collectionPrefix,''));
  const sections = section ? [section] : collectionSections;
  const rows = sections.flatMap(entry=>entry.groups.filter(group=>!tier || group===tier).flatMap(group=>
    group.items.map(item=>({item,group,section:entry,
      rank:query ? collectionNameRank(catById.get(item.id),query) : 1}))));
  return rows.filter(row=>row.rank).sort((a,b)=>b.rank-a.rank);
}

function collectionSupports(entry, {types,finish}) {
  return (!types.size || scopeTypes(catById.get(entry.item.id)).some(type=>types.has(type))) &&
    (!finish || (catalogFacts?.collectionFinishes[entry.item.id] || []).some(index=>catalogFacts.finishes[index]===finish));
}

function collectionSearch(value) {
  const parts = searchInputParts(value);
  const intent = Boolean(parts.types.size || parts.size);
  const phrase = intent ? parts.terms.join(' ') : value;
  const matches = collectionSearchKey(phrase).length>=2 ? findCollections(phrase).filter(({item})=>
    !parts.types.size || scopeTypes(catById.get(item.id)).some(type=>parts.types.has(type))) : [];
  if (!matches.some(row=>row.rank===3) && finishVocabulary) {
    const words = parts.terms;
    for (let length=words.length-1; length>0; length--) {
      for (let from=0; from+length<=words.length; from++) {
        const finish = finishVocabulary.get(words.slice(from,from+length).join(' '));
        if (!finish) continue;
        const name = [...words.slice(0,from),...words.slice(from+length)].join(' ');
        const options = findCollections(name).filter(entry=>collectionSupports(entry,{...parts,finish}));
        if (options.length) return {value,parts:{...parts,finish},phrase:name,intent:true,matches:options};
      }
    }
  }
  return {value,parts,phrase,intent,matches};
}

function collectionSearchLink(query) {
  return catalogLink('',{view:'collections',cq:query.phrase.slice(0,100),pick:query.intent?query.value:null});
}

function catalogSourceSettings(settings) {
  const source=new URLSearchParams(settings);
  source.delete('back');
  source.delete('backy');
  source.delete('changedfinish');
  return source;
}
function collectionSourceLink(address) {
  if (getRoute().key!=='catalog') return address;
  const settings=catalogSettings(getRoute().args);
  const current=selectedSeries(settings.get('series')) || collectionCategory(selectedCategory(settings.get('c')));
  const source=current ? catalogOrigin(settings.get('back')) : catalogLink(catalogSourceSettings(settings));
  return source ? catalogLink(getRoute(address).args,{back:source,backy:current?settings.get('backy'):String(Math.round(window.scrollY))}) : address;
}
function collectionMatchLink(category, parts) {
  if (!parts) return collectionSourceLink(collectionNavigation(category));
  const type = parts.types.size===1 ? [...parts.types][0] : null;
  const bounds = Object.fromEntries((parts.size || []).flatMap((value,i)=>{
    const range = catalogRanges[i+1];
    return [[range.low,value],[range.high,value]];
  }));
  return collectionSourceLink(catalogLink('',{c:category.slug,t:type,finish:parts.finish,...bounds}));
}

function collectionCard(entry, department, parts, settings) {
  const category = catById.get(entry.id);
  const image = entry.cover ? photo(site.original+'/wp-content/uploads/'+entry.cover,'',
    'loading="lazy" width="300" height="225"') : '';
  const caption = entry.count ? 'Товаров: '+catalogNumber.format(entry.count) : 'Товары уточняются';
  const finishes=(catalogFacts?.collectionFinishes[entry.id] || []).map(index=>catalogFacts.finishes[index]);
  const href=catalogLink(getRoute(collectionMatchLink(category,parts)).args,{back:catalogLink(catalogSourceSettings(settings)),backy:0});
  return '<article class="collection-tile"><a class="collection-tile-link" data-collection-result href="'+e(href)+'">'+image+
    '<div><h3>'+e(category.name.replace(collectionPrefix,''))+'</h3>'+
    (department?'<p class="collection-department">'+e(department)+'</p>':'')+
    '<p class="small">'+e(caption)+'</p></div></a>'+finishPreview(finishes)+'</article>';
}

function collectionOverview(settings, selected) {
  const section = collectionScope(selected);
  const tier = section?.groups.find(group=>group.id===selected?.id && group.id!==section.id);
  const title = tier ? selected.name : section?.name || 'Коллекции';
  const query = (settings.get('cq') || '').trim().slice(0,100);
  const pick = settings.get('pick');
  const parts = pick ? collectionSearch(pick.slice(0,120)).parts : null;
  const rows = findCollections(query,section,tier).filter(entry=>!parts || collectionSupports(entry,parts));
  const size = 24;
  const pages = Math.max(1,Math.ceil(rows.length/size));
  const current = Math.max(1,Math.min(pages,parseInt(settings.get('cp'),10) || 1));
  const visible = rows.slice((current-1)*size,current*size);
  const toOverview = patch=>catalogLink(settings,patch);
  const chip = (label,href,active)=>'<a class="chip" href="'+e(href)+'"'+
    (active?' aria-current="page"':'')+'>'+e(label)+'</a>';
  const browseNav = !section ? '<nav class="quick-categories catalog-collection-segments" aria-label="Назначение">'+
    collectionSections.map(entry=>chip(entry.name,toOverview({c:catById.get(entry.id).slug,view:'collections',cp:null}))).join('')+'</nav>' : '';
  const classCards = section?.groups.length>1 ? '<section class="department-classes" aria-labelledby="department-classes-title">'+
    '<div class="section-head"><h2 id="department-classes-title">Классы мебели</h2>'+
    (tier?'<a class="text-link" href="'+e(toOverview({c:catById.get(section.id).slug,cp:null}))+'">Все классы</a>':'')+'</div>'+
    '<nav class="catalog-class-grid collection-classes" aria-label="Класс мебели">'+section.groups.map(group=>{
      const href=toOverview({c:catById.get(group.id).slug,cp:null});
      const cover=group.items.find(item=>item.cover)?.cover;
      return '<a class="catalog-class-choice" href="'+e(href)+'"'+(group===tier?' aria-current="page"':'')+'>'+
        (cover?photo(site.original+'/wp-content/uploads/'+cover,'','loading="lazy" width="300" height="225"'):'')+
        '<span>'+e(group.label)+'</span></a>';
    }).join('')+'</nav></section>' : '';
  const products = section ? '<a class="btn department-products" href="'+
    e(catalogLink('',{c:selected.slug,view:'products'}))+'">'+(tier?'Смотреть товары класса':'Все товары раздела')+'</a>' : '';
  const sections = '<div class="collection-grid">'+visible.map(({item,section:result,group})=>
    collectionCard(item,[!section?result.name:'',!tier?group.label:''].filter(Boolean).join(' · '),parts,settings)).join('')+'</div>';
  const pagination = pages>1 ? '<nav class="pagination" aria-label="Страницы коллекций">'+
    (current>1?'<a class="btn secondary" href="'+e(toOverview({cp:current-1===1?null:current-1}))+'">Назад</a>':'')+
    '<span>Страница '+catalogNumber.format(current)+' из '+catalogNumber.format(pages)+'</span>'+
    (current<pages?'<a class="btn secondary" href="'+e(toOverview({cp:current+1}))+'">Далее</a>':'')+'</nav>' : '';
  const levels = [['Каталог','#/catalog']];
  if (section && settings.get('view')==='collections') levels.push(['Коллекции',collectionNavigation()]);
  if (tier) levels.push([section.name,toOverview({c:catById.get(section.id).slug,cp:null})]);
  const searchForm = '<form id="collection-search" role="search" aria-label="Поиск коллекции">'+
    '<label class="sr-only" for="collection-query">Название коллекции</label><input class="field" type="search" id="collection-query" name="cq" value="'+
    e(query)+'" maxlength="100" placeholder="Название коллекции"><button class="btn secondary" type="submit">Найти</button></form>';
  return page(title,classCards+'<div class="collection-tools'+(section?' department-tools':'')+'">'+
    products+searchForm+browseNav+'</div>'+
    (rows.length?(section?'<div class="department-collections-head"><h2>Коллекции</h2><p class="count-label">Коллекций: '+catalogNumber.format(rows.length)+'</p></div>':
      '<p class="count-label">Коллекций: '+catalogNumber.format(rows.length)+'</p>')+sections+pagination :
      '<p class="empty">'+(query?'Коллекции с таким названием не найдены. <a class="text-link" href="'+e(toOverview({cq:null,cp:null,pick:null}))+'">Сбросить поиск</a>':'В этом разделе пока нет коллекций.')+'</p>'),levels);
}

function collectionChoices(type, selected) {
  const branch = collectionScope(selected);
  const sectionList = branch ? [branch] : selected ? [] : collectionSections;
  return sectionList.map(section=>({
    id:section.id,name:section.name,
    items:section.groups.filter(group=>!selected || selected.id===section.id || selected.id===group.id)
      .flatMap(group=>group.items.filter(item=>item.count && (!type || scopeTypes(catById.get(item.id)).includes(type)))
        .map(item=>({category:catById.get(item.id),group:group.label})))
      .sort((a,b)=>a.category.name.localeCompare(b.category.name,'ru'))
  })).filter(section=>section.items.length);
}

function collectionFilter(type, selected, series, chosen, chairSeries) {
  if (type==='chairs' && !selected && !series && chairSeriesGroups.length) {
    const value = chairSeries?.category.slug || '';
    return collectionPickerField('chairSeries','Серия кресел',value,value || 'Выбрать серию');
  }
  const groups=collectionChoices(type,collectionCategory(selected)?null:selected);
  if (!groups.length && !series) return '';
  return collectionPickerField('series','Коллекция',series,chosen?.name.replace(collectionPrefix,'') || series || 'Выбрать коллекцию');
}

function collectionPickerField(name,label,value,caption) {
  return '<div class="collection-filter"><span class="field-label" id="catalog-series-label">'+e(label)+'</span>'+
    '<input type="hidden" id="catalog-series" name="'+e(name)+'" value="'+e(value)+'">'+
    '<button class="field collection-picker-trigger" type="button" data-choose-collection aria-haspopup="dialog" aria-controls="collection-picker" aria-labelledby="catalog-series-label catalog-series-value">'+
    '<span id="catalog-series-value">'+e(caption)+'</span>'+
    '<i class="chevron" aria-hidden="true"></i></button></div>';
}

document.body.insertAdjacentHTML('beforeend','<dialog id="collection-picker" class="collection-picker" aria-labelledby="collection-picker-title">'+
  '<div class="collection-picker-heading"><h2 id="collection-picker-title">Выбрать коллекцию</h2><button type="button" class="collection-picker-close" aria-label="Закрыть выбор коллекции">×</button></div>'+
  '<div class="collection-picker-search"><label for="collection-picker-query" class="sr-only">Найти коллекцию</label>'+
  '<input class="field" type="search" id="collection-picker-query" placeholder="Название, например Xten или Икстен" maxlength="100" autocomplete="off" aria-controls="collection-picker-options">'+
  '<p class="small" id="collection-picker-count" role="status"></p></div>'+
  '<form id="collection-picker-form"><div class="collection-picker-options" id="collection-picker-options"></div>'+
  '<div class="collection-picker-footer"><button type="submit" class="btn">Применить</button></div></form></dialog>');
const collectionPicker=document.querySelector('#collection-picker');
const pickerQuery=document.querySelector('#collection-picker-query');
let pickerState;

function renderCollectionChoices() {
  const query=collectionSearchKey(pickerQuery.value.trim());
  const matched=pickerState.groups.map(section=>({...section,
    items:section.items.filter(item=>!query || collectionNameRank(item.category,query))
      .sort((a,b)=>query ? collectionNameRank(b.category,query)-collectionNameRank(a.category,query) : 0)
  })).filter(section=>section.items.length);
  const count=matched.reduce((sum,section)=>sum+section.items.length,0);
  const noun = pickerState.chairs ? 'серий' : 'коллекций';
  document.querySelector('#collection-picker-count').textContent=(query?'Найдено ':'Доступно ')+noun+': '+count;
  const option=(category,caption)=>'<label class="collection-picker-option"><input type="radio" name="collection" value="'+e(category?.slug || '')+'" '+
    (pickerState.value===(category?.slug || '')?'checked':'')+'><span><strong>'+e(category?.name.replace(collectionPrefix,'') || (pickerState.chairs?'Все серии':'Все коллекции'))+'</strong>'+
    (caption?'<small>'+e(caption)+'</small>':'')+'</span></label>';
  const selected=pickerState.chairs ? chairSeriesByKey.get(pickerState.value)?.category : selectedSeries(pickerState.value);
  const selectedOutside=selected && !pickerState.groups.some(section=>section.items.some(item=>item.category.id===selected.id));
  document.querySelector('#collection-picker-options').innerHTML=
    (!query?option(null,pickerState.chairs?'Снять фильтр по серии':'Снять фильтр по коллекции')+(selectedOutside?option(selected,'Текущий выбор'):''):'')+
    matched.map(section=>'<details class="collection-picker-group" data-picker-section="'+section.id+'" '+
      (query || pickerState.open.has(String(section.id))?'open':'')+'><summary><span>'+e(section.name)+'</span><span class="small">'+section.items.length+'</span><i class="chevron" aria-hidden="true"></i></summary>'+
      '<div>'+section.items.map(item=>option(item.category,[section.name,item.group].filter(Boolean).join(' · '))).join('')+'</div></details>').join('')+
    (!count?'<div class="collection-picker-empty"><p>'+(pickerState.chairs?'Серии':'Коллекции')+' с таким названием не найдены.</p><button type="button" class="text-link" data-picker-reset>Показать полный список</button></div>':'');
}

function openCollectionPicker(button) {
  const settings=catalogSettings(getRoute().args);
  const category=selectedCategory(settings.get('c'));
  const source=catalogOrigin(settings.get('back'));
  const sourceCategory=source && selectedCategory(getRoute(source).args.get('c'));
  const scope=collectionCategory(category)?(collectionScope(sourceCategory)?sourceCategory:null):category;
  const field = document.querySelector('#catalog-series');
  const chairs = field.name==='chairSeries';
  const groups = chairs ? chairSeriesGroups : collectionChoices(settings.get('t'),scope);
  const value = field.value;
  pickerState={groups,value,button,chairs,open:new Set(groups.filter(section=>
    section.items.some(item=>item.category.slug===value) || groups.length===1).map(section=>String(section.id)))};
  pickerQuery.value='';
  const title = chairs ? 'Выбрать серию кресел' : 'Выбрать коллекцию';
  document.querySelector('#collection-picker-title').textContent=title;
  collectionPicker.querySelector('.collection-picker-close').setAttribute('aria-label',chairs?'Закрыть выбор серии':'Закрыть выбор коллекции');
  pickerQuery.labels[0].textContent=chairs?'Найти серию кресел':'Найти коллекцию';
  pickerQuery.placeholder=chairs?'Бренд или модель, например CH-330M':'Название, например Xten или Икстен';
  renderCollectionChoices();
  const rect=button.getBoundingClientRect();
  const width=Math.min(540,window.innerWidth-32);
  collectionPicker.style.left=Math.max(16,Math.min(rect.right+12,window.innerWidth-width-16))+'px';
  collectionPicker.style.top=Math.max(16,Math.min(rect.top,window.innerHeight-Math.min(660,window.innerHeight-32)-16))+'px';
  collectionPicker.showModal();
  document.body.classList.add('choosing-collection');
  if (matchMedia('(min-width:621px)').matches) pickerQuery.focus({preventScroll:true});
}

pickerQuery.addEventListener('input',renderCollectionChoices);
collectionPicker.addEventListener('keydown',event=>{
  if (event.key==='Escape') {
    event.preventDefault();
    collectionPicker.close();
  }
});
collectionPicker.addEventListener('toggle',event=>{
  const group=event.target;
  if (!group.dataset.pickerSection || pickerQuery.value.trim()) return;
  if (group.open) pickerState.open.add(group.dataset.pickerSection);
  else pickerState.open.delete(group.dataset.pickerSection);
},true);
collectionPicker.addEventListener('change',event=>{
  if (event.target.name==='collection') pickerState.value=event.target.value;
});
collectionPicker.addEventListener('click',event=>{
  if (event.target.closest('.collection-picker-close')) collectionPicker.close();
  if (event.target.closest('[data-picker-reset]')) {
    pickerQuery.value='';
    renderCollectionChoices();
    pickerQuery.focus();
  }
  if (event.target===collectionPicker) {
    const rect=collectionPicker.getBoundingClientRect();
    if (event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom) collectionPicker.close();
  }
});
collectionPicker.addEventListener('close',()=>{
  document.body.classList.remove('choosing-collection');
  if (pickerState?.button.isConnected) pickerState.button.focus({preventScroll:true});
});
document.querySelector('#collection-picker-form').addEventListener('submit',event=>{
  event.preventDefault();
  const field=document.querySelector('#catalog-series');
  field.value=pickerState.value;
  const chosen=selectedSeries(pickerState.value);
  document.querySelector('#catalog-series-value').textContent=chosen?.name.replace(collectionPrefix,'') || pickerState.value ||
    (pickerState.chairs?'Выбрать серию':'Выбрать коллекцию');
  collectionPicker.close();
  const fromContext=Boolean(pickerState.button.closest('.collection-context-links'));
  field.form.dataset.collectionAnchor=fromContext?'context':'filters';
  if (fromContext) field.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  else field.form.requestSubmit();
});

function catalogFinishControl(collection, finish) {
  const options = (catalogFacts.collectionFinishes[collection?.id] || []).map(index=>catalogFacts.finishes[index]);
  if (!options.length && !finish) return '';
  if (finish && !options.includes(finish)) options.unshift(finish);
  return '<div class="catalog-finish">'+finishField('catalog-finish','Отделка','Все отделки',options.map(label=>[label,label]),finish)+'</div>';
}

function catalogPage(settings, preview, unavailable) {
  if (unavailable) return page('Каталог', '<p class="intro">Каталог временно недоступен. <a class="text-link" href="'+site.original+'/shop/">Открыть каталог «Гранд-Офиса»</a></p>');
  if (showDepartmentIndex(settings)) return catalogDepartmentsPage();
  const c = settings.get('c') || '';
  const type = Object.hasOwn(productTypes,settings.get('t')) ? settings.get('t') : '';
  const part = Object.hasOwn(partLabels,settings.get('k')) ? settings.get('k') : '';
  const purpose = Object.hasOwn(allPurposes,settings.get('use')) ? settings.get('use') : '';
  const shape = Object.hasOwn(tableShapes,settings.get('shape')) ? settings.get('shape') : '';
  const query = (settings.get('q') || '').slice(0,120);
  const series = (settings.get('series') || '').slice(0,160);
  const finish = settings.get('finish') || '';
  const sort = settings.get('sort') || '';
  const ranges=getCatalogRanges(settings);
  const [priceBounds,...dimensionBounds]=ranges;
  const dimensions=dimensionBounds.filter(hasBounds);
  const includeUnknown = settings.get('unknown')==='1';
  const selected = selectedCategory(c);
  if (selected?.slug===specialDepartment && selected.empty && !['q','t','p','sort',...filterFields].some(key=>settings.get(key))) {
    const links = departmentSubcategories(specialDepartment).map(entry=>'<a class="chip" href="'+e(catalogLink('',{c:entry.slug}))+'">'+e(entry.name)+'</a>');
    return page('Специализированная мебель','<div class="quick-categories">'+links.join('')+'</div>'+
      '<p class="intro">Поможем подобрать промышленную мебель под задачу и условия работы.</p><a class="btn" href="'+officeQuote+'">Запросить подбор мебели</a>',[['Каталог','#/catalog']]);
  }
  if (showCollections(settings,selected)) return collectionOverview(settings,selected);
  const seriesCategory = selectedSeries(series);
  const collection = seriesCategory || collectionCategory(selected);
  const chairSeries = chairSeriesByKey.get(settings.get('chairSeries'));
  const resultOptions = {selected,type,part,query,series,seriesCategory,chairSeries,purpose,shape,ranges};
  const matches = preview ? preview.rows.map(fromBrowse) : catalogResults(settings,resultOptions);
  const similar = query && !preview && searchProducts(query).similar;
  const count = preview?.count ?? matches.length;
  const totalPages = Math.max(1,Math.ceil(count/pageSize));
  const offset = catalogPageNumber(settings,totalPages);
  const title = collection?.name.replace(collectionPrefix,'') || selected?.name || productTypes[type]?.[0] || partLabels[part] || 'Каталог офисной мебели';
  const toCatalog = (patch) => catalogLink(settings,patch);
  const levels = [];
  if (selected) {
    for (let entry=catById.get(selected.parent); entry && levels.length<12; entry=catById.get(entry.parent))
      levels.unshift([entry.name,toCatalog(categoryPatch(entry))]);
  }
  levels.unshift(['Каталог','#/catalog']);
  const chips = [
    ['q',query&&'Поиск «'+query+'»'],['use',allPurposes[purpose]],
    ['shape',tableShapes[shape]],['k',partLabels[part]],
    ...ranges.flatMap(range=>{
      const amount=value=>range.dimension===undefined ? format(value) : catalogNumber.format(value)+' мм';
      const kind=range.dimension===undefined?'':range.label+' ';
      return [[range.low,range.min!=null && kind+(kind?'от ':'От ')+amount(range.min)],
        [range.high,range.max!=null && kind+(kind?'до ':'До ')+amount(range.max)]];
    }),
    ['series',!collection&&series&&'Коллекция «'+series+'»'],['chairSeries',chairSeries&&'Серия «'+chairSeries.category.name+'»'],
    ['finish',!collection&&finish&&'Отделка «'+finish+'»'],
    ['unknown',dimensions.length&&includeUnknown&&'Без части габаритов'],
    ['sort',sort==='up'?'Сначала дешевле':sort==='down'?'Сначала дороже':'']
  ].filter(([,label])=>label);
  const root=categoryRoot(selected)?.slug;
  const chairSection=Object.values(chairCategories).some(slugs=>slugs.includes(root));
  const tableSection=/^стол(?:ы|а)?(?:\s|$)/i.test(selected?.name || '');
  const desktop = matchMedia('(min-width: 961px)').matches;
  const forTables=type==='tables' || (!type && (tableSection || shape || Object.hasOwn(tablePurposes,purpose)));
  const forChairs=type==='chairs' || (!type && (chairSection || Object.hasOwn(chairPurposes,purpose)));
  const purposeOptions=forTables?tablePurposes:forChairs?chairPurposes:null;
  const filters=collectionFilter(type,selected,series || collection?.slug || '',collection,chairSeries)+catalogRangeFields(priceBounds)+
    '<details class="filter-section" '+(dimensions.length || desktop?'open':'')+'><summary>Габариты</summary><div class="filter-section-body">'+
    dimensionBounds.map(catalogRangeFields).join('')+'<label class="unknown-width"><input type="checkbox" name="unknown" value="1" '+
    (includeUnknown?'checked':'')+' '+(dimensions.length?'':'disabled')+'> Включить товары без всех указанных габаритов</label></div></details>'+
    '<details class="filter-section" '+(purpose || shape || series || part || forTables || forChairs?'open':'')+
    '><summary>Характеристики</summary><div class="filter-section-body">'+
    (purposeOptions?catalogFilterSelect('use','Назначение',purposeOptions,purpose,'Любое'):'')+
    (forTables?catalogFilterSelect('shape','Форма',tableShapes,shape,'Любая'):'')+
    catalogFilterSelect('k','Вид позиции',partLabels,part,'По разделу и типу')+'</div></details>';
  const sortControl = '<label class="sort-control"><span>Сортировка</span><select class="field" id="catalog-sort"><option value="">По умолчанию</option>'+
    '<option value="up" '+(sort==='up'?'selected':'')+'>Сначала дешевле</option><option value="down" '+(sort==='down'?'selected':'')+'>Сначала дороже</option></select></label>';
  const items = preview ? matches : matches.slice((offset-1)*pageSize,offset*pageSize);
  const complete=entry=>dimensions.every(range=>entry.dimensions?.[range.dimension]>0);
  const known = items.filter(complete);
  const incompleteTitle=dimensions.length===1&&dimensions[0].dimension===0?'Ширина не указана':'Не все габариты указаны';
  const groups = [
    [null,known.filter(entry=>entry.kind==='furniture')],
    ['Модули',known.filter(entry=>entry.kind==='modules')],
    ['Комплектующие',known.filter(entry=>entry.kind==='parts')],
    [incompleteTitle,items.filter(entry=>!complete(entry))]
  ].filter(([,rows])=>rows.length);
  const groupHeading = heading => heading ? '<h2>'+heading+'</h2>'+
    (heading===incompleteTitle?'<p class="small">Размеры этих товаров нужно уточнить перед заказом.</p>':'') : '';
  const firstGroupHeading = groupHeading(groups[0]?.[0]);
  const grid = groups.map(([heading,rows],index)=>'<section class="catalog-group">'+(index?groupHeading(heading):'')+
    '<div class="product-grid catalog-grid">'+rows.map(item=>card(item,toCatalog())).join('')+'</div></section>').join('');
  const cleared=toCatalog({...Object.fromEntries(filterFields.map(key=>[key,null])),p:null,changedfinish:null,
    ...(seriesCategory?{series:seriesCategory.slug}:{}),view:selected ? settings.get('view') : 'products'});
  const filterCount=chips.filter(([key])=>filterFields.includes(key)).length+(collection && finish?1:0);
  const exactWidth = ranges[1].min!=null && ranges[1].min===ranges[1].max;
  const depth = ranges[2];
  let sizeAlternative = '';
  if (!count && (collection || seriesCategory) && exactWidth && depth.min!=null && depth.min===depth.max) {
    const broader = ranges.map((range,i)=>i===2?{...range,min:null,max:null}:range);
    const options = catalogResults(settings,{...resultOptions,ranges:broader})
      .map(item=>item.dimensions?.[1]).filter(Boolean).sort((a,b)=>Math.abs(a-depth.min)-Math.abs(b-depth.min));
    if (options.length) sizeAlternative = '<a class="text-link" href="'+e(toCatalog({dmin:options[0],d:options[0],p:null}))+'">'+
      'Посмотреть в этой коллекции: '+ranges[1].min+' × '+options[0]+' мм</a>';
  }
  const simpler = query.replace(searchSizePattern,' ').trim();
  const simplerLink = !count && query!==simpler && catalogResults(settings,{...resultOptions,query:simpler}).length
    ? '<a class="text-link" href="'+e(toCatalog({q:simpler,p:null,view:'products'}))+'">Искать без указанных размеров</a>' : '';
  const empty = collection && !collectionsById.get(collection.id).count
    ? '<div class="empty">Товары этой коллекции уточняются. <a class="text-link" href="#/project">Запросить подбор</a></div>'
    : '<div class="empty">'+((collection||seriesCategory) && dimensions.length?'В этой коллекции нет товаров с подтверждённым совпадением по размерам. ':'По этому запросу ничего не найдено. ')+
    (sizeAlternative || simplerLink || (filterCount?
    '<a class="text-link" href="'+e(cleared)+'">Очистить фильтры</a>':
    collection?'<a class="text-link" href="'+e(collectionNavigation(collection))+'">Вся мебель коллекции</a>':
      '<a class="text-link" href="#/catalog?view=products">Открыть весь каталог</a>'))+'</div>';
  const pages = [...new Set([1,offset-1,offset,offset+1,totalPages])].filter(n=>n>=1 && n<=totalPages).sort((a,b)=>a-b);
  const pagination = totalPages>1 ? '<nav class="pagination" aria-label="Страницы каталога">'+
    (offset>1?'<a class="btn secondary" href="'+e(toCatalog({p:offset-1}))+'">Назад</a>':'')+
    '<div class="page-numbers">'+pages.map((number,i)=>(i && pages[i-1]+1<number?'<span aria-hidden="true">…</span>':'')+
      (offset===number?'<span aria-current="page">'+number+'</span>':'<a href="'+e(toCatalog({p:number}))+'" aria-label="Страница '+number+'">'+number+'</a>')).join('')+'</div>'+
    (offset<totalPages?'<a class="btn secondary" href="'+e(toCatalog({p:offset+1}))+'">Далее</a>':'')+
    (totalPages>5?'<form id="catalog-jump"><label>Страница <input class="field" type="number" name="p" min="1" max="'+totalPages+'" value="'+offset+'" required></label><button type="submit" class="btn secondary">Перейти</button></form>':'')+'</nav>' : '';
  const children = selected ? (catChildren.get(selected.id) || []).filter(child=>!child.empty) : [];
  const sections = children.length>0 && children.length<=12
    ? '<nav class="catalog-subsections" aria-label="Подразделы"><span>Подразделы</span>'+children.map(entry=>'<a class="text-link" href="'+e(toCatalog(categoryPatch(entry)))+'">'+e(entry.name)+'</a>').join('')+'</nav>' : '';
  const queryCollections = collectionSearchKey(query).length>=2 && findCollections(query).length>0;
  const collectionsLink = collection ? collectionNavigation(catById.get(collection.parent)) :
    catalogLink('',{view:'collections',cq:query});
  const typeOrder = collection ? ['tables','pedestals','cabinets','shelving','chairs','sofas'] : Object.keys(productTypes);
  const typeScope = collection || selected;
  const scoped = scopeTypes(typeScope);
  const childCategory=collection && selected && selected.id!==collection.id && collectionCategory(selected)?.id===collection.id ? selected : null;
  const childTypes=childCategory ? scopeTypes(childCategory) : [];
  const effectiveType=type || (childTypes.length===1 && !childCategory.partsOnly ? childTypes[0] : '');
  const tabRanges = collection || seriesCategory ? ranges.slice(0,1) : ranges;
  const constrainedTypes = catalogItems && (finish || series || query || tabRanges.some(hasBounds))
    ? new Set(catalogResults(settings,{...resultOptions,chairSeries:null,selected:typeScope,type:'',part:'furniture',purpose:'',shape:'',
      ranges:tabRanges}).map(item=>item.type))
    : null;
  const availableTypes = typeOrder.filter(key=>scoped.includes(key) &&
    (!constrainedTypes || key===effectiveType || constrainedTypes.has(key)));
  const typeTabs = availableTypes.length ? '<nav class="quick-categories" aria-label="Тип мебели">'+['',...availableTypes].map(key=>'<a class="chip" data-catalog-type href="'+
    e(toCatalog({...(collection && !seriesCategory?{c:collection.slug}:{}),t:key,use:null,shape:null,k:null,p:null,
      ...(key!=='chairs'?{chairSeries:null}:{}),
      ...(key!==type && (collection || seriesCategory)?{...Object.fromEntries(dimensionFields.map(field=>[field,null])),unknown:null}:{}),
      view:selected ? settings.get('view') : 'products'}))+'" '+
    (effectiveType===key && (key || !childCategory)?'aria-current="page"':'')+'>'+
    (key?productTypes[key][0]:collection?'Вся мебель коллекции':'Все типы')+'</a>').join('')+'</nav>' : '';
  const source = catalogOrigin(settings.get('back'));
  const sourceCategory = source && selectedCategory(getRoute(source).args.get('c'));
  const sectionContext = sourceCategory || selected;
  const homeSection = collection && (collectionSections.find(section=>section.id===sectionContext?.id || section.groups.some(group=>group.id===sectionContext?.id)) ||
    collectionSections.find(section=>section.groups.some(group=>group.items.some(item=>item.id===collection.id))));
  if (collection) {
    levels.splice(1);
    if (homeSection) levels.push([homeSection.name,collectionNavigation(catById.get(homeSection.id))]);
  }
  const sourceSettings=source ? catalogSettings(getRoute(source).args) : null;
  const sourceType=sourceSettings?.get('t');
  const returnTypes={tables:'столам',chairs:'креслам',cabinets:'шкафам',pedestals:'тумбам',shelving:'стеллажам',sofas:'диванам'};
  const fromCollections=sourceSettings && showCollections(sourceSettings,sourceCategory);
  const returnLabel=!source || fromCollections ? 'К коллекциям' : returnTypes[sourceType] ? 'Назад к '+returnTypes[sourceType] :
    showDepartmentIndex(sourceSettings) ? 'В каталог' : 'Назад к списку';
  const collectionLinks = collection ? '<nav class="collection-context-links" aria-label="Возврат из коллекции">'+
    '<a class="text-link" data-catalog-return="'+e(Number(settings.get('backy')) || 0)+'" href="'+e(source || collectionNavigation())+'">'+e(returnLabel)+'</a></nav>' : '';
  const notice = settings.get('changedfinish') ? '<p class="catalog-notice">Отделка «'+e(settings.get('changedfinish'))+'» недоступна в выбранной коллекции. Показаны все отделки.</p>' : '';
  const childContext=childCategory ? '<p class="small catalog-subsection-context">Подраздел: '+e(childCategory.name)+'</p>' : '';
  const selectedDepartment = !collection && collectionScope(selected);
  const browseCollections = selectedDepartment ? '<p class="catalog-related"><a class="text-link" href="'+
    e(catalogLink('',{c:selected.slug}))+'">'+(selectedDepartment.id===selected.id?'Коллекции раздела':'Коллекции класса')+'</a></p>' : '';
  const catalogTools = collectionLinks+browseCollections+
    '<div class="catalog-type-tabs">'+catalogFinishControl(collection,finish)+typeTabs+'</div>'+childContext+notice+
    (!collection && sections?'<details class="catalog-subsection-toggle"><summary>Подразделы</summary>'+sections+'</details>':'')+
    (!collection && queryCollections?'<p class="catalog-related"><a class="text-link" href="'+e(collectionsLink)+'">Коллекции по запросу</a></p>':'');
  return page(title,catalogTools+'<div class="catalog-shell'+(collection?' collection-shell':'')+'"><aside class="catalog-sidebar" aria-label="Фильтры и разделы">'+
    '<details class="catalog-filters" '+(desktop?'open':'')+'><summary>Фильтры'+(filterCount?' <span>'+filterCount+'</span>':'')+'</summary><form id="filters" class="filters-grid">'+
    '<div class="catalog-filter-fields">'+filters+'</div><div class="filter-actions"><button class="btn" type="submit">Применить</button>'+
    (filterCount?'<a class="text-link reset-filters" href="'+e(cleared)+'">Очистить фильтры</a>':'')+
    '</div></form></details><details class="catalog-directory"><summary>Разделы каталога</summary><nav aria-label="Разделы каталога">'+
    categoryItems(catChildren.get(0) || [],selected,settings)+'</nav></details></aside><div class="catalog-toolbar"><div class="catalog-tools">'+
    (selected?.partsOnly?'<p class="catalog-notice">В этом разделе собраны отдельные модули и комплектующие. <a class="text-link" href="'+
      e(catalogLink('',{t:/шкаф/i.test(selected.name)?'cabinets':null,view:'products'}))+'">'+
      (/шкаф/i.test(selected.name)?'Посмотреть готовые шкафы':'Посмотреть готовую мебель')+'</a></p>':'')+
    (chips.length?'<div class="applied-filters" aria-label="Применённые фильтры">'+chips.map(([key,label])=>'<a class="chip" aria-label="Снять: '+e(label)+'" href="'+
      e(toCatalog({[key]:null,p:null,view:selected ? settings.get('view') : 'products',
        ...(dimensionFields.includes(key) && !dimensionFields.some(other=>other!==key&&settings.has(other))?{unknown:null}:{})}))+'">'+e(label)+' <span aria-hidden="true">×</span></a>').join('')+'</div>':'')+
    '</div><div class="catalog-heading"><p class="count-label">Найдено: '+catalogNumber.format(count)+'</p>'+sortControl+
    '</div>'+ (similar && count?'<p class="catalog-notice sku-similar">Точного совпадения нет. Показаны похожие артикулы.</p>':'')+
    (firstGroupHeading?'<div class="catalog-group catalog-first-group-heading">'+firstGroupHeading+'</div>':'')+
    '</div><div class="catalog-results">'+(grid || empty)+pagination+'</div></div>',levels);
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

function descriptionParagraphs(text) {
  if (!Intl.Segmenter) return '<p>'+e(text)+'</p>';
  const sentences = new Intl.Segmenter('ru',{granularity:'sentence'}).segment(text);
  const paragraphs = [];
  let paragraph = '';
  for (const {segment} of sentences) {
    if (paragraph.length>=120 && paragraph.length+segment.length>225) {
      paragraphs.push(paragraph);
      paragraph = '';
    }
    paragraph += segment;
  }
  if (paragraph) paragraphs.push(paragraph);
  return paragraphs.map(part=>'<p>'+e(part)+'</p>').join('');
}

function catalogOrigin(address) {
  return address?.length<=1800 && /^#\/catalog(?:-preview)?(?:\?[^#]*)?$/.test(address) ?
    catalogLink(catalogSettings(getRoute(address).args)) : '';
}

function productHasColorVariants(id, specs, options) {
  return options.some(([,label])=>label) && (finishesFor(id).length>0 ||
    specs.some(([label])=>/^(?:цвет|отделка)(?:\s|$)/i.test(label.trim())) ||
    options.every(([,label])=>Object.hasOwn(finishSwatches,finishKey(label))));
}

function optionForFinish(options, finish) {
  const key=finishKey(finish);
  if (!key) return;
  const matches=options.filter(([,label])=>finishKey(label)===key);
  if (matches.length===1) return matches[0];
}

function itemPage(item, detail, variant, origin, choice) {
  const [images=[],specs=[],opts=[],description=''] = detail || [];
  const baseImages = images.length ? images : item.image ? [item.image] : [];
  const matchingPhoto = variant?.image && variant.image!==baseImages[0] ? variant.image : '';
  const pics = matchingPhoto ? [...new Set([matchingPhoto,...baseImages])] : baseImages;
  const selected = opts.find(option=>option[0] === choice);
  const dimensions = catalogFacts ? dimensionsLabel(item.dimensions) : '';
  const values = [item.sku ? 'Арт. '+item.sku : '',dimensions].filter(Boolean);
  const context = 'product='+item.id+(selected?'&variant='+selected[0]:'');
  const warranty = specs.find(([label])=>/гаранти/i.test(label))?.[1] ||
    description.match(/(?:гарантия|гарантийный срок)\s*(?:—|–|-|:)?\s*((?:от\s+)?\d+(?:\s*(?:–|-|до)\s*\d+)?\s*(?:месяц[а-я]*|год[а-я]*|лет))/i)?.[1];
  const liveStock = variant?.stock ?? selected?.[3] ?? (hasBackend && !opts.length ? detail?.[5] : null);
  const from = catalogOrigin(origin);
  const filter = from ? getRoute(from).args : new URLSearchParams();
  const category = collectionCategory(selectedCategory(filter.get('c'))) || selectedSeries(filter.get('series'));
  const collection = collectionForProduct(item,category);
  const finishes = finishesFor(item.id);
  const finish = selected ? finishes.find(value=>finishKey(value)===finishKey(selected[1])) : !opts.length && finishes[0];
  const finishLink = collection && finish ? catalogLink('',{c:collection.slug,finish}) : '';
  const hasColorVariants=productHasColorVariants(item.id,specs,opts);
  const finishOptions=opts.map(([id,label])=>[id,label || 'Вариант '+id]);
  const optionField=hasColorVariants ? finishField('product-option','Отделка',null,finishOptions,selected?.[0],'data-id="'+item.id+'"') :
    opts.length ? '<label><span class="field-label">Вариант</span><select class="field" id="product-option" data-id="'+item.id+'" '+
      (selected?'':'aria-describedby="variant-help"')+'><option value="">Выберите вариант</option>'+
      finishOptions.map(([id,label])=>'<option value="'+id+'" '+(id===selected?.[0]?'selected':'')+'>'+e(label)+'</option>').join('')+'</select></label>' :
      finishPreview(finishes);
  const levels = [['Каталог','#/catalog']];
  if (collection) levels.push([collection.name,collectionNavigation(collection)]);
  const returnLink = from && from!=='#/catalog' && from!==(collection && collectionNavigation(collection))
    ? '<a class="text-link product-back" href="'+e(from)+'">Вернуться к списку товаров</a>' : '';
  return `<div class="shell page product-page">${crumbs([...levels,[productTitle(item.name)]])}${returnLink}
      <div class="product-layout"><header class="product-heading"><h1>${e(productTitle(item.name))}</h1>${values.length?'<p class="meta">'+e(values.join(' · '))+'</p>':''}</header>
      <section class="product-visual" aria-label="Фотографии товара"><figure class="gallery">${pics[0]?photo(pics[0],item.name):photo('')}</figure>${selected?'<p class="small photo-caption">'+e(matchingPhoto ? 'Фото выбранного варианта' : 'Общее фото модели')+'</p>':''}
      ${pics.length>1 ? '<div class="gallery-thumbs">'+pics.slice(0,8).map((src,i)=>`<button type="button" data-photo="${e(src)}" data-variant-photo="${src===matchingPhoto}" aria-label="Фотография ${i+1}">${photo(src,'','loading="lazy"')}</button>`).join('')+'</div>':''}</section>
      <section class="product-info">
      <p class="product-price">${selected?(priceOf(item,selected,variant)==null ? '<span class="small">Цена варианта уточняется</span>' : money(priceOf(item,selected,variant))):money(item.price,item.max)}</p>
      ${optionField}
      ${opts.length && !selected?'<p class="small" id="variant-help">Выберите вариант, чтобы добавить товар в корзину.</p>':''}
      <p class="small" id="variant-status" role="status" hidden></p>
      <div class="actions"><button class="btn" data-add="${item.id}" ${(opts.length && !selected) || liveStock===0?'disabled':''}>В корзину</button><a class="btn secondary" data-item-quote href="#/project?${context}">Запросить расчёт</a></div><p class="result" id="cart-result" role="status" hidden></p>
      ${finishLink?'<p class="product-finish-link"><a class="text-link" href="'+e(finishLink)+'">Мебель этой коллекции в такой же отделке</a></p>':''}
      <div class="logistics"><p class="stock">${liveStock>0 ? 'Доступно: '+liveStock+' шт.' : ((variant?.backorder ?? item.backorder)?'Под заказ':'Наличие уточняется')}</p><p class="small">${e(logistics(item))}</p></div>
      <p class="small"><a class="text-link" href="#/delivery?${context}">Рассчитать доставку этого товара</a></p>
      ${warranty?'<p class="small">Гарантия · '+e(warranty)+'</p>':''}</section></div>
      ${description?'<section class="spec product-description"><h2>О товаре</h2><div class="product-prose">'+descriptionParagraphs(description)+'</div></section>':''}
      ${dimensions || needsDimensionCheck(item)? '<section class="spec"><h2>Габариты</h2>'+
        (dimensions?'<p>'+e(dimensions)+'</p>':'')+(needsDimensionCheck(item)?
          (dimensions?'<p>Часть размеров требует уточнения.</p>':'<p>Размеры требуют уточнения.</p>'):'')+'</section>' : ''}
      ${specs.length?'<section class="spec"><h2>Характеристики</h2><dl>'+specs.map(([a,b])=>'<div><dt>'+e(a)+'</dt><dd>'+e(b)+'</dd></div>').join('')+'</dl>'+(detail?.[7]?'<p><a class="text-link" href="'+e(detail[7])+'">Спецификация модели</a></p>':'')+'</section>':''}
      </div>`;
}

function lineTotal() {
  return cart.reduce((sum, line) => sum + (line.price ?? 0) * line.qty, 0);
}
const rowAmount = (row) => row.price==null?'Уточняется':format(row.price*row.qty);
const furnitureTotal = () => cart.some(row=>row.price==null) ? 'Уточняется' : format(lineTotal());
function saveCart() {
  site.save('basket',cart);
  document.querySelector('#cart-count').textContent = cart.reduce((sum,row)=>sum+row.qty,0);
}
const cartLimit = row => Math.min(row.cap || 999,999);
const cartItemDetails = row => [row.variant,row.sku?'Арт. '+row.sku:''].filter(Boolean).join(' · ');

function updateCartQuantity(input, value) {
  const row = cart[Number(input.dataset.qty)];
  if (!row) return;
  row.qty = Math.max(1,Math.min(cartLimit(row),Math.trunc(value)||1));
  input.value = row.qty;
  saveCart();
  const line = input.closest('.cart-row');
  line.querySelector('[data-cart-step="-1"]').disabled = row.qty<=1;
  line.querySelector('[data-cart-step="1"]').disabled = row.qty>=cartLimit(row);
  line.querySelector('.line-total').textContent = rowAmount(row);
  document.querySelector('#basket-total').textContent = furnitureTotal();
}

function cartPage() {
  const catalog = catalogOrigin(site.session('basket-origin','')) || '#/catalog';
  if (!cart.length) return page('Корзина','<p class="intro">Добавьте мебель из каталога.</p><a class="btn" href="'+e(catalog)+'">В каталог</a>');
  return page('Корзина',`<div class="cart-layout"><section aria-label="Товары">${cart.map((row,i)=>`<div class="cart-row">
      <div class="cart-photo">${photo(row.image || '')}</div><div class="cart-item"><a href="#/product/${row.id}${row.choice?'?variant='+row.choice:''}">${e(productTitle(row.name))}</a>
        ${cartItemDetails(row)?'<p class="small">'+e(cartItemDetails(row))+'</p>':''}<p class="small">${money(row.price)}${row.price!=null?' за шт.':''}</p></div>
      <div class="cart-quantity"><label class="field-label" for="cart-qty-${i}">Количество</label><div class="cart-stepper">
        <button type="button" data-cart-step="-1" aria-label="Уменьшить количество" ${row.qty<=1?'disabled':''}>−</button>
        <input type="number" class="field" id="cart-qty-${i}" min="1" max="${cartLimit(row)}" step="1" inputmode="numeric" value="${row.qty}" data-qty="${i}">
        <button type="button" data-cart-step="1" aria-label="Увеличить количество" ${row.qty>=cartLimit(row)?'disabled':''}>+</button>
      </div></div>
      <strong class="line-total" aria-live="polite">${rowAmount(row)}</strong><button class="cart-remove" type="button" data-remove="${i}">Убрать</button>
      </div>`).join('')}</section>
      <aside class="panel cart-summary"><h2>Итого по мебели</h2><p class="small">Город: ${e(city)}. В расчёте подтвердим наличие, сроки и стоимость услуг.</p>
      <div class="summary"><div><span>Мебель</span><strong id="basket-total" aria-live="polite">${furnitureTotal()}</strong></div><div><span>Доставка, подъём и сборка</span><span>По запросу</span></div></div>
      <div class="actions"><a class="btn" href="#/checkout">Запросить расчёт</a><a class="text-link" href="${e(catalog)}">Продолжить подбор</a></div></aside></div>`);
}

function transportNote() {
  return hasBackend ? '' : '<p class="request-note">Запрос отправляется по почте. Откройте готовое письмо или скопируйте текст, чтобы отправить его из своей почты.</p>';
}

function contactFields() {
  return `<label><span class="field-label">Имя</span><input class="field" name="name" maxlength="100" autocomplete="name" required></label>
    <label><span class="field-label">Телефон или электронная почта</span><input class="field" name="contact" maxlength="140" autocomplete="off" required></label>
    ${hasBackend ? '<label class="consent"><input type="checkbox" name="consent" required> Согласен на обработку данных для ответа на обращение. <a class="text-link" href="https://grand-office59.ru/privacy-policy/">Политика конфиденциальности</a></label>' : ''}`;
}

function requestDraftKey(form) {
  if (form.dataset.draftKey) return form.dataset.draftKey;
  const section = form.dataset.kind==='project' ? getRoute().args.get('section') : null;
  form.dataset.draftKey='grand-request-'+[form.dataset.kind,form.dataset.topic || '',form.dataset.product || '',
    form.dataset.variant || '',form.dataset.case || '',form.dataset.drawnPlan || '',
    section==='form' ? '' : section || ''].join('|');
  return form.dataset.draftKey;
}

function saveRequestDraft(form=document.querySelector('#request-form')) {
  if (!form || form.dataset.completed) return;
  const values={};
  for (const element of form.elements) {
    if (!element.name || element.type==='file' || element.type==='hidden' || element.name==='token') continue;
    values[element.name]=element.type==='checkbox'?element.checked:element.value;
  }
  try {sessionStorage.setItem(requestDraftKey(form),JSON.stringify(values));} catch {}
}

function restoreRequestDraft() {
  const form=main.querySelector('#request-form');
  if (!form) return;
  let values;
  try {values=JSON.parse(sessionStorage.getItem(requestDraftKey(form)) || 'null');} catch {}
  if (!values || typeof values!=='object') return;
  for (const element of form.elements) {
    if (!element.name || element.type==='file' || element.type==='hidden' || !Object.hasOwn(values,element.name)) continue;
    if (element.name==='kit' && getRoute().args.get('section')==='kit') continue;
    if (element.name==='seats' && (getRoute().args.has('seats') || form.dataset.drawnPlan)) continue;
    if (element.type==='checkbox') element.checked=values[element.name]===true;
    else if (typeof values[element.name]==='string') element.value=values[element.name];
  }
  const seats=validSeats(form.elements.seats?.value);
  if (form.elements.contact?.value) validateRequestContact(form);
  if (form.elements.kit?.value && seats && main.querySelector('#set-count')) syncQuoteCount(seats);
}

function validateRequestContact(form) {
  const field=form.elements.contact;
  const value=field.value.trim();
  const valid=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.replace(/\D/g,'').length>=7;
  field.setCustomValidity(valid?'':'Укажите телефон или электронную почту.');
  return valid;
}

function checkoutPage() {
  if (!cart.length) return cartPage();
  return page('Запрос расчёта',`<div class="project-demo checkout"><form id="request-form" data-kind="order" class="panel">${transportNote()}
    <label><span class="field-label">Город</span><input class="field" name="city" value="${e(city)}" required maxlength="80"></label>
    <label><span class="field-label">Адрес доставки</span><input class="field" name="address" maxlength="250" autocomplete="street-address"></label>
    <label><span class="field-label">Дополнительные услуги</span><select class="field" name="delivery"><option>Доставка</option><option>Доставка и сборка</option><option>Доставка, подъём и сборка</option><option>Самовывоз по согласованию</option></select></label>
    <label><span class="field-label">К какой дате офис должен быть готов</span><input class="field" type="date" name="date"></label>
    <label><span class="field-label">Комментарий к заказу</span><textarea class="field" name="task" rows="3" maxlength="1600" placeholder="Бюджет, условия доставки и подъёма"></textarea></label>
    ${contactFields()}<button class="btn" type="submit">${hasBackend?'Отправить запрос':'Открыть письмо с запросом'}</button>
    <p class="small">Стоимость услуг и способ оплаты согласует менеджер.</p><p class="result" role="status" hidden></p></form>
    <aside class="panel cart-summary"><h2>Состав запроса</h2><div class="summary">${cart.map((row)=>`<div><span>${e(productTitle(row.name))} × ${row.qty} шт.${cartItemDetails(row)?'<small>'+e(cartItemDetails(row))+'</small>':''}</span><span>${rowAmount(row)}</span></div>`).join('')}<div><span>Мебель</span><strong>${furnitureTotal()}</strong></div><div><span>Доставка и другие услуги</span><span>По запросу</span></div></div></aside></div>`,[['Корзина','#/cart']]);
}

let kitPreferences = site.session('kit-preferences',{});
const kitVariantPrices = new Map();
let kitPricesLoading = false;
let kitPriceRevision = 0;
let kitFinishNotice = '';
let roomDraft = site.session('room-plan',{}) || {};
let quotePlan = site.session('quote-plan',null);
let cleanupPlanner;
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
    const product=productById.get(id);
    const options=productDetails.get(id)?.[2] || [];
    const option=group.id==='chair' ? options.find(option=>option[0]===saved.choice) :
      options.find(option=>finishKey(option[1])===finishKey(kitPreferences.finish));
    return {group,id,product,option,choice:option?.[0] || 0,qty:id ? (validSeats(saved.qty) || qty) : 0};
  });
}

function kitFinishes(qty) {
  const selected=kitSelection(qty).filter(item=>item.id && item.group.id!=='chair');
  const finishes=selected.map(item=>{
    const options=productDetails.get(item.id)?.[2] || [];
    return options.filter(option=>options.filter(other=>finishKey(other[1])===finishKey(option[1])).length===1)
      .map(option=>option[1]);
  });
  return finishes.length ? finishes[0].filter(label=>finishes.every(options=>options.some(other=>finishKey(other)===finishKey(label)))) : [];
}

function kitFinishFields(qty) {
  const finishes=kitFinishes(qty);
  const activeFinish=finishes.find(label=>finishKey(label)===finishKey(kitPreferences.finish));
  const chair=kitSelection(qty).find(item=>item.group.id==='chair');
  const options=productDetails.get(chair?.id)?.[2] || [];
  return '<div class="form-two kit-finish-fields">'+
    (finishes.length?finishField('kit-finish','Отделка столов и тумб','Подобрать с менеджером',finishes.map(label=>[label,label]),activeFinish):'')+
    (options.length?finishField('kit-chair-choice','Цвет кресла','Подобрать с менеджером',options,chair.choice):'')+
    '</div>'+(finishes.length?'':'<p class="small">У выбранных моделей нет общей отделки. Измените модель или оставьте подбор менеджеру.</p>');
}

function syncKitFinishes(qty) {
  if (kitPreferences.finish && !kitFinishes(qty).some(label=>finishKey(label)===finishKey(kitPreferences.finish))) {
    kitPreferences.finish='';
    kitFinishNotice='У выбранных моделей другая отделка. Выберите общую отделку или оставьте подбор менеджеру.';
    site.save('kit-preferences',kitPreferences);
  }
  const fields=main.querySelector('#kit-finishes');
  if (fields) fields.innerHTML=kitFinishFields(qty);
}

async function loadKitVariantPrices(qty) {
  const selected=kitSelection(qty).filter(item=>item.choice && !kitVariantPrices.has(item.id+':'+item.choice));
  await Promise.all(selected.map(async item=>{
    const value=await site.variation(item.id,item.choice);
    if (value?.price!=null) kitVariantPrices.set(item.id+':'+item.choice,value);
  }));
}

async function updateKitPrices() {
  const current=++kitPriceRevision;
  kitPricesLoading=true;
  updateEstimate();
  await loadKitVariantPrices(Number(document.querySelector('#set-count').value));
  if (current!==kitPriceRevision) return;
  kitPricesLoading=false;
  updateEstimate();
}

function kitEstimate(qty, destination) {
  const selection = kitSelection(qty);
  const products = selection.filter(item=>item.product && item.qty).map(item=>({...item,
    product:item.option?{...item.product,price:priceOf(item.product,item.option,kitVariantPrices.get(item.id+':'+item.choice)),max:null}:item.product}));
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

function resetKitCounts() {
  for (const group of kitGroups()) if (!group.optional && kitPreferences[group.id]) delete kitPreferences[group.id].qty;
  site.save('kit-preferences',kitPreferences);
}

function currentKitPlan(qty) {
  const plan = kitPreferences.plan;
  const selection=kitSelection(qty);
  if (plan?.v===2) {
    const drawn=workspace.kitFor(plan);
    const estimated=selection.filter(item=>item.id);
    return drawn?.seats===qty && drawn.groups.length===estimated.length && drawn.groups.every(item=>
      estimated.some(line=>line.group.id===item.type && line.id===item.id && line.qty===item.count)) ? plan : null;
  }
  const desk = selection.find(item=>item.group.id==='desk');
  return desk && plan?.seats===qty && plan.desk===desk.id && desk.qty===qty ? plan : null;
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
  syncKitFinishes(count);
  updateKitPrices();
}

function projectPage(target, option, example, qty, useKit, drawnPlan) {
  const planHelp = hasBackend ? 'Приложите план или ТЗ к запросу.' : 'Приложите план или ТЗ к письму перед отправкой.';
  const choices = seatPresets.includes(qty) ? seatPresets : [...seatPresets,qty];
  return `<div class="shell page">${crumbs([['Комплектация офисов']])}<section class="project-hero"><div class="copy"><h1>Комплектация офисов</h1><p class="intro">Подготовим план расстановки и смету, подберём мебель под бюджет и организуем доставку и монтаж.</p><div class="actions"><button class="btn" data-scroll="project-form">Запросить расчёт офиса</button><a class="btn secondary" href="#/project?section=kit">Собрать комплект Riva</a></div><p class="small form-hint">${officeBrief} ${planHelp}</p></div><div class="project-hero-photo brand-photo">${photo('./assets/meeting.webp','Стол и кресла в переговорной')}</div></section>
    <section class="panel project-design"><h2>Бесплатный дизайн-проект офиса</h2><p>Пришлите план помещения или договоритесь с менеджером о замере. Покажем расстановку мебели до поставки и подготовим смету под ваш бюджет. Можно обсудить проект в нашем шоуруме.</p><a class="text-link" href="#/showroom">Спланировать визит</a></section>
    <div class="project-demo ${useKit?'kit-first':'quote-first'}"><section class="panel" id="kit-builder" tabindex="-1"><h2>Соберите комплект Riva</h2><p class="small">Выберите модели и количество. При смене числа мест количество столов и кресел пересчитывается.</p>
      <label class="field-label" for="set-count">Количество рабочих мест</label><select class="field" id="set-count">${choices.map(count=>`<option value="${count}" ${count===qty?'selected':''}>${seatsLabel(count)}</option>`).join('')}</select><div class="kit-choices">${kitRows(qty)}</div><div id="kit-finishes">${kitFinishFields(qty)}</div><div class="summary" id="estimate" aria-live="polite"></div>
      <div id="kit-availability"></div><p class="small" id="kit-count-note" aria-live="polite"></p>
      <div class="actions kit-actions"><button class="btn" data-check-kit hidden></button><button class="btn secondary" data-save-spec>Скачать состав</button><button class="btn secondary" data-retry-kit-prices hidden>Обновить цены</button><button class="btn secondary" data-download-kit-plan hidden>Скачать план PNG</button></div>
      <p class="small"><a class="text-link" id="planner-link" href="#/planner?seats=${qty}">Открыть планировщик</a></p></section>
      <form class="panel" id="request-form" data-kind="project" ${drawnPlan?'data-drawn-plan="1"':''} ${productRequestAttributes(target,option)} ${example?'data-case="'+e(example.id)+'"':''}><h2 id="project-form" tabindex="-1">${target?'Запросить расчёт по товару':'Запросить смету'}</h2>
      ${transportNote()}
      ${target?'<p class="quote-context">'+e([productTitle(target.name),option?.[1]].filter(Boolean).join(' · '))+'</p>':''}
      ${example?'<p class="quote-context">Проект для примера · <a class="text-link" href="#/projects/'+e(example.id)+'">'+e(example.name)+' · '+e(example.zone)+'</a></p>':''}
      ${drawnPlan?'<div class="quote-context"><p>План из планировщика · '+e(drawnPlan.width+' × '+drawnPlan.depth+' м')+'</p><div class="actions"><a class="text-link" href="#/planner">Вернуться к плану</a><button class="btn secondary" type="button" data-download-plan>Скачать PNG</button></div><p class="small">'+(hasBackend?'Расстановка сохранится в заявке.':'Приложите PNG к письму перед отправкой.')+'</p></div>':''}
      ${target || drawnPlan?'<input type="hidden" name="kit" value="">':'<label class="field-label" for="request-kit">Что рассчитать</label><select class="field" id="request-kit" name="kit"><option value="">Подбор по моему плану</option><option value="riva" '+(useKit?'selected':'')+' '+(kitEstimate(qty,city).ready?'':'disabled')+'>Комплект Riva</option></select>'}
      <p class="small" id="quote-kit" aria-live="polite"></p>
      <label><span class="field-label">Город</span><input class="field" name="city" maxlength="80" value="${e(city)}" required></label>
      <label><span class="field-label">Адрес и условия подъёма</span><input class="field" name="address" maxlength="250" autocomplete="street-address" placeholder="Улица, этаж, есть ли грузовой лифт"></label>
      <div class="form-two"><label><span class="field-label">${target?'Количество изделий':'Рабочих мест'}</span><input class="field" type="number" name="${target?'quantity':'seats'}" min="1" max="5000" value="${target?1:useKit?qty:drawnPlan && workspace.seats(drawnPlan) || ''}" ${useKit || target?'required':''}></label><label><span class="field-label">${target?'К какой дате нужна мебель':'К какой дате офис должен быть готов'}</span><input class="field" type="date" name="date"></label></div>
      <label><span class="field-label">Задача и бюджет</span><textarea class="field" name="task" rows="3" maxlength="1600" placeholder="Что нужно поставить и какой бюджет вы заложили"></textarea></label>
      ${hasBackend?'<label><span class="field-label">План или ТЗ, PDF или изображение до 8 МБ</span><input class="field" type="file" name="file" accept="application/pdf,image/jpeg,image/png"></label>':''}
      ${contactFields()}<button class="btn" type="submit">${hasBackend?'Отправить запрос':'Открыть письмо для расчёта'}</button>
      <p class="small">В смете подтвердим стоимость с услугами, наличие всей партии и дату завершения монтажа.</p>
      ${!hasBackend?'<p class="small">'+planHelp+'</p>':''}<p class="result" role="status" hidden></p></form></div>
      <section class="section"><div class="section-head"><h2>Этапы комплектации</h2></div><div class="steps">${informationCards(projectStages)}</div></section>
      ${projectSection()}
    </div>`;
}

function updateEstimate() {
  const target = document.querySelector('#estimate');
  if (!target) return;
  const form = document.querySelector('#request-form');
  const qty = Number(document.querySelector('#set-count').value);
  const quote = kitEstimate(qty,form.elements.city.value);
  const priceLabel = (amount, from = false) => amount == null ? 'По запросу' : (from ? 'от ' : '') + format(amount);
  target.innerHTML = quote.products.map(({product,qty,choice,option})=>`<div class="priced-item"><span><a class="text-link" href="#/product/${product.id}${choice?'?variant='+choice:''}">${e(product.name.replace(dimensionPattern,'').trim())}</a><small>${option?e(option[1])+' · ':''}${qty} шт. × ${priceLabel(product.price,product.max>product.price)}</small></span><strong>${priceLabel(product.price==null?null:product.price*qty,product.max>product.price)}</strong></div>`).join('') +
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
  check.hidden = !quote.ready || Boolean(form.dataset.product || form.dataset.drawnPlan);
  check.textContent = 'Проверить наличие на ' + seatsLabel(qty);
  check.disabled=kitPricesLoading;
  document.querySelector('[data-save-spec]').disabled = !quote.ready || kitPricesLoading;
  document.querySelector('[data-retry-kit-prices]').hidden=kitPricesLoading || !quote.products.some(item=>item.choice && item.product.price==null);
  document.querySelector('#planner-link').href = '#/planner?seats=' + qty;
  prepareLinks(document.querySelector('#kit-builder'));
  const usesKit = form.elements.kit.value === officeConfig.workspaceKit?.id;
  if (!form.dataset.completed) form.querySelector('[type="submit"]').disabled=usesKit && kitPricesLoading;
  if (form.elements.seats) form.elements.seats.required = usesKit;
  document.querySelector('#quote-kit').textContent = usesKit
    ? 'Комплект Riva: ' + seatsLabel(qty) + '. Проверим наличие всей партии.'
    : '';
  const adjusted = quote.products.filter(({group,qty:units})=>!group.optional && units!==qty);
  const plan=currentKitPlan(qty);
  const planNote = kitPreferences.plan ? (plan ? (hasBackend?'Схема помещения приложится к смете комплекта.':'Скачайте схему и приложите её к письму.') : 'Схема сохранена в черновике. Примените её снова после изменения состава.') : '';
  document.querySelector('#kit-count-note').textContent = [kitPricesLoading?'Обновляем цены выбранных вариантов…':'',kitFinishNotice,adjusted.length?'Количество изменено вручную · '+adjusted.map(({group,qty:units})=>group.label+' '+units+' шт.').join(', ')+'.':'',planNote].filter(Boolean).join(' ');
  document.querySelector('[data-download-kit-plan]').hidden=plan?.v!==2;
}

function syncQuoteCount(qty) {
  const select = document.querySelector('#set-count');
  if (Number(select.value)!==qty) resetKitCounts();
  for (const option of Array.from(select.options)) {
    if (!seatPresets.includes(Number(option.value)) && Number(option.value)!==qty) option.remove();
  }
  if (!Array.from(select.options).some(option=>Number(option.value)===qty)) select.add(new Option(seatsLabel(qty),qty));
  select.value = String(qty);
  kitPreferences.seats=qty;
  site.save('kit-preferences',kitPreferences);
  syncKitRows(qty);
  updateEstimate();
}

function mountPlanner(args) {
  const qty=validSeats(args.get('seats')) || validSeats(roomDraft.seats) || 8;
  const kit=kitSelection(qty);
  const models=kit.flatMap(({group})=>group.models.map(id=>productById.get(id)).filter(item=>item?.dimensions?.[0] && item.dimensions[1]).map(item=>({
    type:group.id,product:item.id,label:group.id==='desk'?'Riva '+item.name.split(/\s+/)[0]:kitOptionLabel(group.id,item),
    width:item.dimensions[0]/1000,depth:item.dimensions[1]/1000,price:item.price
  })));
  const selectedDesk=kit.find(item=>item.group.id==='desk')?.id;
  const selectedChair=kit.find(item=>item.group.id==='chair')?.id;
  const displayDraft=args.has('seats') && !roomDraft.items?.length ? {...roomDraft,desk:selectedDesk} : roomDraft;
  return officePlanner.mount(main.querySelector('#office-planner'),{
    draft:displayDraft,count:qty,models,defaultDesk:selectedDesk,defaultChair:selectedChair,
    onSave(plan) {
      roomDraft={...plan,seats:workspace.seats(plan)};
      site.save('room-plan',roomDraft);
    },
    onQuote(plan) {
      quotePlan=plan;
      site.save('quote-plan',plan);
      navigate('#/project?plan=1');
    },
    onKit(plan,selection) {
      resetKitCounts();
      kitPreferences.seats=selection.seats;
      kitPreferences.storage={id:0};
      for (const item of selection.groups) kitPreferences[item.type]={id:item.id,...(item.type==='storage'?{qty:item.count}:{})};
      kitPreferences.plan={...plan,seats:selection.seats,desk:selection.desk};
      site.save('kit-preferences',kitPreferences);
      navigate('#/project?section=kit&seats='+selection.seats);
    }
  });
}

function planText(plan) {
  if (!plan?.items) return [];
  const counts=workspace.composition(plan).map(item=>item.label+' — '+item.count+' шт.');
  return [(workspace.offices[plan.office] || 'План помещения')+' · '+plan.width+' × '+plan.depth+' м',...counts];
}

function productRequestAttributes(item, option) {
  if (!item) return '';
  const label = [productTitle(item.name),item.sku && 'арт. '+item.sku,option?.[1]].filter(Boolean).join(' · ');
  return 'data-product="'+item.id+'" data-variant="'+(option?.[0] || '')+'" data-product-label="'+e(label)+'"';
}

function deliveryPage(target, option) {
  return page('Доставка и сборка',`
    <p class="intro">Доставляем мебель по России. В Перми и Пермском крае доставку и монтаж организует наша сервисная служба. Стоимость поставки в другой город рассчитываем по адресу и объёму заказа.</p>
    ${serviceFacts()}
    <section class="section service-details"><div><h2>Ориентиры по срокам</h2><dl class="delivery-timing">${site.delivery.map(([label,time])=>`<div><dt>${e(label)}</dt><dd>${e(time)}</dd></div>`).join('')}</dl><p class="small">Сроки зависят от объёма заказа, адреса объекта и графика фабрик. Для проектов сроки доставки и монтажа согласуем индивидуально и фиксируем в договоре.</p></div>
    <aside class="panel delivery-checklist"><h2>Что нужно для точного расчёта</h2><ul><li>Адрес, этаж и наличие грузового лифта.</li><li>Количество изделий и размеры самых крупных деталей.</li><li>Доступ для разгрузки и желаемая дата готовности.</li></ul>
    <div class="actions">${!target && cart.length?'<a class="btn" href="#/checkout">Рассчитать доставку корзины</a>':''}<button class="btn ${cart.length && !target?'secondary':''}" data-scroll="delivery-form">${target?'Рассчитать для этого товара':'Запросить расчёт доставки'}</button></div></aside></section>
    <section class="section delivery-request">
      <form class="panel" id="request-form" data-kind="project" data-topic="delivery" ${productRequestAttributes(target,option)}><h2 id="delivery-form" tabindex="-1">Запросить расчёт доставки</h2>
      ${transportNote()}${target?'<p class="quote-context">'+e([productTitle(target.name),option?.[1]].filter(Boolean).join(' · '))+'</p>':''}
      <label><span class="field-label">Город</span><input class="field" name="city" maxlength="80" value="${e(city)}" required></label>
      <label><span class="field-label">Адрес, этаж и лифт</span><input class="field" name="address" maxlength="250" autocomplete="street-address" required></label>
      ${target?'<label><span class="field-label">Количество изделий</span><input class="field" type="number" name="quantity" min="1" max="5000" value="1" required></label>':''}
      <label><span class="field-label">${target?'Условия разгрузки и услуги':'Что привезти и какие услуги нужны'}</span><textarea class="field" name="task" rows="3" maxlength="1600" ${target?'':'required'}></textarea></label>
      ${contactFields()}<button class="btn" type="submit">${hasBackend?'Отправить запрос':'Открыть письмо с запросом'}</button>
      <p class="result" role="status" hidden></p></form></section>
    <section class="section"><div class="section-head"><h2>Сборка на объекте</h2></div><div class="steps service-steps">
      <div><h3>Согласуем дату</h3><p>Обычно мебель собирают на объекте при доставке. Сборку мебели для кабинета руководителя можно согласовать на день доставки или на другую дату. Работы проводим в рабочее время по договорённости.</p></div>
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
      <div><h3>Подбор и дизайн-проект</h3><p>Подготовим бесплатный дизайн-проект по плану помещения. Если размеры неизвестны, согласуем выезд на замер.</p><a class="text-link" href="#/project">Рассчитать комплектацию</a></div>
      <div><h3>Доставка, подъём и монтаж</h3><p>Оценим объём, адрес, подъём на этаж и условия сборки. Для проекта согласуем график работ.</p><a class="text-link" href="#/delivery">Тарифы и сроки</a></div>
      <div><h3>Оплата и документы</h3><p>Для организаций подготовим коммерческое предложение, договор и счёт. Возможна оплата с НДС. Работаем с электронным документооборотом.</p><a class="text-link" href="#/contacts">Запросить документы</a></div></div>
    <section class="section service-details"><div><h2>Гарантия и обслуживание</h2><p>Гарантия на мебель составляет до двух лет в зависимости от модели. Срок можно уточнить по артикулу. После окончания гарантии помогаем с обслуживанием и доукомплектацией офиса.</p><p>При повреждении или некомплекте укажите номер заказа и артикул, опишите проблему и приложите фотографии. Если мебель уже собрана, сообщите об этом менеджеру.</p></div>
    <aside class="panel"><h3>Связаться с сервисом</h3><p class="small">Подготовьте номер заказа, чтобы мы быстрее нашли поставку.</p><a class="text-link" href="mailto:${site.email}">${site.email}</a><br><a class="text-link" href="tel:+73422155898">${site.phone}</a></aside></section>
    <section class="panel info-panel"><h2>Офисная мебель на заказ</h2><p>Если нужна мебель нестандартных размеров, пришлите дизайн-проект, эскиз или размеры. Подготовим задание и предварительный расчёт. После согласования эскиза организуем изготовление, доставку и монтаж.</p><div class="actions"><a class="btn secondary" href="#/project">Запросить расчёт</a></div></section>`);
}

function contactsPage(showroom) {
  const contacts = officeConfig.contacts;
  const address = contacts?.address || 'Пермь, ул. Екатерининская, 10';
  const hours = contacts?.hours || '';
  const mapId = contacts?.mapId || '220992897587';
  const mapLink = 'https://yandex.ru/maps/org/grand_ofis/'+mapId+'/';
  const mapParams = new URLSearchParams({oid:mapId,ol:'biz',z:'16'});
  if (contacts?.coordinates) mapParams.set('ll',contacts.coordinates.join(','));
  const mapFrame = 'https://yandex.ru/map-widget/v1/?'+mapParams;
  if (showroom) {
    const directions = contacts?.coordinates ?
      'https://yandex.ru/maps/?'+new URLSearchParams({rtext:'~'+[...contacts.coordinates].reverse().join(',')}) : mapLink;
    return page('Шоурум',`<p class="intro">Приезжайте посмотреть мебель вживую, посидеть в креслах и оценить, удобно ли вам за столом. В шоуруме можно сравнить образцы отделки и обсудить планировку офиса.</p>
      <section class="contacts-grid showroom-visit" aria-labelledby="showroom-visit-title"><div class="panel"><h2 id="showroom-visit-title">Спланируйте визит</h2>
        <dl class="contact-details"><div><dt>Адрес</dt><dd>${e(address)}</dd></div>
        ${hours?'<div><dt>График</dt><dd>'+e(hours)+'</dd></div>':''}${contacts?.stop?'<div><dt>Ближайшая остановка</dt><dd>'+e(contacts.stop)+'</dd></div>':''}</dl>
        <p>Вход под вывеской «Гранд-Офис». Для обсуждения проекта возьмите план помещения с размерами и уточните число рабочих мест и дату переезда.</p>
        <div class="actions"><a class="btn" href="tel:+73422155898">Позвонить</a><a class="btn secondary" href="${e(directions)}">Построить маршрут</a></div></div>
        <figure class="showroom-photo">${photo('./assets/company.webp','Фасад Гранд-Офиса на Екатерининской улице','width="1158" height="850"')}<figcaption>Офис «Гранд-Офис» на Екатерининской, 10</figcaption></figure></section>
      <section class="section" aria-labelledby="showroom-map-title"><div class="section-head"><h2 id="showroom-map-title">Как найти вход</h2>
        <a class="text-link" href="${e(mapLink)}">Карточка на Яндекс Картах</a></div>
        <div class="showroom-directions"><div class="contact-map"><iframe title="Яндекс Карта — Гранд-Офис на Екатерининской, 10" src="${e(mapFrame)}" loading="lazy" allowfullscreen></iframe></div>
        <div class="showroom-approach"><figure class="showroom-photo">${photo('./assets/original-home/showroom-map-1.webp','Подход к зданию по Екатерининской улице','loading="lazy" width="960" height="720"')}<figcaption>Подход со стороны Екатерининской</figcaption></figure>
        <figure class="showroom-photo">${photo('./assets/original-home/showroom-map-2.webp','Вход в Гранд-Офис крупным планом','loading="lazy" width="960" height="720"')}<figcaption>Вход в офис</figcaption></figure>
        <p class="small">Фото входа и подхода · <a class="text-link" href="${e(mapLink)}">Яндекс Карты</a></p></div></div></section>`,[['Контакты','#/contacts']]);
  }
  return page('Контакты',`<p class="intro">Свяжитесь с нами, чтобы подобрать мебель, рассчитать поставку или уточнить условия по заказу.</p>
    <section class="contacts-grid"><div class="panel"><h2>Офис в Перми</h2><dl class="contact-details">
    <div><dt>Адрес</dt><dd>${e(address)}</dd></div><div><dt>Телефон</dt><dd><a class="text-link" href="tel:+73422155898">${site.phone}</a></dd></div><div><dt>Почта</dt><dd><a class="text-link" href="mailto:${site.email}">${site.email}</a></dd></div>
    ${hours?'<div><dt>График</dt><dd>'+e(hours)+'</dd></div>':''}${contacts?.stop?'<div><dt>Ближайшая остановка</dt><dd>'+e(contacts.stop)+'</dd></div>':''}</dl>
    <div class="actions"><a class="btn" href="tel:+73422155898">Позвонить</a><a class="btn secondary" href="${mapLink}">Маршрут и график</a></div></div>
    <div class="contact-map"><iframe title="Яндекс Карта — Гранд-Офис на Екатерининской, 10" src="${e(mapFrame)}" loading="lazy" allowfullscreen></iframe></div></section>
    <section class="section"><div class="section-head"><h2>Как найти офис</h2></div><div class="contacts-grid entrance-grid">${photo('./assets/company.webp','Вход и вывеска Гранд-Офис на Екатерининской улице','loading="lazy" width="1158" height="850"')}
      <div class="panel"><h3>Планируете приехать?</h3><p>Вход под вывеской «Гранд-Офис». Для осмотра конкретной модели или отделки согласуйте визит по телефону.</p><a class="text-link" href="#/showroom">Спланировать визит</a><h3>Для расчёта офиса</h3><p>Пришлите план, число рабочих мест и дату переезда.</p><a class="text-link" href="#/project">Запросить смету</a></div></div></section>`);
}

function aboutPage() {
  return page('О компании',`<p class="intro company-intro">«Гранд-Офис» работает с 2019 года. До основания компании команда занималась офисной мебелью под другим брендом. Помогаем обустроить рабочие места, кабинеты руководителей, переговорные, приёмные и зоны ожидания. Доставляем мебель по России.</p>
    <dl class="company-grid company-figures" aria-label="Гранд-Офис в цифрах">${companyFigures.map(([value,label])=>'<div><dt>'+e(value)+'</dt><dd>'+e(label)+'</dd></div>').join('')}</dl>
    <section class="project-feature about-feature">${photo('./assets/company.webp','Офис компании Гранд-Офис в Перми','loading="lazy" width="1158" height="850"')}
      <div><h2>От замера до готового офиса</h2><p>Готовим план расстановки и смету, подбираем мебель под бюджет и согласуем доставку и монтаж. Помогаем с обслуживанием и доукомплектацией.</p><div class="actions"><a class="btn" href="${officeQuote}">Запросить расчёт офиса</a><a class="text-link" href="#/contacts">Как нас найти</a></div><p class="small form-hint">${officeBrief}</p></div></section>
    <section class="section"><div class="section-head"><h2>Фабрики, поставки и сервис</h2></div><div class="steps">
      <div><h3>Российские и европейские фабрики</h3><p>Работаем напрямую с производителями. Подбираем мебель разного ценового уровня под задачу и бюджет.</p></div>
      <div><h3>Смета до заказа</h3><p>Согласуем список мебели, отделки, стоимость и ориентировочные сроки поставки.</p></div>
      <div><h3>Собственный транспорт и сборка</h3><p>Привозим мебель, собираем и расставляем её по плану. После поставки помогаем с сервисом и доукомплектацией.</p></div></div></section>
    <section class="section"><div class="section-head"><h2>Как проходит заказ</h2></div><div class="steps">${informationCards(projectStages)}</div></section>
    ${projectSection()}
    <section class="section"><h2>Реквизиты</h2><dl class="contact-details"><div><dt>Организация</dt><dd>ООО «ГРАНД-ОФИС»</dd></div><div><dt>ИНН</dt><dd>5904377899</dd></div><div><dt>ОГРН</dt><dd>1195958033700</dd></div></dl><a class="text-link" href="https://grand-office59.ru/privacy-policy/">Политика конфиденциальности</a></section>`);
}

function projectsPage(id) {
  const item = site.projects.find(project=>project.id===id);
  if (item) return page(item.name,`<div class="case-highlight case-detail"><figure class="case-cover">${photo('./assets/'+item.image,item.zone,'width="656" height="505"')}</figure><div class="case-summary"><h2>${e(item.zone)}</h2><p>${e(item.description)}</p><a class="btn" href="#/project?case=${item.id}">Рассчитать похожий офис</a></div></div>
      <section class="spec"><h2>Мебель в кадре</h2><dl>${item.items.map(([zone,furniture])=>`<div><dt>${e(zone)}</dt><dd>${e(furniture)}</dd></div>`).join('')}</dl></section>
      <section class="section"><div class="section-head"><h2>Другие проекты</h2></div>${projectShowcase(item.id)}</section>`,[['Проекты','#/projects']]);
  return page('Выполненные проекты',`<p class="intro">Посмотрите клиентские залы, открытые офисы и рабочие зоны из портфолио. Для своего помещения можно собрать мебель и проверить расстановку по размерам комнаты.</p><div class="section">${projectShowcase()}</div>
    <section class="project-feature kit-hero">${photo('./assets/riva-interior.webp','Рабочая мебель Riva в офисе','loading="lazy"')}<div><h2>Расстановка для вашего офиса</h2><p>Задайте размеры помещения, расставьте мебель и отправьте план на расчёт.</p><a class="btn" href="#/planner">Открыть планировщик</a></div></section>`);
}

function infoPage(key,id) {
  if (key==='service') return servicePage();
  if (key==='about') return aboutPage();
  if (key==='contacts' || key==='showroom') return contactsPage(key==='showroom');
  if (key==='projects') return projectsPage(id);
  return page('Страница не найдена','<p class="intro"><a class="text-link" href="#/">Вернуться на главную</a></p>');
}

function currentRoute() {
  if (location.hash.startsWith('#/')) return location.hash;
  return pathRouting ? history.state?.grandRoute || document.documentElement.dataset.route : location.hash;
}

function getRoute(address = currentRoute()) {
  const [route, args] = address.replace(/^#\/?/,'').split('?');
  const [routeKey,id] = route.split('/');
  const key = routeKey==='catalog-preview' ? 'catalog' : routeKey;
  if (key==='projects' && id==='workspace-layout') return {key:'planner',args:new URLSearchParams(args)};
  return {key,id,args:new URLSearchParams(args)};
}

function hrefFor(address) {
  const {key,id,args} = getRoute(address);
  let path = officeConfig.paths?.[key];
  if (key==='product') {
    const item = productById.get(Number(id)) || catalogueById.get(Number(id));
    path = item?.url ? new URL(item.url,site.original).pathname : '/product/'+id+'/';
    args.delete('from');
  }
  if (key==='projects' && id) path += id+'/';
  if (key==='catalog') {
    if (args.get('p')==='1') args.delete('p');
    const category = args.get('c');
    if (Object.hasOwn(productTypes,category)) {
      if (!args.has('t')) args.set('t',category);
      args.delete('c');
    } else if (category) {
      const chosen=selectedCategory(category);
      if (chosen) {
        const levels=[];
        for (let entry=chosen; entry?.slug && levels.length<12; entry=catById.get(entry.parent)) levels.unshift(encodeURIComponent(entry.slug));
        path=chosen.path || '/product-category/'+levels.join('/')+'/';
      } else if (catalogDepartments.some(([, , slug])=>slug===category)) {
        path='/product-category/'+encodeURIComponent(category)+'/';
      } else {
        path='/catalog/'+encodeURIComponent(category)+'/';
      }
      args.delete('c');
    }
  }
  return path ? path + (args.size ? '?'+args : '') : address;
}

function prepareLinks(container) {
  if (!pathRouting) return;
  for (const anchor of container.querySelectorAll('a[href^="#/"]')) {
    const route=anchor.getAttribute('href');
    anchor.dataset.route=route;
    anchor.href=hrefFor(route);
  }
}

function navigate(address) {
  if (!pathRouting) {location.hash=address;return;}
  if (address === currentRoute()) return;
  history.pushState({grandRoute:address},'',hrefFor(address));
  onRouteChange();
}

function captureCatalogScroll(address, selector, focusSelector) {
  if (address===currentRoute() || getRoute().key!=='catalog' || getRoute(address).key!=='catalog') return;
  const anchor=main.querySelector(selector) || main.querySelector('h1');
  if (!anchor) return;
  const fields=main.querySelector('.catalog-filter-fields');
  pendingCatalogScroll={
    route:address,selector:anchor.matches(selector)?selector:'h1',top:anchor.getBoundingClientRect().top,
    scrollLeft:anchor.scrollLeft,focusSelector,
    filtersOpen:main.querySelector('.catalog-filters')?.open,
    browseOpen:main.querySelector('.collection-browse-filters')?.open,
    filterSections:[...main.querySelectorAll('.filter-section')].map(section=>section.open),
    filterScroll:fields?.scrollTop || 0,
    directoryOpen:main.querySelector('.catalog-directory')?.open,
    directoryScroll:main.querySelector('.catalog-directory nav')?.scrollTop || 0
  };
}

function restoreCatalogScroll(state) {
  const browse=main.querySelector('.collection-browse-filters');
  if (browse && state.browseOpen!==undefined) browse.open=state.browseOpen;
  const filters=main.querySelector('.catalog-filters');
  if (filters && state.filtersOpen!==undefined) filters.open=state.filtersOpen;
  main.querySelectorAll('.filter-section').forEach((section,index)=>{
    if (state.filterSections[index]!==undefined) section.open=state.filterSections[index];
  });
  const fields=main.querySelector('.catalog-filter-fields');
  if (fields) fields.scrollTop=state.filterScroll;
  const directory=main.querySelector('.catalog-directory');
  if (directory && state.directoryOpen!==undefined) {
    directory.open=state.directoryOpen;
    directory.querySelector('nav').scrollTop=state.directoryScroll;
  }
  const anchor=main.querySelector(state.selector) || main.querySelector('h1');
  const focus=state.focusSelector && main.querySelector(state.focusSelector);
  (focus || main).focus({preventScroll:true});
  if (!anchor) return;
  anchor.scrollLeft=state.scrollLeft;
  window.scrollTo(0,window.scrollY+anchor.getBoundingClientRect().top-state.top);
}

function replaceRoute(address) {
  const position = positions.get(previousRoute);
  history.replaceState(pathRouting ? {...history.state,grandRoute:address} : history.state,'',
    pathRouting ? hrefFor(address) : address);
  if (position!==undefined) positions.set(address,position);
  previousRoute=address;
}

const catalogueById = new Map();
const loadConfig=site.config.then(config=>{officeConfig=config;});
const catalogPageNumber = (settings,total) => Math.min(total,Math.max(1,parseInt(settings.get('p') || '1',10) || 1));
async function loadCollectionDirectory() {
  if (collectionDirectoryReady) return;
  let sections,metadata;
  try {
    [sections,metadata] = await Promise.all([site.getCollections(),catById.size ? null : site.browse('sections')]);
    if (!Array.isArray(sections)) throw new Error('Коллекции недоступны');
    collectionDirectoryError=false;
  } catch(error) {
    collectionDirectoryError=true;
    throw error;
  }
  if (!catById.size && metadata) prepareCategories(metadata.categories);
  if (collectionsById.size || !catById.size) return;
  collectionSections = sections.filter(section=>catById.has(section.id)).map(section=>({...section,
    groups:section.groups.filter(group=>catById.has(group.id)).map(group=>({...group,
      items:group.items.filter(([id])=>catById.has(id)).map(([id,cover,count,types])=>({id,cover,count,types}))}))
  }));
  for (const section of collectionSections) {
    for (const group of section.groups) {
      for (const item of group.items) collectionsById.set(item.id,item);
    }
  }
  collectionDirectoryReady=true;
}

async function loadCatalog(settings) {
  if (!catalog) {
    const raw = hasBackend ? await site.catalog() : await site.browse('sections');
    if (raw && !catalog) {
      catalog=raw;
      if (!catById.size) prepareCategories(raw.categories);
      if (hasBackend) {
        catalogItems=raw.items.map(fromProduct);
        for (const item of catalogItems) catalogueById.set(item.id,item);
      }
    }
  }
  if (!catalog || hasBackend) return null;
  const chosen = selectedCategory(settings.get('c'));
  if (showDepartmentIndex(settings) || showCollections(settings,chosen)) return null;
  const kind = settings.get('t');
  const scope = chosen && kind ? '' : chosen?.id || kind || 'all';
  const filtered = ['q','sort',...filterFields].some(key=>settings.get(key)) || catalogFacts.affectedTypes.includes(kind);
  if (!filtered && Object.hasOwn(catalog.previews,scope)) {
    const count=catalog.previews[scope];
    const number=catalogPageNumber(settings,Math.max(1,Math.ceil(count/pageSize)));
    try {
      if (number===1) return await site.browse(scope);
      const index=number-2;
      const block=Math.floor(index/catalogPagesPerFile);
      const rows=await site.browse('pages/'+scope+'-'+block);
      const start=index%catalogPagesPerFile*pageSize;
      return {count,rows:rows.slice(start,start+pageSize)};
    } catch {}
  } else if (!filtered && chosen && !kind) {
    if (chosen.empty) return {count:0,rows:[]};
    try {
      const chunk=await site.browse('small/'+Math.floor(chosen.id/smallCatalogBucket));
      const rows=chunk[chosen.id];
      const number=catalogPageNumber(settings,Math.max(1,Math.ceil(rows.length/pageSize)));
      return {count:rows.length,rows:rows.slice((number-1)*pageSize,number*pageSize)};
    } catch {}
  }
  catalogItems ??= (await site.browse('index')).map(fromBrowse);
  return null;
}

async function loadDetail(id) {
  if (!Number.isInteger(id) || id<1) return null;
  const data = await site.getDetails(id).catch(()=>null);
  if (data) productDetails.set(id,data);
  if (data?.[6]) productById.set(id,fromProduct(data[6]));
  return data;
}

async function loadProjectItems(product) {
  await loadConfig;
  if (!hasBackend) {
    const entries = await site.getFeatured();
    for (const row of entries) if (!productById.has(row[0])) productById.set(row[0],fromProduct(row));
  }
  const ids = [...new Set([...kitGroups().flatMap(group=>group.models),product].filter(Boolean))];
  await Promise.all(ids.filter(id=>!productDetails.has(id)).map(loadDetail));
}

function productChoiceFor(id, args, [,specs=[],options=[]]=[]) {
  const colorVariants=productHasColorVariants(id,specs,options);
  const first = colorVariants ? options.find(([,label])=>label)[0] : null;
  if (args.has('variant')) {
    const requested=Number(args.get('variant'));
    if (options.some(([choice])=>choice===requested)) return requested;
  }
  const selectedFinish=optionForFinish(options,args.get('finish'));
  if (selectedFinish) return selectedFinish[0];
  const origin = catalogOrigin(args.get('from'));
  const finish = origin && getRoute(origin).args.get('finish');
  const filtered=finishesFor(id).some(label=>finishKey(label)===finishKey(finish)) && optionForFinish(options,finish);
  if (filtered) return filtered[0];
  const saved=site.session('selected-'+id,null);
  return options.some(([choice])=>choice===saved) ? saved : first;
}

async function render(move = false, catalogScroll) {
  saveRequestDraft();
  const current = ++revision;
  main.inert=true;
  main.setAttribute('aria-busy','true');
  const {key,id,args} = getRoute();
  const swatches=['catalog','product','project'].includes(key) && loadFinishSwatches();
  const product = Number(id);
  const target = Number(args.get('product'));
  const example = key==='project' ? site.projects.find(item=>item.id===args.get('case')) : null;
  const useKit = key==='project' && args.get('section')==='kit' && !target;
  const openProjectForm = key==='project' && args.get('section')==='form';
  const projectSeats=validSeats(args.get('seats')) || validSeats(kitPreferences.seats) || 4;
  const drawnPlan=key==='project' && !target && !useKit && args.get('plan')==='1' && quotePlan?.v===2 ? quotePlan : null;
  let details, variant, quoteOption, productChoice, correctedRoute;
  let catalogOptions, preview, catalogError=false;

  document.querySelectorAll('[data-nav]').forEach(a=> a.dataset.nav===key ? a.setAttribute('aria-current','page'):a.removeAttribute('aria-current'));
  const search = document.querySelector('#search-input');
  if (key==='catalog') {
    const loading=main.querySelector('.count-label');
    if (loading) loading.textContent='Обновляем каталог…';
    search.value=args.get('q') || '';
    if (!catalog && !main.querySelector('h1')) main.innerHTML = '<p class="shell page" role="status">Загрузка каталога…</p>';
    catalogOptions=catalogSettings(args);
    try {
      await Promise.all([loadCollectionDirectory(),loadCatalogFacts()]);
      const category = selectedCategory(catalogOptions.get('c'));
      if (category && catalogOptions.has('t') && !scopeTypes(category).includes(catalogOptions.get('t'))) {
        catalogOptions.delete('t');
        catalogOptions.delete('p');
        catalogOptions.delete('use');
        catalogOptions.delete('shape');
        correctedRoute=catalogLink(catalogOptions);
      }
      preview=await loadCatalog(catalogOptions);
    } catch { catalogError=true; }
  } else if (key==='project' || key==='planner') {
    await loadProjectItems();
    if (key==='project') {
      if (kitPreferences.finish && !kitFinishes(projectSeats).some(label=>finishKey(label)===finishKey(kitPreferences.finish))) {
        kitPreferences.finish='';
        kitFinishNotice='Выберите общую отделку выбранных моделей.';
        site.save('kit-preferences',kitPreferences);
      }
      await loadKitVariantPrices(projectSeats);
    }
    if (target) details=await loadDetail(target);
  } else if (key==='delivery') {
    await loadConfig;
    if (target) details=await loadDetail(target);
  } else if (key==='product') {
    await loadCatalogFacts().catch(()=>null);
    [details] = await Promise.all([loadDetail(product),loadCollectionDirectory().catch(()=>null),loadConfig,swatches]);
    productChoice=productChoiceFor(product,args,details || []);
    if (productChoice) variant = await site.variation(product,productChoice);
  } else await loadConfig;
  if (swatches) await swatches;
  if (current!==revision) return;
  main.inert=false;
  main.removeAttribute('aria-busy');
  if (correctedRoute) replaceRoute(correctedRoute);
  cleanupPlanner?.();
  cleanupPlanner=null;
  if (target) quoteOption=details?.[2]?.find(option=>option[0]===Number(args.get('variant')));
  if (!key || key==='main') main.innerHTML=home();
  else if (key==='catalog') main.innerHTML=collectionDirectoryError
    ? page('Коллекции','<p class="intro">Не удалось загрузить коллекции. Проверьте соединение и повторите загрузку.</p><button class="btn" type="button" data-retry-catalog>Повторить загрузку</button>')
    : catalogPage(catalogOptions,preview,catalogError || !catalog);
  else if (key==='project') {
    main.innerHTML=projectPage(productById.get(target),quoteOption,example,projectSeats,useKit,drawnPlan);
    if (!useKit) document.querySelector('#kit-builder').before(document.querySelector('#request-form'));
    updateEstimate();
  } else if (key==='planner') {
    main.innerHTML=page('Планировщик офиса','<p class="intro">Задайте размеры комнаты, расставьте мебель и отправьте схему на расчёт.</p><div class="planner-grid" id="office-planner"></div>');
    cleanupPlanner=mountPlanner(args);
  } else if (key==='product' && productById.has(product)) main.innerHTML=itemPage(productById.get(product),details,variant,args.get('from'),productChoice);
  else if (key==='cart') main.innerHTML=cartPage();
  else if (key==='checkout') main.innerHTML=checkoutPage();
  else if (key==='delivery') main.innerHTML=deliveryPage(productById.get(target),quoteOption);
  else main.innerHTML=infoPage(key,id);
  restoreRequestDraft();
  if (main.querySelector('#estimate')) updateEstimate();
  if (useKit) {
    const kit=document.querySelector('#kit-builder');
    kit?.focus({preventScroll:true});
    kit?.scrollIntoView({block:'start'});
  } else if (openProjectForm || move && (key==='project' && (target || example || drawnPlan) || key==='delivery' && target)) {
    const form=document.querySelector('#request-form h2');
    form?.focus({preventScroll:true});
    form?.scrollIntoView({block:'start'});
  } else if (move) {
    if (catalogScroll) restoreCatalogScroll(catalogScroll);
    else {
      main.focus({preventScroll:true});
      window.scrollTo(0,positions.get(currentRoute()) || 0);
    }
  }
  prepareLinks(main);
  if (pathRouting) {
    prepareLinks(document.querySelector('.site-header'));
    prepareLinks(document.querySelector('#mobile-menu'));
    prepareLinks(document.querySelector('.footer'));
    document.querySelector('.skip').href=location.pathname+location.search+'#main';
    const canonical=document.querySelector('link[rel="canonical"]');
    if (canonical && key!=='missing') {
      const address=new URL(hrefFor(currentRoute()),canonical.href);
      const number=Number(address.searchParams.get('p'));
      const paged=key==='catalog' && number>1 && [...address.searchParams.keys()].every(param=>param==='p');
      address.search=paged?'?p='+number:'';
      canonical.href=address.href;
    }
  }
  main.querySelectorAll('.project-track').forEach(syncCarousel);
  const heading = main.querySelector('h1')?.textContent;
  document.title = !key || key==='main' ? 'Гранд-Офис — офисная мебель и комплектация офисов в Перми'
    : heading ? heading + ' — Гранд-Офис' : 'Гранд-Офис';
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
  const plan = currentKitPlan(qty);
  const layout = plan && workspace.layouts.find(([key])=>key===plan.layout);
  return ['Комплект Riva на ' + seatsLabel(qty),
    ...quote.products.map(({product,qty,option})=>[product.name,product.sku ? 'арт. '+product.sku:'',option?.[1],qty+' шт.',money(product.price,product.max)].filter(Boolean).join(' · ')),
    ...pricing,
    ...(plan?.v===2 ? planText(plan).slice(0,1) : layout ? ['Помещение: '+plan.width+' × '+plan.depth+' м. '+layout[1]+', расстояние '+plan.gap+' м.'] : [])];
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
main.addEventListener('toggle',event=>{
  const branch=event.target;
  if (!branch.open || !branch.dataset.category) return;
  const body=branch.querySelector('div');
  if (body.children.length>1) return;
  const settings=catalogSettings(getRoute().args);
  const children=catChildren.get(Number(branch.dataset.category)) || [];
  body.insertAdjacentHTML('beforeend',categoryItems(children,selectedCategory(settings.get('c')),settings));
  prepareLinks(body);
},true);
window.addEventListener('resize',()=>main.querySelectorAll('.project-track').forEach(syncCarousel));

function rememberCollectionSource(anchor) {
  if (!anchor?.matches('[data-collection-result]')) return;
  const address=anchor.dataset.route || anchor.getAttribute('href');
  const route=catalogLink(getRoute(address).args,{backy:String(Math.round(window.scrollY))});
  if (pathRouting) {anchor.dataset.route=route;anchor.href=hrefFor(route);}
  else anchor.href=route;
}
function showFinishName(field, button) {
  field.querySelector('.finish-name').textContent=button?.dataset.finishValue ? button.dataset.finishLabel : '';
}
function resetFinishName(field) {
  showFinishName(field,field.querySelector('[data-finish-value][aria-pressed="true"]'));
}

async function previewProductFinish(card, control) {
  const id=Number(card.dataset.productId);
  const label=control.dataset.finishLabel;
  const gallery=card.querySelector('.product-photo');
  const price=card.querySelector('.price');
  const status=card.querySelector('[data-product-preview-status]');
  const isCurrent=()=>card.isConnected && control.getAttribute('aria-pressed')==='true';
  for (const link of [gallery,card.querySelector('h3 a')]) {
    const {args}=getRoute(link.dataset.route || link.getAttribute('href'));
    args.set('finish',label);
    link.href='#/product/'+id+'?'+args;
  }
  prepareLinks(card);
  const basePhoto=gallery.dataset.basePhoto;
  if (gallery.querySelector('img')?.getAttribute('src')!==basePhoto) gallery.innerHTML=cardPhoto(basePhoto);
  price.textContent=price.dataset.basePrice;
  status.textContent='Загружаем фото отделки «'+label+'».';

  const detail=await site.getDetails(id).catch(()=>null);
  const option=optionForFinish(detail?.[2] || [],label);
  if (!isCurrent()) return;
  const variant=option && await site.variation(id,option[0]);
  if (!isCurrent()) return;
  const amount=variant?.price ?? option?.[2];
  if (amount!=null) price.textContent=money(amount);
  if (variant?.image) {
    const image=new Image();
    image.src=variant.image;
    const loaded=await image.decode().then(()=>true,()=>false);
    if (!isCurrent()) return;
    if (loaded) {
      gallery.innerHTML=cardPhoto(variant.image);
      status.textContent='Показано фото отделки «'+label+'».';
      return;
    }
  }
  status.textContent='Отделка «'+label+'». Показано общее фото модели.';
}

main.addEventListener('mouseover',event=>{
  const button=event.target.closest('[data-finish-value]');
  if (button) showFinishName(button.closest('.finish-field'),button);
});
main.addEventListener('mouseout',event=>{
  const button=event.target.closest('[data-finish-value]');
  if (button && !button.contains(event.relatedTarget)) resetFinishName(button.closest('.finish-field'));
});
main.addEventListener('focusin',event=>{
  const button=event.target.closest('[data-finish-value]');
  if (button) showFinishName(button.closest('.finish-field'),button);
});
main.addEventListener('focusout',event=>{
  const button=event.target.closest('[data-finish-value]');
  if (button) resetFinishName(button.closest('.finish-field'));
});
main.addEventListener('pointerdown',event=>rememberCollectionSource(event.target.closest('a')));
main.addEventListener('keydown',event=>{if(event.key==='Enter') rememberCollectionSource(event.target.closest('a'));});
main.addEventListener('click', async (event)=>{
  if (event.target.closest('[data-retry-kit-prices]')) {
    await updateKitPrices();
    return;
  }
  if (event.target.closest('[data-retry-catalog]')) {
    await render();
    return;
  }
  const collectionButton=event.target.closest('[data-choose-collection]');
  if (collectionButton) {
    openCollectionPicker(collectionButton);
    return;
  }
  const catalogLinkElement=event.target.closest('a');
  if (catalogLinkElement?.hasAttribute('data-catalog-return')) {
    positions.set(catalogLinkElement.dataset.route || catalogLinkElement.getAttribute('href'),Number(catalogLinkElement.dataset.catalogReturn) || 0);
  }
  if (catalogLinkElement && event.button===0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    const areas=[
      '.catalog-mode-nav','.catalog-collection-segments','.collection-classes','.catalog-type-tabs nav',
      '.applied-filters','.reset-filters','.catalog-results .empty','.collection-tools + .empty',
      '.catalog-subsections','.catalog-directory'
    ];
    const area=areas.find(selector=>catalogLinkElement.closest(selector));
    if (area) {
      const selector=['.applied-filters','.catalog-results .empty'].includes(area)?'.catalog-heading':
        area==='.reset-filters'?'.catalog-filters':
        area==='.collection-tools + .empty'?'#collection-search':area;
      const focus=event.detail===0?selector+' a[aria-current="page"]':null;
      captureCatalogScroll(catalogLinkElement.dataset.route || catalogLinkElement.getAttribute('href'),selector,focus);
    }
  }
  const control=event.target.closest('button');
  if (!control) return;
  if (control.hasAttribute('data-finish-value')) {
    const field=control.closest('.finish-field');
    const select=field.querySelector('select');
    const product=control.closest('.product[data-product-id]');
    if (product && control.getAttribute('aria-pressed')==='true') return;
    field.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed','false');
    control.setAttribute('aria-pressed','true');
    showFinishName(field,control);
    if (select && select.value!==control.dataset.finishValue) {
      select.value=control.dataset.finishValue;
      select.dispatchEvent(new Event('change',{bubbles:true}));
    } else if (product) await previewProductFinish(product,control);
    return;
  }
  const {photo, add, remove, scroll} = control.dataset;
  if (control.dataset.cartStep) {
    const input = control.closest('.cart-stepper').querySelector('[data-qty]');
    updateCartQuantity(input,input.valueAsNumber+Number(control.dataset.cartStep));
    return;
  }
  if (control.hasAttribute('data-copy-request')) {
    const text = control.closest('.result').querySelector('.request-copy-text');
    try {
      await navigator.clipboard.writeText(text.value);
      control.textContent='Текст скопирован';
    } catch {
      text.hidden=false;
      text.focus();
      text.select();
    }
    return;
  }
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
  if (control.hasAttribute('data-download-plan') && quotePlan?.items) workspace.download(quotePlan);
  if (control.hasAttribute('data-download-kit-plan')) {
    const plan=currentKitPlan(Number(document.querySelector('#set-count').value));
    if (plan?.items) workspace.download(plan);
  }
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
  const origin = catalogOrigin(getRoute().args.get('from'));
  const result = main.querySelector('#cart-result');
  const item = productById.get(Number(add));
  const choice = Number(document.querySelector('#product-option')?.value || 0);
  const data = await site.getDetails(item.id).catch(()=>null);
  const option = data?.[2]?.find(o=>o[0]===choice);
  const variation = option ? await site.variation(item.id,choice) : null;
  const key = item.id + ':' + choice;
  const row=cart.find(r=>r.key===key);
  const cap = variation?.stock ?? option?.[3] ?? (hasBackend && !data?.[2]?.length ? data?.[5] : null) ?? 999;
  if (!cap || row?.qty>=Math.min(cap,999)) {
    if (result) {
      result.hidden=false;
      result.textContent=cap ? 'В корзине уже максимально доступное количество.' : 'Товар сейчас недоступен.';
    }
    return;
  }
  if (row) row.qty=Math.min(cap,999,row.qty+1);
  else cart.push({key,id:item.id,choice,variant:option?.[1],name:item.name,sku:item.sku,image:variation?.image || item.image,price:priceOf(item,option,variation),qty:1,cap});
  if (origin) site.save('basket-origin',origin);
  saveCart();
  if (result) {
    result.hidden=false;
    result.innerHTML='Товар добавлен. <a class="text-link" href="#/cart">Открыть корзину</a>';
    prepareLinks(result);
  }
});
main.addEventListener('change',event=>{
  const element=event.target;
  if (element.form?.id==='request-form') saveRequestDraft(element.form);
  if (element.id==='catalog-sort' || element.id==='catalog-finish') {
    const key = element.id==='catalog-sort' ? 'sort' : 'finish';
    const address=catalogLink(catalogSettings(getRoute().args),{[key]:element.value,p:null,...(key==='finish'?{changedfinish:null}:{})});
    captureCatalogScroll(address,key==='sort'?'.catalog-heading':'.catalog-type-tabs',
      key==='sort'?'#catalog-sort':'.catalog-finish [aria-pressed="true"]');
    navigate(address);
  }
  if (element.id==='set-count') {
    const form = document.querySelector('#request-form');
    resetKitCounts();
    kitPreferences.seats=Number(element.value);
    site.save('kit-preferences',kitPreferences);
    if (form.elements.seats && form.elements.kit.value) form.elements.seats.value=element.value;
    syncKitRows(Number(element.value));
    updateEstimate();
  }
  if (element.id==='kit-finish' || element.id==='kit-chair-choice') {
    if (element.id==='kit-finish') {kitPreferences.finish=element.value;kitFinishNotice='';}
    else kitPreferences.chair={...(kitPreferences.chair || {}),choice:Number(element.value)};
    site.save('kit-preferences',kitPreferences);
    updateKitPrices();
  }
  if (element.name==='kit') {
    if (element.value) {
      const qty=validSeats(element.form.elements.seats.value) || Number(document.querySelector('#set-count').value);
      element.form.elements.seats.value=qty;
      syncQuoteCount(qty);
    } else updateEstimate();
  }
  if (element.dataset.kitModel || element.dataset.kitQty) updateKitChoice(element);
  if (element.id==='product-option') {
    const choice=Number(element.value);
    site.save('selected-'+element.dataset.id,choice);
    const {args} = getRoute();
    const origin = catalogOrigin(args.get('from'));
    if (args.has('variant') || args.has('finish') || origin && getRoute(origin).args.has('finish')) {
      args.delete('finish');
      args.set('variant',String(choice));
      replaceRoute('#/product/'+element.dataset.id+'?'+args);
    }
    const button = main.querySelector('[data-add]');
    const quote = main.querySelector('[data-item-quote]');
    const status = main.querySelector('#variant-status');
    if (button) button.disabled = true;
    if (quote) {
      quote.setAttribute('href','#/project?product='+element.dataset.id+(choice?'&variant='+choice:''));
      prepareLinks(quote.parentElement);
    }
    if (status && choice) {status.hidden=false;status.textContent='Загружаем фото и цену варианта…';}
    render().then(()=>{
      const select=document.querySelector('#product-option');
      const focus=select?.hidden ? select.closest('.finish-field').querySelector('[aria-pressed="true"]') : select;
      focus?.focus({preventScroll:true});
    });
  }
  if ('qty' in element.dataset) updateCartQuantity(element,element.valueAsNumber);
});

main.addEventListener('input',event=>{
  const input=event.target;
  if (input.form?.id==='request-form') {
    if (input.name==='contact') validateRequestContact(input.form);
    saveRequestDraft(input.form);
  }
  if (input.form?.id==='filters' && rangeFields.includes(input.name)) {
    const form=input.form;
    for (const key of rangeFields) form.elements[key].setCustomValidity('');
    const unknown=form.elements.unknown;
    unknown.disabled=!dimensionFields.some(key=>form.elements[key].value!=='');
    if (unknown.disabled) unknown.checked=false;
  }
  if (input.form?.dataset.kind!=='project') return;
  if (input.name==='city') updateEstimate();
  if (input.name==='seats' && input.form.elements.kit?.value && validSeats(input.value)) syncQuoteCount(validSeats(input.value));
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
  const lines = [requestTitle(kind,data),'Имя: '+data.name,'Контакт: '+data.contact,'Город: '+data.city];
  if (kind==='order') {
    lines.push('Адрес: '+(data.address||'уточняется'),'Получение: '+data.delivery,
      ...cart.map(row=>[productTitle(row.name),cartItemDetails(row),row.qty+' шт.',rowAmount(row)].filter(Boolean).join(' · ')),
      'Мебель по расчёту сайта: '+furnitureTotal(),
      data.date?'Дата готовности офиса после монтажа: '+data.date.split('-').reverse().join('.'):'',
      data.task?'Комментарий к заказу: '+data.task:'',
      'Просьба подтвердить наличие, итоговую стоимость и срок поставки с учётом услуг.');
  }
  else {
    if (data.seats) lines.push('Рабочих мест: '+data.seats);
    if (data.date) lines.push((data.product?'Желаемая дата: ':'Дата готовности офиса после монтажа: ')+data.date.split('-').reverse().join('.'));
    if (data.address) lines.push('Адрес и подъём: '+data.address);
    if (data.task) lines.push('Задача: '+data.task);
    if (data.example) lines.push('Проект для примера: '+data.example);
    if (data.kit && data.kit===officeConfig.workspaceKit?.id) lines.push(...kitSummary(Number(data.seats),data.city));
    else if (data.product) lines.push('Товар: '+data.product,'Количество: '+data.quantity+' шт.');
    if (data.roomPlan?.v===2) {
      if (!data.kit) lines.push(...planText(data.roomPlan));
      lines.push('Схема подготовлена в планировщике. Файл PNG приложу к письму.');
    }
    lines.push(data.topic==='delivery'?'Просьба подтвердить стоимость услуг и сроки доставки.':'Просьба подтвердить наличие, итоговую стоимость и срок поставки с учётом услуг.');
  }
  return lines.filter(Boolean).join('\n');
}
const requestTitle=(kind,data)=>kind==='order'?'Запрос расчёта мебели':data.topic==='delivery'?'Запрос расчёта доставки':'Запрос сметы';

main.addEventListener('submit',async(event)=>{
  const form=event.target;
  event.preventDefault();
  if (form.id==='collection-search') {
    const query = form.elements.cq.value.trim();
    const search = collectionSearch(query);
    const settings=catalogSettings(getRoute().args);
    const address=catalogLink(settings,{view:'collections',cq:search.phrase,cp:null,pick:search.intent?query:null});
    captureCatalogScroll(address,'#collection-search','#collection-query');
    navigate(address);
    return;
  }
  if (form.id==='filters') {
    const fromContext=form.dataset.collectionAnchor==='context';
    delete form.dataset.collectionAnchor;
    const settings=catalogSettings(getRoute().args);
    const fields=fromContext ? new URLSearchParams([...settings].filter(([key])=>filterFields.includes(key))) : new FormData(form);
    if (fromContext) fields.set('series',document.querySelector('#catalog-series').value);
    const ranges=getCatalogRanges(fields);
    const reversed=ranges.find(range=>range.min!=null && range.max!=null && range.min>range.max);
    if (reversed) {
      const field=form.elements[reversed.high];
      field.setCustomValidity('Значение «До» должно быть не меньше значения «От».');
      field.reportValidity();
      return;
    }
    const patch={p:null,unknown:null};
    for (const [key,value] of fields) patch[key]=String(value).trim();
    if (!ranges.slice(1).some(hasBounds)) patch.unknown=null;
    const currentCollection=collectionCategory(selectedCategory(settings.get('c')));
    if (Object.hasOwn(patch,'series') && patch.series!==(settings.get('series') || currentCollection?.slug || '')) {
      if (!currentCollection && !selectedSeries(settings.get('series')) && patch.series) {
        patch.back=catalogLink(catalogSourceSettings(settings));
        patch.backy=String(Math.round(window.scrollY));
      }
      if (currentCollection) {
        const source=catalogOrigin(settings.get('back'));
        const sourceCategory=source && selectedCategory(getRoute(source).args.get('c'));
        patch.c=collectionScope(sourceCategory)?sourceCategory.slug:null;
        patch.view='products';
      }
      const chosen=selectedSeries(patch.series);
      const finishes=(catalogFacts.collectionFinishes[chosen?.id] || []).map(index=>catalogFacts.finishes[index]);
      if (settings.get('finish') && !finishes.includes(settings.get('finish'))) {patch.changedfinish=settings.get('finish');patch.finish=null;}
      else patch.changedfinish=null;
    }
    if (currentCollection && patch.series===currentCollection.slug && !settings.has('series')) patch.series=null;
    const address=catalogLink(settings,patch);
    captureCatalogScroll(address,fromContext?'.catalog-type-tabs':'.catalog-filters',fromContext?'.collection-context-links button':'#filters button[type="submit"]');
    navigate(address);
    return;
  }
  if (form.id==='catalog-jump') {
    navigate(catalogLink(catalogSettings(getRoute().args),{p:form.elements.p.value}));
    return;
  }
  if (form.id!=='request-form') return;
  if (form.elements.kit?.value && kitPricesLoading) return;
  if (!validateRequestContact(form)) {form.reportValidity();return;}
  saveRequestDraft(form);
  const data=Object.fromEntries(new FormData(form));
  const kind=form.dataset.kind;
  if (form.dataset.topic) data.topic=form.dataset.topic;
  if (form.dataset.case) {
    data.caseId=form.dataset.case;
    const example=site.projects.find(project=>project.id===data.caseId);
    data.example=example ? example.name+' · '+example.zone : '';
  }
  if (form.dataset.product) {
    data.productId=Number(form.dataset.product);
    data.variantId=Number(form.dataset.variant || 0);
    data.product=form.dataset.productLabel;
  }
  if (data.kit) data.roomPlan=currentKitPlan(Number(data.seats));
  else if (form.dataset.drawnPlan) data.roomPlan=quotePlan;
  const status=form.querySelector('.result');
  if (!hasBackend) {
    const body = mailBody(kind,data);
    const href = site.mail(requestTitle(kind,data),body);
    status.hidden=false;
    status.innerHTML='Письмо готово. Отправьте его на <span class="request-address">'+e(site.email)+'</span>.'+
      '<span class="request-actions"><a class="text-link" href="'+e(href)+'">Открыть письмо</a>'+
      '<button type="button" class="text-link" data-copy-request>Скопировать текст</button></span>'+
      '<textarea class="field request-copy-text" rows="7" aria-label="Текст запроса" readonly hidden></textarea>';
    status.querySelector('textarea').value=body;
    status.scrollIntoView({block:'nearest'});
    location.href=href;
    return;
  }
  const button=form.querySelector('[type="submit"]');
  if (button.disabled) return;
  button.disabled=true;
  form.dataset.token ||= crypto.randomUUID();
  try {
    data.file=await toEncoded(data.file);
    if (kind==='project' && data.kit) {
      data.kitLines=kitEstimate(Number(data.seats),data.city).products.map(({group,product,qty,choice})=>({group:group.id,id:product.id,qty,choice}));
      data.kitFinish=kitPreferences.finish || '';
    }
    const receipt=await site.post('requests',{kind,token:form.dataset.token,...data,lines:kind==='order'?cart.map(({id,choice,qty})=>({id,choice,qty})):[]});
    try {sessionStorage.removeItem(requestDraftKey(form));} catch {}
    status.textContent='Заявка № '+receipt.id+' принята. Менеджер свяжется с вами для подтверждения.';
    if (kind==='order') {cart=[];saveCart();form.dataset.completed='true';}
    form.reset();
    if (form.elements.kit?.value && form.elements.seats) form.elements.seats.value=document.querySelector('#set-count').value;
    updateEstimate();
    delete form.dataset.token;
  } catch (error) { status.textContent=error.message; }
  finally { status.hidden=false;button.disabled=Boolean(form.dataset.completed); }
});

const searchInput = document.querySelector('#search-input');
const searchArea = searchInput.closest('.header-search');
const searchSuggestions = document.querySelector('#search-collections');
let searchRevision = 0;
function hideSearchSuggestions() {
  searchRevision++;
  searchSuggestions.hidden = true;
}
async function showSearchSuggestions() {
  const current = ++searchRevision;
  const value = searchInput.value.trim();
  if (collectionSearchKey(value).length<2) return hideSearchSuggestions();
  try {await Promise.all([loadCollectionDirectory(),loadCatalogFacts().catch(()=>null)]);}
  catch {hideSearchSuggestions();return;}
  if (current!==searchRevision || !searchArea.contains(document.activeElement)) return;
  const search = collectionSearch(value);
  const {matches} = search;
  if (!matches.length) return hideSearchSuggestions();
  const choices = matches.slice(0,5).map(({item,section,group})=>{
    const category = catById.get(item.id);
    return '<a href="'+e(collectionMatchLink(category,search.intent?search.parts:null))+'"><span>'+e(category.name)+'</span><small>'+
      e([section.name,group.label].filter(Boolean).join(' · '))+'</small></a>';
  }).join('');
  const more = collectionSearchLink(search);
  searchSuggestions.innerHTML = '<p>Коллекции</p>'+choices+
    '<a class="search-all-collections" href="'+e(more)+'">Все коллекции по запросу</a>';
  prepareLinks(searchSuggestions);
  searchSuggestions.hidden = false;
}
searchInput.addEventListener('input',showSearchSuggestions);
searchInput.addEventListener('focus',showSearchSuggestions);
searchArea.addEventListener('focusout',event=>{
  if (!searchArea.contains(event.relatedTarget)) hideSearchSuggestions();
});
searchArea.addEventListener('keydown',event=>{
  if (searchSuggestions.hidden) return;
  if (event.key==='Escape') {
    event.preventDefault();
    searchInput.focus();
    hideSearchSuggestions();
  } else if (event.key==='ArrowDown' || event.key==='ArrowUp') {
    const links = [...searchSuggestions.querySelectorAll('a')];
    const index = links.indexOf(document.activeElement);
    const next = event.key==='ArrowDown' ? links[Math.min(index+1,links.length-1)] : links[index-1] || searchInput;
    event.preventDefault();
    next.focus();
  }
});
searchSuggestions.addEventListener('click',event=>{
  if (event.target.closest('a')) hideSearchSuggestions();
});
document.querySelector('#global-search').addEventListener('submit',async event=>{
  event.preventDefault();
  const value = searchInput.value.trim();
  const productRoute = catalogLink('',{q:value,view:'products'});
  const code = looksLikeSku(skuText(value));
  let productMatch;
  try {
    const tasks = [];
    if (collectionSearchKey(value).length>=2) tasks.push(loadCollectionDirectory(),loadCatalogFacts().catch(()=>null));
    if (code) tasks.push(loadCatalogFacts().then(()=>loadCatalog(new URLSearchParams({q:value})))
      .then(()=>{if (catalogItems) productMatch=searchBySku(skuText(value));}));
    await Promise.allSettled(tasks);
  } catch {}
  if (value!==searchInput.value.trim()) return;
  hideSearchSuggestions();
  const search = collectionSearch(value);
  const exact = search.matches.filter(row=>row.rank===3);
  if (productMatch?.exact || productMatch?.similar && !exact.length) return navigate(productRoute);
  const candidates = exact.length ? exact : search.matches;
  if (candidates.length===1) navigate(collectionMatchLink(catById.get(candidates[0].item.id),search.intent?search.parts:null));
  else if (candidates.length>1) navigate(collectionSearchLink(search));
  else navigate(productRoute);
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
const catalogMenu=document.querySelector('.catalog-menu');
const catalogTrigger=document.querySelector('#catalog-trigger');
const catalogPanel=document.querySelector('#header-catalog');
const catalogMenuDepartments=catalogPanel.querySelector('[data-menu-departments]');
const mobileDepartments=document.querySelector('[data-mobile-departments]');
let menuDepartmentsReady=false;
const mobileMenu=document.querySelector('#mobile-menu');
const mobileMenuTrigger=document.querySelector('.mobile-menu-trigger');
const mobileNavigation=matchMedia('(max-width: 720px)');
catalogMenuDepartments.insertAdjacentHTML('beforeend',catalogDepartments.map(department=>
  '<div class="catalog-department-menu-row"><a href="'+e(departmentLink(department))+'">'+e(department[0])+'</a></div>').join(''));
mobileDepartments.innerHTML=catalogDepartments.map(department=>
  '<div class="mobile-department-menu-row"><a href="'+e(departmentLink(department))+'">'+e(department[0])+'</a></div>').join('');

function activateCatalogDepartment(row) {
  if (!row?.querySelector('.catalog-submenu')) return;
  for (const button of catalogMenuDepartments.querySelectorAll('button')) {
    const expanded=button.parentElement===row;
    button.setAttribute('aria-expanded',String(expanded));
    button.nextElementSibling.hidden=!expanded;
  }
}

async function loadMenuDepartments() {
  if (menuDepartmentsReady) return;
  try {await loadCollectionDirectory();} catch {return;}
  if (menuDepartmentsReady) return;
  menuDepartmentsReady=true;
  const desktopRows=catalogMenuDepartments.querySelectorAll('.catalog-department-menu-row');
  const mobileRows=mobileDepartments.querySelectorAll('.mobile-department-menu-row');
  catalogDepartments.forEach(([name,,slug],index)=>{
    const children=departmentSubcategories(slug);
    if (!children.length) return;
    const links=children.map(child=>'<a href="'+e(catalogLink('',{c:child.slug}))+'">'+e(child.name)+'</a>').join('');
    const id='header-department-'+index;
    const label=e('Подразделы: '+name);
    const row=desktopRows[index];
    row.insertAdjacentHTML('beforeend','<button class="catalog-submenu-trigger" type="button" aria-label="'+label+
      '" aria-expanded="false" aria-controls="'+id+'"><i class="chevron" aria-hidden="true"></i></button>'+
      '<nav class="catalog-submenu" id="'+id+'" aria-label="'+label+'" hidden>'+links+'</nav>');
    row.addEventListener('pointerenter',event=>{
      if (event.pointerType==='mouse') activateCatalogDepartment(row);
    });
    row.firstElementChild.addEventListener('focus',()=>activateCatalogDepartment(row));
    mobileRows[index].insertAdjacentHTML('beforeend','<details><summary aria-label="'+label+
      '"><i class="chevron" aria-hidden="true"></i></summary><nav aria-label="'+label+'">'+links+'</nav></details>');
  });
  prepareLinks(catalogMenuDepartments);
  prepareLinks(mobileDepartments);
  if (!catalogPanel.hidden) activateCatalogDepartment(document.activeElement.closest('.catalog-department-menu-row') ||
    [...desktopRows].find(row=>row.matches(':hover')) || desktopRows[0]);
}

mobileMenuTrigger.addEventListener('click',()=>{
  mobileMenu.showModal();
  loadMenuDepartments();
  mobileMenuTrigger.setAttribute('aria-expanded','true');
});
mobileMenu.addEventListener('close',()=>mobileMenuTrigger.setAttribute('aria-expanded','false'));
mobileMenu.addEventListener('click',event=>{
  if (event.target.closest('a')) {
    mobileMenu.close();
  } else if (event.target===mobileMenu) {
    const bounds=mobileMenu.getBoundingClientRect();
    if (event.clientX<bounds.left) mobileMenu.close();
  }
});
mobileNavigation.addEventListener('change',event=>{
  if (!event.matches && mobileMenu.open) mobileMenu.close();
});
function showCatalogMenu(open) {
  catalogTrigger.setAttribute('aria-expanded',String(open));
  catalogPanel.hidden=!open;
  if (open) {
    if (menuDepartmentsReady) activateCatalogDepartment(catalogMenuDepartments.querySelector('.catalog-department-menu-row'));
    else loadMenuDepartments();
  }
}
catalogTrigger.addEventListener('click',()=>showCatalogMenu(catalogPanel.hidden));
catalogTrigger.addEventListener('keydown',event=>{
  if (event.key!=='ArrowDown' || catalogPanel.hidden) return;
  event.preventDefault();
  catalogPanel.querySelector('a')?.focus();
});
catalogMenu.addEventListener('focusout',event=>{
  if (event.relatedTarget && !catalogMenu.contains(event.relatedTarget)) showCatalogMenu(false);
});
catalogPanel.addEventListener('click',event=>{
  const button=event.target.closest('button[aria-controls]');
  if (button) {
    if (button.getAttribute('aria-expanded')==='true') {
      button.setAttribute('aria-expanded','false');
      button.nextElementSibling.hidden=true;
    } else activateCatalogDepartment(button.parentElement);
  } else if (event.target.closest('a')) {
    showCatalogMenu(false);
    catalogTrigger.focus();
  }
});
catalogPanel.addEventListener('keydown',event=>{
  const row=event.target.closest('.catalog-department-menu-row');
  if (!row) return;
  const submenu=row.querySelector('.catalog-submenu');
  if (event.key==='ArrowRight' && submenu && !submenu.contains(event.target)) {
    event.preventDefault();
    activateCatalogDepartment(row);
    submenu.querySelector('a')?.focus();
  } else if (event.key==='ArrowLeft' && submenu?.contains(event.target)) {
    event.preventDefault();
    row.firstElementChild.focus();
  }
});
document.addEventListener('pointerdown',event=>{
  if (!catalogMenu.contains(event.target) && !catalogPanel.hidden) showCatalogMenu(false);
});
document.addEventListener('keydown',event=>{
  if (event.key==='Escape' && !catalogPanel.hidden) {
    const focused=catalogMenu.contains(document.activeElement);
    showCatalogMenu(false);
    if (focused) catalogTrigger.focus();
  }
});
site.backend.then(value=>{hasBackend=value;return render();});
function onRouteChange() {
  const address=currentRoute();
  if (address===previousRoute || !pathRouting && address==='#main') return;
  positions.set(previousRoute,window.scrollY);
  previousRoute=address;
  if (collectionPicker.open) collectionPicker.close();
  showCatalogMenu(false);
  const catalogScroll=pendingCatalogScroll?.route===address ? pendingCatalogScroll : null;
  pendingCatalogScroll=null;
  hideSearchSuggestions();
  render(true,catalogScroll);
}
window.addEventListener('hashchange',onRouteChange);
if (pathRouting) {
  window.addEventListener('popstate',onRouteChange);
  document.addEventListener('click',event=>{
    const anchor=event.target.closest('a[data-route]');
    if (!anchor || event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(anchor.dataset.route);
  });
}
