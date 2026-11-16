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
  const backend = get('./site.json').then((data) => data.backend === true).catch(() => false);
  const catalog = backend.then((enabled) => get(enabled ? './api/catalog' : './data/catalog.json')).catch(() => null);
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
    {id:'rshb', name:'Россельхозбанк', image:'rshr-port.jpg'},
    {id:'sber', name:'Сбер', image:'sber-port.jpg'},
    {id:'lukoil', name:'ЛУКОЙЛ', image:'lukoil-port.jpeg.jpg'},
    {id:'gazprom', name:'Газпром', image:'gazprom-port.jpg'}
  ];
  const delivery = [
    ['Мебель для руководителей','3–10 дней','geography'],
    ['Мебель для сотрудников','3–7 дней','staff'],
    ['Кресла','3–5 дней','chairs'],
    ['Мебель для приёмных и переговорных','5–12 дней','meeting'],
    ['Мебель для зон ожидания','7–14 дней','waiting'],
    ['Металлическая мебель и сейфы','5–10 дней','metal']
  ];
  return { original, email, phone, escape, normalize, format, money, session, save, catalog, getDetails, backend, post, mail, startCategories, projects, delivery };
})();
