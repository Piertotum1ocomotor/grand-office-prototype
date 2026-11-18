'use strict';

const segments = {staff:'Мебель для персонала',executive:'Кабинеты руководителей'};
const types = {tables:'Столы',pedestals:'Тумбы',cabinets:'Шкафы',shelving:'Стеллажи'};
const typeOrder = Object.keys(types);
const priceFormat = new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
const plural = new Intl.PluralRules('ru');
const pageSize = 12;
const main = document.querySelector('#main');
let collections;

const esc = value => String(value ?? '').replace(/[&<>"']/g,char=>(
  {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]
));
const price = item => item.price==null ? 'Цена по запросу' :
  (item.upper>item.price ? 'от ' : '') + priceFormat.format(item.price)+' ₽';
const quantity = (n,forms) => priceFormat.format(n)+' '+(forms[plural.select(n)] || forms.many);
const itemsCount = n => quantity(n,{one:'товар',few:'товара',many:'товаров'});
const seriesCount = n => quantity(n,{one:'коллекция',few:'коллекции',many:'коллекций'});
const seriesCover = entry => '../assets/collection-'+entry.id+'.jpg';

function href(params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([,value])=>value));
  return './'+(query.size?'?'+query:'');
}

function tab(text, params, active) {
  return '<a data-demo class="collection-pill" href="'+esc(href(params))+'" '+(active?'aria-current="page"':'')+'>'+esc(text)+'</a>';
}

function breadcrumbs(parts) {
  return '<nav class="breadcrumb" aria-label="Хлебные крошки"><a href="../#/">Главная</a><span aria-hidden="true">/</span>'+
    parts.map(([text,params])=>params ? '<a data-demo href="'+esc(href(params))+'">'+esc(text)+'</a>' :
      '<span aria-current="page">'+esc(text)+'</span>').join('<span aria-hidden="true">/</span>')+'</nav>';
}

function header(segment, view) {
  return breadcrumbs([['Коллекции']]) +
    '<section class="collection-heading"><h1>Коллекции офисной мебели</h1><p>Подберите столы, тумбы и шкафы из одной серии для всего офиса.</p></section>'+
    '<div class="collection-navigation"><nav class="segment-tabs" aria-label="Раздел">'+
      Object.entries(segments).map(([key,label])=>tab(label,{segment:key,view},key===segment)).join('')+
    '</nav><nav class="view-tabs" aria-label="Способ подбора">'+
      tab('По коллекциям',{segment},!view)+tab('По типу мебели',{segment,view:'products',type:'tables'},Boolean(view))+
    '</nav></div>';
}

function collectionCard(entry) {
  const available = typeOrder.filter(type=>entry.items.some(item=>item.type===type));
  return '<a data-demo class="collection-card" href="'+esc(href({collection:entry.id}))+'">'+
    '<img src="'+esc(seriesCover(entry))+'" alt="" width="960" height="640" loading="lazy">'+
    '<div class="series-card-copy"><h3>'+esc(entry.name)+'</h3><p>'+esc(available.map(type=>types[type]).join(' · '))+'</p>'+
    '<span class="series-card-link">Открыть коллекцию</span></div></a>';
}

function typeTabs(items, current, params, showAll) {
  const available = typeOrder.filter(type=>items.some(item=>item.type===type));
  return '<nav class="type-tabs" aria-label="Тип мебели">'+
    (showAll?tab('Вся мебель',{...params,type:null},!current):'')+
    available.map(type=>tab(types[type],{...params,type},type===current)).join('')+'</nav>';
}

function productCard({item,collection}, showCollection) {
  const dimensions = item.dimensions?.filter(Boolean).join(' × ');
  const label = item.name.replace(/\d{2,4}\s*[×xх*]\s*\d{2,4}\s*[×xх*]\s*\d{2,4}\s*(?:мм)?/i,'').trim();
  const product = '../#/product/'+item.id;
  return '<article class="product collection-product"><a class="product-photo" href="'+product+'" aria-label="'+esc(label)+'">'+
    (item.image?'<img src="'+esc(item.image)+'" alt="" width="340" height="200" loading="lazy">':'<span class="empty-product-photo">Фото уточняется</span>')+
    '</a><div class="product-card">'+
    (showCollection?'<a class="series-product-link" data-demo href="'+esc(href({collection:collection.id,type:item.type}))+'">'+esc(collection.name)+'</a>':'')+
    '<h3><a href="'+product+'">'+esc(label)+'</a></h3>'+
    '<p class="meta">'+esc([item.sku?'Арт. '+item.sku:null,dimensions?dimensions+' мм':null].filter(Boolean).join(' · '))+'</p>'+
    '<p class="price">'+esc(price(item))+'</p></div></article>';
}

function productGrid(entries, showCollection, params, page) {
  const total = Math.max(1,Math.ceil(entries.length/pageSize));
  const current = Math.max(1, Math.min(total,page));
  const start = (current-1)*pageSize;
  const pagination = total>1 ?
    '<nav class="pagination demo-pages" aria-label="Страницы товаров">'+
      (current>1?tab('Назад',{...params,page:current-1}):'')+
      '<span>Страница '+current+' из '+total+'</span>'+
      (current<total?tab('Далее',{...params,page:current+1}):'')+
    '</nav>' : '';
  return '<div class="collection-result-count" aria-live="polite">'+itemsCount(entries.length)+'</div>'+
    '<div class="product-grid demo-product-grid">'+entries.slice(start,start+pageSize).map(row=>productCard(row,showCollection)).join('')+'</div>'+pagination;
}

function overview(segment) {
  const entries=collections.filter(entry=>entry.segment===segment);
  return header(segment,'')+
    '<div class="collections-section-title"><h2>'+esc(segments[segment])+'</h2><p>'+seriesCount(entries.length)+' в подборке</p></div>'+
    '<div class="collection-grid">'+entries.map(collectionCard).join('')+'</div>';
}

function collectionPage(collection,type,page) {
  const {segment,name,id,category,items} = collection;
  const selectedType = items.some(item=>item.type===type) ? type : null;
  const picked = selectedType ? items.filter(item=>item.type===selectedType) : [...items];
  if (!selectedType) {
    const firstOfType = typeOrder.map(key=>items.find(item=>item.type===key)).filter(Boolean);
    picked.splice(0,picked.length,...firstOfType,...items.filter(item=>!firstOfType.includes(item)));
  }
  const params = {collection:id,type:selectedType};
  return breadcrumbs([['Коллекции',{}],[segments[segment],{segment}],[name]])+
    '<section class="series-hero"><div><p class="eyebrow">'+esc(segments[segment])+'</p><h1>'+esc(name)+'</h1>'+
    '<p>Выберите мебель из коллекции, чтобы оформить офис в едином стиле.</p>'+
    '<a data-demo class="text-link" href="'+esc(href({segment}))+'">Все коллекции раздела</a></div>'+
    '<img src="'+esc(seriesCover(collection))+'" alt="Мебель коллекции '+esc(name)+' в интерьере" width="960" height="640"></section>'+
    '<section class="series-products" id="products"><div class="collections-section-title"><h2>Мебель коллекции</h2>'+
    '<a class="text-link" href="../#/catalog?c='+encodeURIComponent(category)+'">Открыть серию в каталоге</a></div>'+
    typeTabs(items,selectedType,params,true)+productGrid(picked.map(item=>({item,collection})),false,params,page)+'</section>';
}

function byProducts(segment,type,seriesId,page) {
  const group = collections.filter(entry=>entry.segment===segment);
  const chosen = group.find(entry=>entry.id===seriesId);
  const matching = group.map(collection=>({collection,items:collection.items.filter(item=>item.type===type)}));
  const lists = chosen ? matching.filter(entry=>entry.collection===chosen) : matching;
  const rows = [];
  for (let index=0;index<Math.max(...lists.map(entry=>entry.items.length));index++) {
    for (const {collection,items} of lists) if (items[index]) rows.push({item:items[index],collection});
  }
  const params = {segment,view:'products',type,series:chosen?.id};
  return header(segment,'products')+
    '<section class="series-products" id="products"><div class="collections-section-title"><h2>'+esc(types[type])+'</h2></div>'+
    '<div class="product-filter-panel">'+typeTabs(group.flatMap(entry=>entry.items),type,params,false)+
    '<label for="collection-filter"><span class="field-label">Коллекция</span><select class="field" id="collection-filter" name="series">'+
    '<option value="">Все коллекции</option>'+matching.filter(({collection,items})=>items.length || collection===chosen).map(({collection,items})=>
      '<option value="'+esc(collection.id)+'" '+(collection===chosen?'selected':'')+'>'+esc(collection.name)+' ('+items.length+')</option>').join('')+
    '</select></label></div>'+
    (chosen?'<div class="selected-series"><a data-demo class="text-link" href="'+esc(href({collection:chosen.id}))+'">Вся мебель коллекции '+esc(chosen.name)+'</a></div>':'')+
    (rows.length?productGrid(rows,true,params,page):'<p class="empty">В этой коллекции нет товаров выбранного типа. <a data-demo class="text-link" href="'+
      esc(href({segment,view:'products',type}))+'">Показать все коллекции</a></p>')+'</section>';
}

function render() {
  const params = new URLSearchParams(location.search);
  const segment = Object.hasOwn(segments,params.get('segment')) ? params.get('segment') : 'staff';
  const type = Object.hasOwn(types,params.get('type')) ? params.get('type') : '';
  const collection = collections.find(entry=>entry.id===params.get('collection'));
  const page = Number.parseInt(params.get('page'),10) || 1;
  main.innerHTML = collection ? collectionPage(collection,type,page) :
    params.get('view')==='products' ? byProducts(segment,type || 'tables',params.get('series'),page) : overview(segment);
  document.title = (collection ? collection.name+' — коллекция офисной мебели' : 'Коллекции офисной мебели')+' — Гранд-Офис';
}

function navigate(url, focus = 'heading') {
  history.pushState(null,'',url);
  render();
  if (focus==='filter') document.querySelector('#collection-filter')?.focus({preventScroll:true});
  else if (focus==='products') {
    document.querySelector('#products')?.scrollIntoView({block:'start'});
    const heading = document.querySelector('#products h2');
    if (heading) {
      heading.tabIndex=-1;
      heading.focus({preventScroll:true});
    }
  } else {
    window.scrollTo(0,0);
    main.focus({preventScroll:true});
  }
}

main.addEventListener('click',event=>{
  const link=event.target.closest('a[data-demo]');
  if (!link || event.button!==0 || event.metaKey || event.altKey || event.shiftKey || event.ctrlKey) return;
  event.preventDefault();
  navigate(link.href,link.closest('.type-tabs,.demo-pages')?'products':'heading');
});

main.addEventListener('change',event=>{
  if (event.target.id!=='collection-filter') return;
  const query = new URLSearchParams(location.search);
  if (event.target.value) query.set('series',event.target.value);
  else query.delete('series');
  query.delete('page');
  navigate('./?'+query,'filter');
});

window.addEventListener('popstate',()=>{if (collections) render();});
fetch('collections.json').then(response=>{
  if (!response.ok) throw new Error('Collection data unavailable');
  return response.json();
}).then(data=>{
  collections=data;
  render();
}).catch(()=>{
  main.innerHTML='<div class="empty">Коллекции временно недоступны. <a class="text-link" href="../#/catalog">Открыть каталог</a></div>';
});
