'use strict';

const site = (() => {
  const original = 'https://grand-office59.ru';
  const email = 'grand-office159@yandex.ru';
  const phone = '+7 (342) 215-58-98';
  const priceFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const normalize = (value) => String(value || '').toLocaleLowerCase('ru').replaceAll('ё', 'е').replaceAll('рива', 'riva');
  const format = (value) => priceFormat.format(value) + ' ₽';
  const money = (price, upper) => price == null ? 'Цена по запросу' : (upper > price ? 'от ' : '') + format(price);
  const session = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem('grand-' + key)) ?? fallback; } catch { return fallback; }
  };
  const save = (key, value) => {
    try { localStorage.setItem('grand-' + key, JSON.stringify(value)); } catch {}
  };
  const get = async (href) => {
    const result = await fetch(href);
    if (!result.ok) throw new Error('Не удалось загрузить данные');
    return result.json();
  };
  const config = get('./site.json').catch(() => ({}));
  const backend = config.then((data) => data.backend === true);
  let catalogRequest;
  const catalog = () => {
    catalogRequest ??= backend.then((enabled) => get(enabled ? './api/catalog' : './data/catalog.json')).catch(() => {
      catalogRequest = undefined;
      return null;
    });
    return catalogRequest;
  };
  const browseRequests = new Map();
  const browse = (key) => {
    if (!browseRequests.has(key)) {
      browseRequests.set(key,get('./data/browse/'+key+'.json').catch((error)=>{
        browseRequests.delete(key);
        throw error;
      }));
    }
    return browseRequests.get(key);
  };
  let featured;
  const getFeatured = () => (featured ??= get('./data/featured.json').catch(()=>[]));
  let collections;
  const getCollections = () => (collections ??= get('./data/collections.json').catch(()=>{
    collections = undefined;
    return [];
  }));
  let facts;
  const getCatalogFacts = () => (facts ??= get('./data/catalog-facts.json').catch(error=>{
    facts = undefined;
    throw error;
  }));
  const datasets = new Map();
  const getDetails = async (id) => {
    if (await backend) return get('./api/products/' + id);
    const shard = Math.floor(id / 1000);
    if (!datasets.has(shard)) {
      const result = get('./data/products/' + shard + '.json').catch((error) => {
        datasets.delete(shard);
        throw error;
      });
      datasets.set(shard, result);
    }
    return datasets.get(shard).then((data) => data[id]);
  };
  const variations = new Map();
  function variation(parent, id) {
    const key = parent + ':' + id;
    if (!variations.has(key)) variations.set(key,backend.then(async enabled=>{
      if (enabled) return get('./api/variants/' + parent + '/' + id);
      const url = original + '/wp-json/wc/store/v1/products/' + id + '?_fields=id,parent,prices,images,is_on_backorder';
      const response = await fetch(url,{signal:AbortSignal.timeout(4500),credentials:'omit'});
      if (!response.ok) throw new Error('Вариант недоступен');
      const data = await response.json();
      if (data.id !== id || data.parent !== parent) throw new Error('Вариант не найден');
      const price = data.prices?.currency_code==='RUB' ? Number(data.prices.price) / 10**Number(data.prices.currency_minor_unit) : 0;
      const image = data.images?.[0]?.src;
      return {price:Number.isFinite(price) && price>0 ? price : null,image:image?.startsWith(original+'/wp-content/uploads/') ? image : '',backorder:data.is_on_backorder===true};
    }).catch(()=>{
      variations.delete(key);
      return null;
    }));
    return variations.get(key);
  }
  const post = async (path, payload) => {
    const response = await fetch('./api/' + path, {
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Повторите попытку.');
    return result;
  };
  const mail = (title, body) => 'mailto:' + email + '?subject=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body);

  const startCategories = [
    ['Мебель для персонала','staff.webp','ofisnaya-mebel-dlya-personala'],
    ['Кресла и стулья','chairs.webp','chairs'],
    ['Кабинеты руководителей','executive.webp','mebel-v-kabinet-rukovoditelya'],
    ['Переговорные','meeting.webp','mebel-dlya-peregovornyh']
  ];
  const projects = [
    {id:'sber', name:'Сбер', image:'sber-port.jpg', zone:'Клиентский зал', description:'Круглые столы с деревянными стульями, высокие столы с барными стульями и мягкие места вдоль стены.', items:[['Основная посадка','Круглые столы и стулья'],['Высокая посадка','Высокие столы и барные стулья'],['Мягкая зона','Пуфы вдоль стены']]},
    {id:'rshb', name:'Россельхозбанк', image:'rshr-port.jpg', zone:'Рабочая зона и хранение', description:'Столы разделены настольными экранами. Вдоль прохода стоят невысокие шкафы, под столами — тумбы.',items:[['Рабочая зона','Столы с экранами'],['Хранение','Низкие шкафы и тумбы']]},
    {id:'lukoil', name:'ЛУКОЙЛ', image:'lukoil-port.jpeg.jpg', zone:'Открытый офис', description:'Ряды столов с красными и серыми экранами, сетчатыми креслами и подкатными тумбами.',items:[['Рабочие места','Столы с настольными экранами'],['Посадка','Сетчатые кресла'],['Хранение','Подкатные тумбы']]},
    {id:'gazprom', name:'Газпром', image:'gazprom-port.jpg', zone:'Рабочие места', description:'Светлые рабочие столы с белыми экранами и тёмными креслами рядом с синим объёмом переговорной.',items:[['Рабочие места','Светлые столы и экраны'],['Посадка','Тёмные офисные кресла']]}
  ];
  const delivery = [
    ['Мебель для руководителей','3–10 дней','geography'],
    ['Мебель для сотрудников','3–7 дней','staff'],
    ['Кресла','3–5 дней','chairs'],
    ['Мебель для приёмной','5–12 дней','reception'],
    ['Мебель для приёмных и переговорных','5–12 дней','meeting'],
    ['Мебель для зон ожидания','7–14 дней','waiting'],
    ['Металлическая мебель и сейфы','5–10 дней','metal'],
    ['Специализированная мебель','5–10 дней','special'],
    ['Мебель для обеденных зон','5–10 дней','dining']
  ];
  return { original, email, phone, escape, normalize, format, money, session, save, config, catalog, browse, getFeatured, getCollections, getCatalogFacts, getDetails, variation, backend, post, mail, startCategories, projects, delivery };
})();
