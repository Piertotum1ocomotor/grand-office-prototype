'use strict';

const html = (s='') => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api = async (name,data) => {
  const result = await fetch('/api/office/'+name,data===undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const body=await result.json();
  if(!result.ok) throw new Error(body.error||'Ошибка сервера.');
  return body;
};
const values = (form) => Object.fromEntries(new FormData(form));
const plans = new Map();
function roomSummary(plan,id) {
  if (!plan) return '';
  const size=html(plan.width)+' × '+html(plan.depth)+' м';
  if (plan.v!==2) return '<p>План: '+size+' · '+html(({single:'Один ряд',double:'Два ряда',islands:'Группы по четыре'})[plan.layout])+', между рядами или группами '+html(plan.gap)+' м.</p>';
  plans.set(id,plan);
  const models=workspace.composition(plan).map(item=>html(item.label)+' · '+item.count+' шт.').join('<br>');
  return '<div class="quote-context"><p>'+html(workspace.offices[plan.office] || 'План помещения')+' · '+size+'</p><p class="small">'+models+'</p><button class="btn secondary" type="button" data-office-plan="'+id+'">Скачать план PNG</button></div>';
}
document.addEventListener('click',event=>{
  const control=event.target.closest('[data-office-plan]');
  const plan=control && plans.get(Number(control.dataset.officePlan));
  if (plan) workspace.download(plan);
});
const notify = (form,text) => {
  const status=form.querySelector('.result');
  status.textContent=text;status.hidden=false;
};
async function requests() {
  const list=await api('requests');
  plans.clear();
  document.querySelector('#request-count').textContent=list.length ? 'Всего в списке: '+list.length : 'Обращений пока нет.';
  document.querySelector('#request-list').innerHTML=list.map((item)=>{
    const p=item.payload;
    return `<form class="panel" data-request="${item.id}"><h3>${item.kind==='order'?'Поставка':p.topic==='delivery'?'Доставка':'Запрос сметы'} № ${item.id}</h3>
      <p>${html(p.name)} · ${html(p.contact)} · ${html(p.city)}</p>
      ${p.address?'<p>Адрес и условия подъёма: '+html(p.address)+'</p>':''}${p.task?'<p>'+html(p.task)+'</p>':''}
      ${p.delivery?'<p>Получение: '+html(p.delivery)+'</p>':''}
      ${p.kit?'<p><strong>'+html(p.kit)+'</strong></p>':''}${p.product?'<p>Товар: '+[p.product,p.variant,p.sku,p.quantity && p.quantity+' шт.'].filter(Boolean).map(html).join(' · ')+'</p>':''}
      ${p.example?'<p>Проект для примера: '+html(p.example)+'</p>':''}
      ${roomSummary(p.roomPlan,item.id)}
      ${p.seats?'<p>Мест: '+html(p.seats)+'</p>':''}${p.date?'<p>Желаемая дата: '+html(p.date)+'</p>':''}
      ${p.lines?'<ul>'+p.lines.map(r=>'<li>'+[html(r.name),html(r.variant),r.qty+' шт.',r.price==null?'цена уточняется':html(r.price)+' ₽ за шт.'].filter(Boolean).join(' · ')+'</li>').join('')+'</ul>':''}
      ${p.estimate?.totalFrom==null?'':'<p>Ориентир без подъёма: от '+html(new Intl.NumberFormat('ru-RU').format(p.estimate.totalFrom))+' ₽</p>'}
      ${item.file_name?'<p><a class="text-link" href="/api/office/attachments/'+item.id+'">'+html(item.file_name)+'</a></p>':''}
      <label><span class="field-label">Статус</span><select class="field" name="state">${['Новая','В работе','КП отправлено','Подтверждено','Оплачено','Закрыто'].map(s=>'<option '+(item.state===s?'selected':'')+'>'+s+'</option>').join('')}</select></label>
      <button class="btn secondary">Сохранить статус</button><p class="result" role="status" hidden></p></form>`;
  }).join('');
}
async function journal() {
  const rows=await api('imports');
  document.querySelector('#journal').innerHTML=rows.length?'<ul>'+rows.map(r=>`<li>${html(r.created.slice(0,16))} · ${html(r.supplier)} · ${html(r.state)} · ${r.parsed} строк · ${r.applied} обновлено ${r.issue?' · '+html(r.issue):''}</li>`).join('')+'</ul>':'<p>Загрузок пока нет.</p>';
}
const importForm=document.querySelector('#imports');
const apply=document.querySelector('#apply-import');
importForm.addEventListener('input',()=>{apply.disabled=true;});
document.addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.target;
  const submit=event.submitter;
  submit.disabled=true;
  try {
    const data=values(form);
    if(form.id==='lookup'){
      const list=await api('products?q='+encodeURIComponent(data.q));
      document.querySelector('#product-list').innerHTML=list.map(p=>`<form class="panel" data-product="${p.id}"><h3>${html(p.name)}</h3><p class="small">ID ${p.id} · ${html(p.sku)}</p><label><span class="field-label">Название карточки</span><input class="field" name="name" maxlength="350" placeholder="${html(p.name)}" value="${html(p.customName||'')}"></label><label><span class="field-label">Описание карточки</span><textarea class="field" name="description" maxlength="3500">${html(p.customDescription||'')}</textarea></label><label><span class="field-label">Вариант</span><select class="field" name="variant"><option value="0">Весь товар</option>${p.variants.map(v=>`<option value="${v[0]}">${html(v[1])} · ${v[0]}</option>`).join('')}</select></label><label><span class="field-label">Цена, ₽</span><input class="field" type="number" name="price" min="0" step="0.01" placeholder="${html(p.price)}"></label><label><span class="field-label">Остаток поставщика</span><input class="field" type="number" name="stock" min="0"></label><button class="btn secondary">Сохранить</button><p class="result" role="status" hidden></p></form>`).join('')||'<p>Ничего не найдено.</p>';
    } else if(form.dataset.product) {
      await api('products',{product:form.dataset.product,...data});notify(form,'Сохранено.');
    } else if(form.dataset.request) {
      await api('requests',{id:form.dataset.request,...data});notify(form,'Статус сохранён.');
    } else if(form.id==='links') {
      await api('links',data);notify(form,'Связь сохранена.');
    } else if(form.id==='imports') {
      const result=await api('imports',{...data,apply:submit.value==='apply'});
      notify(form,`${result.state}. Строк: ${result.rows}, сопоставлено: ${result.matches}, без привязки: ${result.unlinked}.`);
      document.querySelector('#import-preview').innerHTML=result.sample.map(r=>`<li>${html(r.offer)} · товар ${r.product} · ${r.price} ₽ · ${r.stock} шт.</li>`).join('')+(result.issues.length?'<li>Строки с ошибками: '+html(result.issues.join(', '))+'</li>':'');
      apply.disabled=!result.matches||Boolean(result.issues.length);
      await journal();
    }
  } catch (err) {
    if(form.id==='lookup') document.querySelector('#product-list').textContent=err.message;
    else notify(form,err.message);
  } finally {
    if(submit!==apply) submit.disabled=false;
  }
});
requests().catch(error=>{document.querySelector('#request-count').textContent=error.message;});
journal().catch(error=>{document.querySelector('#journal').textContent=error.message;});
