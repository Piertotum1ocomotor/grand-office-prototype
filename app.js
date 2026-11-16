'use strict';

const products = [
  {
    id: 'riva-straight', type: 'tables', name: 'Рабочий стол Riva', sku: 'ПЛ.СП-4',
    image: 'table-straight.webp', price: 16990, note: '1600 × 720 × 755 мм',
    variants: [{ label: 'Белый', stock: 6 }, { label: 'Венге', stock: 2 }],
    specs: [['Ширина', '1600 мм'], ['Глубина', '720 мм'], ['Высота', '755 мм']]
  },
  {
    id: 'riva-angle', type: 'tables', name: 'Угловой стол Riva', sku: 'ПЛ.СА-1',
    image: 'table-angle.webp', price: 18140, note: '1600 × 900 × 755 мм',
    variants: [{ label: 'Белый', stock: 4 }, { label: 'Венге', stock: 0 }],
    specs: [['Ширина', '1600 мм'], ['Глубина', '900 мм'], ['Высота', '755 мм']]
  },
  {
    id: 'bureaucrat', type: 'chairs', name: 'Кресло Бюрократ CH-330M', sku: 'CH-330M',
    image: 'chair.webp', price: 6790, note: 'До 120 кг · сиденье 44 см',
    variants: [{ label: 'Чёрный', stock: 8 }, { label: 'Синий', stock: 3 }],
    specs: [['Максимальная нагрузка', '120 кг'], ['Ширина сиденья', '44 см'], ['Материал обивки', 'Ткань']]
  },
];

const categories = [
  ['Рабочие места', 'staff.webp', '#/catalog/tables'],
  ['Кресла', 'chairs.webp', '#/catalog/chairs'],
  ['Кабинеты руководителей', 'executive.webp', '#/project'],
];

const root = document.querySelector('#main');
const formatter = new Intl.NumberFormat('ru-RU');
const money = (amount) => formatter.format(amount) + ' ₽';
const findProduct = (id) => products.find((product) => product.id === id);
const cart = new Map();
const chosenVariants = new Map();
let catalogFilter = 'all';
let workspaceCount = 4;

function getCrumbs(parts) {
  return '<nav class="breadcrumb" aria-label="Хлебные крошки"><a href="#/">Главная</a>' +
    parts.map(([label, href]) => ' <span aria-hidden="true">/</span> ' +
      (href ? '<a href="' + href + '">' + label + '</a>' : '<span aria-current="page">' + label + '</span>')).join('') +
    '</nav>';
}

function categoryCard([label, image, href]) {
  return '<a class="category" href="' + href + '"><img src="./assets/' + image +
    '" alt="" loading="lazy"><span>' + label + '<small aria-hidden="true">↗</small></span></a>';
}

function home() {
  return `
    <div class="shell">
      <section class="hero" aria-labelledby="home-title">
        <div class="hero-copy">
          <p class="eyebrow">Пермь и Пермский край</p>
          <h1 id="home-title">Офисная мебель<br>и комплектация<br>офисов</h1>
          <p>Подберите мебель для одного рабочего места или соберите весь офис с доставкой и монтажом.</p>
          <div class="actions">
            <a class="btn" href="#/catalog">Выбрать мебель <span aria-hidden="true">↗</span></a>
            <a class="btn secondary" href="#/project">Рассчитать комплектацию</a>
          </div>
        </div>
        <div class="hero-photo"><img src="./assets/office.webp" alt="Светлый офис с деревянными столами и терракотовыми креслами" fetchpriority="high"></div>
      </section>
      <section class="section" aria-labelledby="category-title">
        <div class="section-head"><h2 id="category-title">Мебель для офиса</h2><a class="text-link" href="#/catalog">Весь каталог ↗</a></div>
        <div class="category-grid">${categories.map(categoryCard).join('')}</div>
      </section>
      <section class="project-feature">
        <img src="./assets/staff.webp" alt="Рабочая зона на несколько сотрудников" loading="lazy">
        <div><p class="eyebrow">Серия Riva</p><h2>Соберите рабочие места</h2>
        <p>Столы и кресла на 1, 4 или 8 мест. Посмотрите состав и пример расчёта для своего офиса.</p>
        <a class="btn" href="#/project">Посмотреть комплект</a></div>
      </section>
    </div>`;
}

function productCard(product) {
  const href = '#/product/' + product.id;
  return `
    <article class="product">
      <a class="product-photo" href="${href}" aria-label="${product.name}"><img src="./assets/${product.image}" alt="" width="400" height="235" loading="lazy"></a>
      <div class="product-card">
        <h3><a href="${href}">${product.name}</a></h3>
        <p class="meta">${product.note}</p>
        <p class="price">${money(product.price)}</p>
        <p class="stock">На складе поставщика</p>
      </div>
    </article>`;
}

function catalog(type) {
  catalogFilter = ['tables', 'chairs'].includes(type) ? type : 'all';
  return `
    <div class="shell page">
      ${getCrumbs([['Каталог']])}
      <h1>Каталог мебели</h1>
      <div class="catalog-controls">
        <label class="search-field"><span class="field-label">Поиск по названию или артикулу</span><input class="field" type="search" id="search" placeholder="Например, Riva"></label>
        <div class="filters" aria-label="Категория товара">
          <button class="chip" data-filter="all">Все товары</button>
          <button class="chip" data-filter="tables">Столы</button>
          <button class="chip" data-filter="chairs">Кресла</button>
        </div>
      </div>
      <p id="catalog-count" class="count-label" aria-live="polite"></p>
      <div class="product-grid" id="catalog-items"></div>
      <div class="empty" id="catalog-empty" hidden>Подходящих товаров нет. Попробуйте другой запрос или <button class="chip" data-reset>сбросьте фильтры</button>.</div>
    </div>`;
}

function updateCatalog() {
  const field = document.querySelector('#search');
  if (!field) return;
  const text = field.value.trim().toLocaleLowerCase('ru').replaceAll('рива', 'riva');
  const matches = products.filter((product) => {
    return (catalogFilter === 'all' || product.type === catalogFilter) &&
      (product.name + ' ' + product.sku).toLocaleLowerCase('ru').includes(text);
  });
  document.querySelector('#catalog-items').innerHTML = matches.map(productCard).join('');
  document.querySelector('#catalog-count').textContent = 'Найдено: ' + matches.length;
  document.querySelector('#catalog-empty').hidden = matches.length > 0;
  document.querySelectorAll('[data-filter]').forEach((button) =>
    button.setAttribute('aria-pressed', String(button.dataset.filter === catalogFilter)));
}

function itemPage(product) {
  const variantIndex = chosenVariants.get(product.id) || 0;
  const variant = product.variants[variantIndex];
  return `
    <div class="shell page">
      ${getCrumbs([['Каталог', '#/catalog'], [product.name]])}
      <div class="product-layout">
        <figure class="gallery" style="margin:0"><img src="./assets/${product.image}" alt="${product.name}"></figure>
        <section class="product-info">
          <h1>${product.name}</h1><p class="meta">Артикул ${product.sku} · ${product.note}</p>
          <p class="product-price">${money(product.price)}</p>
          <p class="field-label">Цвет</p>
          <div class="variant" aria-label="Цвет товара">${product.variants.map((item, index) => `<button class="chip" data-variant="${index}" data-product="${product.id}" aria-pressed="${index === variantIndex}">${item.label}</button>`).join('')}</div>
          <div class="logistics" aria-live="polite"><p class="stock">${variant.stock ? `На складе поставщика · ${variant.stock} шт.` : 'Уточнить наличие выбранного цвета'}</p><p class="small">Пермь · доставка и сборка рассчитываются отдельно</p></div>
          <div class="actions">
            ${variant.stock ? `<button class="btn" data-add="${product.id}">В корзину</button>` : '<a class="btn" href="#/project">Запросить расчёт</a>'}
            <a class="btn secondary" href="#/catalog">К каталогу</a>
          </div>
          <p id="add-result" class="result" role="status" hidden>Добавлено в корзину. <a class="text-link" href="#/cart">Открыть корзину ↗</a></p>
        </section>
      </div>
      <section class="spec"><h2>Размеры и характеристики</h2>
        <dl>${product.specs.map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`).join('')}</dl>
      </section>
    </div>`;
}

function project() {
  return `
    <div class="shell page">
      ${getCrumbs([['Комплектация офисов']])}
      <section class="project-hero">
        <div class="copy"><h1>Комплектация офисов</h1><p class="intro">Подбор мебели, спецификация по зонам, доставка и сборка.</p><button class="btn" data-show-project>К расчёту комплекта ↓</button></div>
        <img src="./assets/meeting.webp" alt="Стол и кресла в переговорной">
      </section>
      <div class="section project-demo" id="project-demo">
        <section class="panel">
          <h2>Рабочие места Riva</h2>
          <p class="small">Демонстрационный комплект из стола Riva и кресла Бюрократ.</p>
          <p class="field-label">Количество рабочих мест</p>
          <div class="filters" aria-label="Количество рабочих мест">
            ${[1, 4, 8].map((qty) => `<button class="chip" data-workspaces="${qty}" aria-pressed="${qty === workspaceCount}">${qty}</button>`).join('')}
          </div>
          <div class="summary" id="estimate" aria-live="polite"></div>
        </section>
        <form class="panel" id="project-form">
          <h2>Запросить смету</h2>
          <label><span class="field-label">Город</span><input class="field" name="city" value="Пермь" required maxlength="80"></label>
          <label><span class="field-label">Желаемая дата поставки</span><input class="field" name="date" type="date"></label>
          <label><span class="field-label">Комментарий к задаче</span><textarea class="field" name="task" maxlength="400" rows="2" placeholder="Например, нужен монтаж"></textarea></label>
          <button class="btn" type="submit">Показать подтверждение</button>
          <p class="small">Демонстрация. Данные остаются в браузере до закрытия страницы.</p>
          <p class="result" id="project-result" role="status" hidden></p>
        </form>
      </div>
    </div>`;
}

function updateEstimate() {
  const body = document.querySelector('#estimate');
  if (!body) return;
  document.querySelectorAll('[data-workspaces]').forEach((button) =>
    button.setAttribute('aria-pressed', String(Number(button.dataset.workspaces) === workspaceCount)));
  const desk = findProduct('riva-straight');
  const chair = findProduct('bureaucrat');
  const perSeat = desk.price + chair.price;
  body.innerHTML = `
    <div><a class="text-link" href="#/product/${desk.id}">Стол Riva</a><span>${workspaceCount} шт.</span></div>
    <div><a class="text-link" href="#/product/${chair.id}">Кресло Бюрократ</a><span>${workspaceCount} шт.</span></div>
    <div><span>За одно место</span><span>${money(perSeat)}</span></div>
    <div><span>Мебель на ${workspaceCount} мест</span><span>${money(perSeat * workspaceCount)}</span></div>`;
}

function cartPage() {
  const rows = Array.from(cart.values());
  if (!rows.length) {
    return `<div class="shell page">${getCrumbs([['Корзина']])}<h1>Корзина</h1><p class="intro">Выберите мебель в каталоге.</p><a class="btn" href="#/catalog">В каталог</a></div>`;
  }
  const total = rows.reduce((sum, row) => sum + row.product.price * row.quantity, 0);
  return `
    <div class="shell page">${getCrumbs([['Корзина']])}<h1>Корзина</h1>
      <div class="cart-layout">
        <section aria-label="Товары">
          ${rows.map(({ product, variantIndex, quantity, key }) => {
            const variant = product.variants[variantIndex];
            return `<div class="cart-row">
              <img src="./assets/${product.image}" alt="">
              <div><a href="#/product/${product.id}">${product.name}</a><p class="small">${variant.label} · ${money(product.price)} за шт.</p></div>
              <input type="number" class="field" min="1" max="${variant.stock}" step="1" value="${quantity}" data-quantity="${key}" aria-label="Количество — ${product.name}, ${variant.label}">
              <button data-remove="${key}">Убрать</button>
            </div>`;
          }).join('')}
        </section>
        <div class="panel"><h2>Получение в Перми</h2><p class="small">Доставка, подъём и сборка будут рассчитаны отдельно.</p>
          <div class="summary"><div><span>Стоимость товаров</span><span>${money(total)}</span></div></div>
          <button class="btn" data-preview-order>Показать подтверждение</button>
          <p class="result" id="order-result" role="status" hidden>Пример подтверждения заказа № ДЕМО-01. Реальный заказ не создан.</p>
        </div>
      </div>
    </div>`;
}

function delivery() {
  return `
    <div class="shell page">${getCrumbs([['Доставка и сборка']])}<h1>Доставка и сборка</h1>
      <p class="intro">Пермь и Пермский край. Дата и стоимость зависят от состава заказа, склада и адреса.</p>
      <div class="panel delivery-block"><h2>Как считается получение</h2><dl>
        <div><dt>Доставка</dt><dd>По адресу и объёму заказа</dd></div>
        <div><dt>Подъём</dt><dd>По этажу и условиям доступа</dd></div>
        <div><dt>Сборка</dt><dd>Отдельной строкой в смете</dd></div>
      </dl></div>
    </div>`;
}

function updateCartCount() {
  const count = Array.from(cart.values()).reduce((sum, row) => sum + row.quantity, 0);
  document.querySelector('#cart-count').textContent = count;
}

function currentRoute() {
  return location.hash.replace(/^#\/?/, '').split('/');
}

function render({ scroll = false, focus = false } = {}) {
  const [page, id] = currentRoute();
  document.querySelectorAll('[data-nav]').forEach((link) =>
    link.dataset.nav === page ? link.setAttribute('aria-current', 'page') : link.removeAttribute('aria-current'));
  const product = page === 'product' && findProduct(id);
  let content;
  if (page === 'catalog') content = catalog(id);
  else if (product) content = itemPage(product);
  else if (page === 'project') content = project();
  else if (page === 'cart') content = cartPage();
  else if (page === 'delivery') content = delivery();
  else content = home();
  root.innerHTML = content;
  updateCatalog();
  updateEstimate();
  if (scroll) window.scrollTo(0, 0);
  if (focus) root.focus({ preventScroll: true });
}

root.addEventListener('input', (event) => {
  if (event.target.id === 'search') updateCatalog();
});

root.addEventListener('change', (event) => {
  const input = event.target.closest('[data-quantity]');
  if (!input) return;
  const row = cart.get(input.dataset.quantity);
  row.quantity = Math.max(1, Math.min(Number(input.max), Math.trunc(input.valueAsNumber) || 1));
  updateCartCount();
  render();
  root.querySelector('[data-quantity="' + row.key + '"]').focus();
});

root.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const { filter, variant, product: productId, add, workspaces, remove } = button.dataset;
  if (filter) {
    catalogFilter = filter;
    updateCatalog();
  } else if (button.hasAttribute('data-reset')) {
    catalogFilter = 'all';
    document.querySelector('#search').value = '';
    updateCatalog();
    document.querySelector('#search').focus();
  } else if (variant !== undefined) {
    chosenVariants.set(productId, Number(variant));
    render();
    root.querySelector('[data-variant="' + variant + '"]').focus();
  } else if (add) {
    const product = findProduct(add);
    const variantIndex = chosenVariants.get(add) || 0;
    const key = add + '-' + variantIndex;
    const quantity = (cart.get(key)?.quantity || 0) + 1;
    const maximum = product.variants[variantIndex].stock;
    const result = document.querySelector('#add-result');
    if (quantity <= maximum) {
      cart.set(key, { key, product, variantIndex, quantity });
      updateCartCount();
      result.firstChild.textContent = 'Добавлено в корзину. ';
    } else {
      result.firstChild.textContent = 'Достигнуто доступное количество. ';
    }
    result.hidden = false;
  } else if (workspaces) {
    workspaceCount = Number(workspaces);
    updateEstimate();
    document.querySelector('#project-result').hidden = true;
  } else if (remove) {
    cart.delete(remove);
    updateCartCount();
    render({ focus: true });
  } else if (button.hasAttribute('data-preview-order')) {
    document.querySelector('#order-result').hidden = false;
  } else if (button.hasAttribute('data-show-project')) {
    document.querySelector('#project-demo').scrollIntoView({ block: 'start' });
    document.querySelector('[data-workspaces][aria-pressed="true"]').focus({ preventScroll: true });
  }
});

root.addEventListener('submit', (event) => {
  if (event.target.id !== 'project-form') return;
  event.preventDefault();
  const city = new FormData(event.target).get('city').trim();
  const result = document.querySelector('#project-result');
  result.textContent = 'Пример заявки № ДЕМО-02 · ' + city + ' · мест: ' + workspaceCount + '. Заявка не отправлена.';
  result.hidden = false;
});

window.addEventListener('hashchange', () => {
  if (location.hash === '#main') return;
  render({ scroll: true, focus: true });
});
render();
