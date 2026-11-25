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
  // The Riva snapshot contains public prices and quantities only.
  const rivaScope = new Set([2730,2763,2774,2796,2807,2818,2829,2840,2851,2862,2884,2895,2906,2928,2939,2950,2961,2983,3005,3016,3027,3049,3060,3071,3082,3093,3115,3137,3148,3159,3181,3203,3214,3220,3231,3242,3253,3275,3297,3308,3319,3341,3352,3363,3385,4348,4371,4384,4397,4433,4446,4469,4482,4495,4508,4521,4544,4557,4582,4607,4653,4666,4679,4702,4738,4761,4774,4787,4833,4846,4869,4915,4940,4965,4988,5011,5057,5080,5103,5126,5149,5172,5195,5256,5281,5294,5340,5363,5409,5455,5526,5571,5594,5607,5652,5697,5742,5787,5850,5898,5921,5937,5960,5983,6008,6031,6054,6077,6100,6125,6138,6161,6184,6207,6252,6297,6342,6390,6427,16985,17030,17075,17120,17788,21746,21777,23454,34973,35005,35037,35069,35101,35133,37685,37767,37849,37931,38013,71679,71691,71695,71702,71706,71710,71714,71718,71725,71729,71736,71743,71750,71757,71764,71771,71778,71785,71792,71799,71806,71813,71820,71827,71834,71841,71848,71855,71862,71869,71876,71883,71890,71897,71904,71911,71918,71925,71932,71939,71946,71953,71960,71967,71974,71981,71988,71995,72002,72009,72016,72023,72030,72037,72044,72051,72058,72065,72072,72079,72086,72093,72100,72107,72114,72121,72128,72135,72142,72149,72156,72163,72170,72174,72181,72188,72195,72202,72209,72216,72223,72236,72243,72256,72260,72264,72268,72272,72279,72286,72293,72300,72307,72314,72321,72328,72342,72349,72356,72363,72370,72374,72393,72403,72561,72572,72583,72594,72605,72616,72627,72638,72649,72660,72671,72682,72693,72704,72715,72726,72737,72748,72759,72770,72781,72792,72803,72814,72825,72836,72847,72858,72869,72880,72891,72902,72935,72946,72957,72968,72979,73152,73185,73218,73269,73278,73295,73312,73329,73346,73355,73372,73381,73398,73407,73416,73425,73434,73451,73460,73469,73478,73487,73504,73513,73522,73531,73548,73557,73566,73575,73584,73593,73602,73619,73628,73637,73646,73655,73664,73673,73690,73699,73716,73725,73734,73743,73752,73761,73770,73779,73796,73813,73822,73831,73840,73849,73860,73866,73871,73880,73889,73898,73915,73924,73933,73942,73959,73968,73977,73986,73995,74004,74013,74030,74047,74056,74065,74074,74083,74092,74101,74118,74135,74144,74161,74170,74179,74188,74197,74206,74215,74224,74233,74266,74362,74371,74391,74400,74442,74451,74460,74469,74478,74487,74496,74505,74514,74523,74559,74592,74601,74610,74619,74628,74637,74655,74664,74673,74682,74691,74700,74709,74725,74743,74754,74771,74780,74791,74802,74824,74835,74854,74863,74872,74881,74890,74899,74908,74917,74942,74967,74990,75013,75036,75060,75085,75110,75135,75235,75260,75285,75310,75335,75360,75385,75410,75615,75640,84904,84913,84920,84927,84934,84943,84950,84957,84964,84971,84978,84985,85002,85009,85017,85024,85032,85039,85046,85054,85061,85065,85075,85082,85092,85099,143504,143510,143516,152770,174755,174764,174771,174778,174785,174792,174799,174807,174812,174817,174822,174827,174832,174837,174842,174847,174852,174857,174863,174869,174874,174879,174886,174891,189672,189783,189795,189806,189943,189949,189960,189976,189987,189998,190009,190020,190026,190043,190054,190650,190673,190697,190722,190769,190792,190806,190829,190852,190891,190917,190924,190950,190973,190996,191008,191031,191055,191079,191097,191316,191329,191342,191355,191368,191380,191392,191404,191422,191446,191464,191481,207800,207812,207823,207834,207845,207856,207867,207878,207889,207900,207911,207922,207933,207944,207955,207966,207977,207989,208000,208102,208160,208179,208213,208238,208249,218973,231308,231328,231344,231361,231375,231385,231394,231403,231412,231425,231434,231443,231469,231655,256414,256483,256505,256546,256590,256635,256657,256699,256743,256786,256830,256875,256918,256940,256962,256985,257007,257051,257073,260392,260436,260481,260525,260569,260613,260657,260701,260745,260789,260833,260877,260921,260965,261009,261054,261098,261142,261186,261208,261276,261320,261364,261408,261452,261496,261540,261584,261628,261672,261716,261760,261804,302425,302439,302446,302458,302465,302478,302485,302498,302505,302518,302531,302544,302557,302570,302583,302596,302609,302619,302631,302643,302653,302663,302673,302683,302693,302703,302726,302734,302737,302740,302745,302748,302751,302756,302760,302763,302768,302773,302778,302783,302788,302793,302798,302803,302808,302813,302818,302823,302828,302833,302836,302841,302846,302851,302868,302883,302888,302893,302903,302908,302913,302923,302928,302933,302940,302945,302954,302963,302972,302981,302988,303002,303013,303022,303031,303040,303054,303063,303074,303083,303092,303101,303110,303119,303128,303137,303146,303155,303164,303173,303182,303191,303200,303209,303218,303227,303236]);
  let rivaEnabled = true;
  let rivaProducts = null;
  let rivaExpires = 0;
  const rivaReady = backend.then(async enabled => {
    rivaEnabled = !enabled;
    if (enabled) return;
    try {
      const response = await fetch('./data/riva-prices.json', {cache:'no-store'});
      if (!response.ok) return;
      const data = await response.json();
      if (data.version!==1 || !data.products || !Number.isFinite(Date.parse(data.expiresAt))) return;
      rivaExpires=Date.parse(data.expiresAt);
      rivaProducts=data.products;
    } catch {}
  });
  const isRiva = id => rivaEnabled && rivaScope.has(Number(id));
  const rivaEntry = id => isRiva(id) && Date.now()<rivaExpires ? rivaProducts?.[id] : null;
  const validPrice = value => Number.isSafeInteger(value) && value>0 && value%10===0 ? value : null;
  const validStock = value => Number.isSafeInteger(value) && value>=0 ? value : null;
  function rivaVariant(parent,id) {
    if (!isRiva(parent)) return undefined;
    const item=rivaEntry(parent)?.variants?.[id];
    return {price:validPrice(item?.[0]),stock:validStock(item?.[1]),backorder:item?.[1]===0};
  }
  function rivaRow(row) {
    if (!isRiva(row[0])) return row;
    const entry=rivaEntry(row[0]);
    const copy=row.slice();
    copy[3]=validPrice(entry?.price); copy[4]=validPrice(entry?.max);
    return copy;
  }
  function rivaBrowse(data,key) {
    if (key==='sections') return data;
    if (Array.isArray(data)) return data.map(rivaRow);
    if (Array.isArray(data?.rows)) return {...data,rows:data.rows.map(rivaRow)};
    return Object.fromEntries(Object.entries(data).map(([id,rows])=>[id,Array.isArray(rows)?rows.map(rivaRow):rows]));
  }
  function rivaDetail(id,detail) {
    if (!detail || !isRiva(id)) return detail;
    const copy=detail.slice();
    copy[2]=(detail[2]||[]).map(option=>{
      const value=rivaVariant(id,option[0]);
      return [option[0],option[1],value.price,value.stock];
    });
    copy[5]=rivaVariant(id,0).stock;
    if (copy[6]) copy[6]=rivaRow(copy[6]);
    return copy;
  }
  let catalogRequest;
  const catalog = () => {
    catalogRequest ??= backend.then(async enabled => { const data=await get(enabled ? './api/catalog' : './data/catalog.json'); await rivaReady; return enabled ? data : {...data,items:data.items.map(rivaRow)}; }).catch(() => {
      catalogRequest = undefined;
      return null;
    });
    return catalogRequest;
  };
  const browseRequests = new Map();
  const browse = (key) => {
    if (!browseRequests.has(key)) {
      browseRequests.set(key,Promise.all([get('./data/browse/'+key+'.json'),rivaReady]).then(([data])=>rivaBrowse(data,key)).catch((error)=>{
        browseRequests.delete(key);
        throw error;
      }));
    }
    return browseRequests.get(key);
  };
  let featured;
  const getFeatured = () => (featured ??= Promise.all([get('./data/featured.json'),rivaReady]).then(([data])=>data.map(rivaRow)).catch(()=>[]));
  let collections;
  const getCollections = () => (collections ??= get('./data/collections.json').catch(error=>{
    collections = undefined;
    throw error;
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
    return Promise.all([datasets.get(shard),rivaReady]).then(([data]) => rivaDetail(id,data[id]));
  };
  const variations = new Map();
  function variation(parent, id) {
    const key = parent + ':' + id;
    if (!variations.has(key)) variations.set(key,backend.then(async enabled=>{
      if (enabled) return get('./api/variants/' + parent + '/' + id);
      await rivaReady;
      const riva=rivaVariant(parent,id);
      const url = original + '/wp-json/wc/store/v1/products/' + id + '?_fields=id,parent,prices,images,is_on_backorder';
      let data;
      try {
        const response = await fetch(url,{signal:AbortSignal.timeout(4500),credentials:'omit'});
        if (!response.ok) throw new Error('Вариант недоступен');
        data=await response.json();
        if (data.id!==id || data.parent!==parent) throw new Error('Вариант не найден');
      } catch (error) {
        if (riva) return {...riva,image:''};
        throw error;
      }
      const price = data.prices?.currency_code==='RUB' ? Number(data.prices.price) / 10**Number(data.prices.currency_minor_unit) : 0;
      const image = data.images?.[0]?.src;
      if (riva) return {...riva,image:image?.startsWith(original+'/wp-content/uploads/') ? image : ''};
      return {price:Number.isFinite(price) && price>0 ? price : null,image:image?.startsWith(original+'/wp-content/uploads/') ? image : '',backorder:data.is_on_backorder===true};
    }).then(result=>{
      if (result?.price==null) variations.delete(key);
      return result;
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
  return { original, email, phone, escape, normalize, format, money, session, save, config, catalog, browse, rivaReady, isRiva, rivaVariant, getFeatured, getCollections, getCatalogFacts, getDetails, variation, backend, post, mail, startCategories, projects, delivery };
})();
