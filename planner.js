'use strict';

const officePlanner = (() => {
  const format = new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
  const escape = site.escape;
  const {labels,obstacles,round,snap,sizeOf,bounded}=workspace;

  function mount(root,{draft,count,models,defaultDesk,defaultChair,onSave,onQuote,onKit}) {
    const palette = Object.fromEntries(Object.keys(labels).map(type=>[type,
      obstacles[type] ? [obstacles[type]] : models.filter(model=>model.type===type)]));
    const config=workspace.planSettings(draft);
    const preset=(type,product)=>palette[type].find(item=>item.product===product) || palette[type][0];
    const fromDraft = item => {
      if (!Number.isInteger(item.id) || item.id<1 || !Number.isFinite(item.x) || !Number.isFinite(item.y) ||
          ![0,90,180,270].includes(item.rotation) || !palette[item.type]) return null;
      const model=palette[item.type].find(model=>model.product===item.product);
      if (!model) return null;
      const size=obstacles[item.type] && [item.width,item.depth].every(value=>Number.isFinite(value) && value>=.1 && value<=3)
        ? {width:item.width,depth:item.depth} : {};
      return bounded({...item,...model,...size},config);
    };
    const requested=Math.min(count,40);
    const desk=preset('desk',draft.desk || defaultDesk);
    const chair=preset('chair',draft.chair || defaultChair);
    const savedItems = draft.v===2 && Array.isArray(draft.items) && draft.items.length<=workspace.maxItems
      ? draft.items.map(fromDraft).filter(Boolean) : null;
    let initial=workspace.arrange(requested,desk,chair,config);
    if (!savedItems && initial && !initial.items && config.layout!=='double') {
      const alternative=workspace.arrange(requested,desk,chair,{...config,layout:'double'});
      if (alternative?.items) {
        config.layout='double';
        initial=alternative;
      }
    }
    let state={...config,v:2,items:savedItems || initial?.items || []};
    let serial=Math.max(0,...state.items.map(item=>item.id));
    let type='desk';
    let selected=state.items[0]?.id;
    let message=!savedItems && initial && !initial.items ? fitMessage(initial,false) : '';
    let drag;
    const undo=[];
    const controller=new AbortController();
    const events={signal:controller.signal};
    const find=selector=>root.querySelector(selector);
    const button=(name,label,cls='btn secondary')=>'<button type="button" class="'+cls+'" data-plan-action="'+name+'">'+label+'</button>';
    const field=(name,label,min,max,value,step='0.1')=>'<label><span class="field-label">'+label+'</span><input class="field" name="'+name+'" type="number" min="'+min+'" max="'+max+'" step="'+step+'" value="'+value+'" required></label>';
    const option=(value,text,active)=>'<option value="'+value+'" '+(active?'selected':'')+'>'+escape(text)+'</option>';
    const sizeLabel=item=>format.format(item.width)+' × '+format.format(item.depth)+' м';
    const showLabel=item=>labels[item.type]+' '+item.id+(item.label===labels[item.type]?'':' · '+item.label);

    root.innerHTML=
      '<aside class="planner-sidebar"><section class="panel planner-room"><h2>Помещение</h2><form id="room-size" class="form-two">'+
      field('width','Ширина, м',2,60,state.width)+field('depth','Глубина, м',2,60,state.depth)+
      '</form><details class="planner-presets"><summary>Готовая расстановка</summary><form id="plan-presets">'+
      field('seats','Рабочие места',1,40,requested,'1')+
      '<label><span class="field-label">Схема</span><select class="field" name="layout">'+workspace.layouts.map(([id,label])=>option(id,label,state.layout===id)).join('')+'</select></label>'+
      '<div class="form-two">'+field('gap','Между рядами или группами, м',0.5,4,state.gap)+
      '<label><span class="field-label">Модель стола</span><select class="field" name="desk">'+palette.desk.map(model=>option(model.product,model.label,desk?.product===model.product)).join('')+'</select></label></div>'+
      '<p class="small">Заменяет расстановку мебели. Отменить можно над схемой.</p><button type="submit" class="btn secondary">Расставить мебель</button></form></details></section>'+
      '<section class="panel planner-library"><h2>Добавить на план</h2><div class="planner-kinds">'+Object.entries(labels).map(([id,label])=>
          '<button type="button" class="chip" data-plan-type="'+id+'" aria-pressed="'+String(id===type)+'"><i class="plan-swatch '+id+'" aria-hidden="true"></i>'+label+'</button>').join('')+
      '</div><label><span class="field-label">Размер или модель</span><select class="field" id="plan-library-item"></select></label>'+
      button('add','Добавить','btn')+'</section></aside>'+
      '<section class="panel plan-visual"><div class="plan-toolbar"><div><h2>Вид сверху</h2><p id="floor-size" class="small"></p></div><div class="actions">'+
      button('undo','Отменить')+button('download','Скачать PNG')+button('clear','Очистить','btn subtle')+'</div></div>'+
      '<div class="floor-stage" id="room-preview"><div class="floor" aria-label="Схема помещения"></div></div>'+
      '<p class="small plan-instructions">Перетащите предмет. Для точного положения используйте поля ниже или клавиши со стрелками.</p>'+
      '<p id="room-status" class="plan-status" role="status"></p>'+
      '<div id="plan-inspector"><label><span class="field-label">Предмет на плане</span><select class="field" id="plan-selected"></select></label>'+
      '<form id="plan-position" class="form-two">'+field('x','От левой стены, м',0,60,0,'0.001')+
      field('y','От верхней стены, м',0,60,0,'0.001')+'</form>'+
      '<form id="plan-obstacle-size" class="form-two" hidden>'+field('width','Ширина, м',0.1,3,0.9,'0.01')+
      field('depth','Глубина, м',0.1,3,0.9,'0.01')+'</form>'+
      '<div class="actions">'+button('rotate','Повернуть на 90°')+button('copy','Дублировать')+button('delete','Удалить','btn subtle')+'</div></div>'+
      '<div class="plan-export"><p class="small" id="plan-quote-hint"></p><div class="actions">'+
      button('quote','Запросить смету','btn')+'<button class="btn secondary" type="button" id="plan-to-kit" data-plan-action="kit">Применить к комплекту Riva</button></div>'+
      '<p class="small">Черновик сохраняется в этом браузере.</p></div></section>';

    const floor=find('.floor');
    const position=find('#plan-position');
    const roomSize=find('#room-size');
    const presetForm=find('#plan-presets');
    const obstacleSize=find('#plan-obstacle-size');
    const select=find('#plan-selected');
    const library=find('#plan-library-item');
    const action=name=>find('[data-plan-action="'+name+'"]');
    const active=()=>state.items.find(item=>item.id===selected);
    const snapshot=()=>structuredClone(state);
    function fitMessage(result,keep=true) {
      return 'Схеме нужно '+format.format(result.width)+' × '+format.format(result.depth)+' м. '+
        (keep?'Текущая расстановка сохранена.':'Измените размеры или сделайте расстановку вручную.');
    }
    function save() {
      onSave(state);
    }
    function remember(previous) {
      undo.push(previous);
      if (undo.length>30) undo.shift();
    }
    function update(next,selection=selected) {
      remember(snapshot());
      state=next;
      selected=selection;
      message='';
      save();
      render();
    }
    function setType(value) {
      type=value;
      for (const entry of root.querySelectorAll('[data-plan-type]')) entry.setAttribute('aria-pressed',String(entry.dataset.planType===type));
      library.innerHTML=palette[type].map(item=>option(item.product,obstacles[type]?sizeLabel(item):item.label+' · '+sizeLabel(item))).join('');
      action('add').disabled=!palette[type].length || state.items.length>=workspace.maxItems;
    }
    function setGeometry(node,item,problems) {
      const size=sizeOf(item);
      node.style.left=(item.x/state.width*100)+'%';
      node.style.top=(item.y/state.depth*100)+'%';
      node.style.width=(size.width/state.width*100)+'%';
      node.style.height=(size.depth/state.depth*100)+'%';
      node.style.setProperty('--rotation',item.rotation+'deg');
      node.classList.toggle('plan-conflict',problems.has(item.id));
    }
    function paint(problems) {
      Array.from(floor.children).forEach((node,i)=>setGeometry(node,state.items[i],problems));
    }
    function status(problems) {
      const desks=state.items.filter(item=>item.type==='desk').length;
      const chairs=state.items.filter(item=>item.type==='chair').length;
      const storage=state.items.filter(item=>item.type==='storage').length;
      const summary='Столы '+desks+' · Кресла '+chairs+' · Тумбы '+storage;
      const label=find('#room-status');
      label.textContent=message || (problems.size?'Есть пересечения или предметы за границей комнаты. Исправьте выделенные места.':state.items.length?summary:'Добавьте мебель или выберите готовую расстановку.');
      label.classList.toggle('does-not-fit',Boolean(message || problems.size));
      const valid=!problems.size && desks+chairs+storage>0;
      const kit=valid && workspace.kitFor(state);
      action('quote').disabled=!valid;
      action('kit').disabled=!kit;
      find('#plan-quote-hint').textContent=valid && !kit?'Для комплекта Riva выберите одинаковое число столов и кресел, по одной модели каждого типа. По этому плану можно запросить смету.':'';
    }
    function render() {
      const item=active();
      const problems=workspace.conflicts(state);
      const ratio=state.width/state.depth;
      floor.style.setProperty('--floor-ratio',ratio);
      floor.style.maxWidth='min(100%, '+ratio*470+'px)';
      floor.style.setProperty('--grid-x',(0.5/state.width*100)+'%');
      floor.style.setProperty('--grid-y',(0.5/state.depth*100)+'%');
      find('#floor-size').textContent=format.format(state.width)+' × '+format.format(state.depth)+' м · клетка 0,5 м';
      floor.innerHTML=state.items.map(element=>'<button type="button" class="plan-object '+element.type+'" data-piece="'+element.id+
        '" tabindex="'+(element.id===(selected || state.items[0]?.id)?0:-1)+'" aria-label="'+escape(showLabel(element))+'" aria-pressed="'+(selected===element.id)+
        '" title="'+escape(showLabel(element))+'"><span>'+element.id+'</span></button>').join('');
      paint(problems);
      select.innerHTML='<option value="">Выберите предмет</option>'+state.items.map(element=>option(element.id,showLabel(element),element.id===selected)).join('');
      select.disabled=!state.items.length;
      for (const name of ['x','y']) {
        position.elements[name].disabled=!item;
        position.elements[name].value=item?.[name] ?? '';
      }
      obstacleSize.hidden=!item || !obstacles[item.type];
      if (!obstacleSize.hidden) for (const name of ['width','depth']) obstacleSize.elements[name].value=item[name];
      for (const name of ['rotate','copy','delete']) action(name).disabled=!item || (name==='copy' && state.items.length>=workspace.maxItems);
      action('add').disabled=!palette[type].length || state.items.length>=workspace.maxItems;
      action('undo').disabled=!undo.length;
      action('clear').disabled=!state.items.length;
      action('download').disabled=!state.items.length;
      status(problems);
    }
    function replace(item) {
      const size=sizeOf(item);
      if (size.width>state.width+.001 || size.depth>state.depth+.001) {
        message='Предмет в таком размере или положении не помещается в комнате.';
        render();
        return;
      }
      const placed=bounded(item,state);
      update({...state,items:state.items.map(object=>object.id===item.id?placed:object)},item.id);
    }
    function place(model) {
      if (!model || state.items.length>=workspace.maxItems) return;
      const occupied=state.items.map(item=>({...item,...sizeOf(item)}));
      const {width,depth}=sizeOf(model);
      const xs=[0,...occupied.map(item=>round(item.x+item.width+.05))];
      const ys=[0,...occupied.map(item=>round(item.y+item.depth+.05))];
      for (const y of ys.sort((a,b)=>a-b)) {
        if (y+depth>state.depth+.001) continue;
        for (const x of xs.sort((a,b)=>a-b)) {
          if (x+width>state.width+.001) break;
          if (occupied.some(item=>x<item.x+item.width && item.x<x+width && y<item.y+item.depth && item.y<y+depth)) continue;
          const item={...model,id:++serial,x,y};
          update({...state,items:[...state.items,item]},item.id);
          return;
        }
      }
      message='Для предмета нет свободного места. Передвиньте мебель или увеличьте помещение.';
      status(workspace.conflicts(state));
    }
    function invoke(name) {
      const item=active();
      if (name==='add') {
        const model=preset(type,Number(library.value));
        if (model) place({...model,rotation:0});
      }
      if (name==='copy' && item) place(item);
      if (name==='rotate' && item) replace({...item,rotation:(item.rotation+90)%360});
      if (name==='delete' && item) update({...state,items:state.items.filter(object=>object.id!==item.id)},null);
      if (name==='clear') update({...state,items:[]},null);
      if (name==='download') workspace.download(state);
      if (name==='undo' && undo.length) {
        state=undo.pop();
        message='';
        selected=active()?.id || state.items[0]?.id;
        for (const key of ['width','depth']) roomSize.elements[key].value=state[key];
        for (const key of ['layout','gap']) presetForm.elements[key].value=state[key];
        save();
        render();
      }
      if (name==='quote' || name==='kit') {
        save();
        const plan=snapshot();
        if (!workspace.conflicts(plan).size) {
          if (name==='quote') onQuote(plan);
          else {
            const kit=workspace.kitFor(plan);
            if (kit) onKit(plan,kit);
          }
        }
      }
    }

    root.addEventListener('submit',event=>{
      event.preventDefault();
      event.stopPropagation();
      if (event.target!==presetForm) return;
      if (!roomSize.reportValidity()) return;
      const values=presetForm.elements;
      const next={...state,layout:values.layout.value,gap:Number(values.gap.value)};
      const result=workspace.arrange(Number(values.seats.value),preset('desk',Number(values.desk.value)),chair,next);
      if (!result?.items) {
        message=result?fitMessage(result):'Выберите модель стола и число мест.';
        status(workspace.conflicts(state));
        return;
      }
      const furniture=result.items.map(item=>({...item,id:++serial}));
      const items=[...state.items.filter(item=>obstacles[item.type]),...furniture];
      if (items.length>workspace.maxItems) return;
      update({...next,items},furniture[0].id);
    },events);

    root.addEventListener('change',event=>{
      const input=event.target;
      if (input===select) {selected=Number(select.value)||null;render();}
      if (input.form===roomSize) {
        if (!roomSize.checkValidity()) {
          input.value=state[input.name];
          message='Укажите ширину и глубину помещения от 2 до 60 м.';
          status(workspace.conflicts(state));
          return;
        }
        const room={...state,width:Number(roomSize.elements.width.value),depth:Number(roomSize.elements.depth.value)};
        const oversized=state.items.some(item=>{
          const size=sizeOf(item);
          return size.width>room.width+.001 || size.depth>room.depth+.001;
        });
        if (oversized) {
          input.value=state[input.name];
          message='С такими размерами часть мебели не поместится. Сначала передвиньте, поверните или удалите предмет.';
          status(workspace.conflicts(state));
        } else update({...room,items:state.items.map(item=>bounded(item,room))});
      }
      const item=active();
      if (item && input.form===obstacleSize && obstacleSize.checkValidity()) replace({...item,[input.name]:Number(input.value)});
      if (item && input.form===position && input.checkValidity()) replace({...item,[input.name]:Number(input.value)});
    },events);
    root.addEventListener('click',event=>{
      const target=event.target.closest('button');
      if (target?.dataset.planType) setType(target.dataset.planType);
      if (target?.dataset.planAction) invoke(target.dataset.planAction);
      if (target?.dataset.piece) {
        selected=Number(target.dataset.piece);
        render();
        floor.querySelector('[data-piece="'+selected+'"]')?.focus({preventScroll:true});
      }
    },events);

    function moveSelection(event) {
      const target=event.target.closest('[data-piece]');
      if (!target) return;
      const item=state.items.find(item=>item.id===Number(target.dataset.piece));
      const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
      if (!delta && !['Delete','Backspace','r','к'].includes(event.key)) return;
      event.preventDefault();
      selected=item.id;
      if (delta) {
        const step=event.shiftKey?.25:.05;
        replace({...item,x:round(item.x+delta[0]*step),y:round(item.y+delta[1]*step)});
      } else invoke(['r','к'].includes(event.key)?'rotate':'delete');
      (floor.querySelector('[data-piece="'+selected+'"]') || select).focus({preventScroll:true});
    }
    floor.addEventListener('keydown',moveSelection,events);
    floor.addEventListener('pointerdown',event=>{
      const node=event.target.closest('[data-piece]');
      if (!node || drag || event.button!==0) return;
      event.preventDefault();
      const id=Number(node.dataset.piece);
      const item=state.items.find(object=>object.id===id);
      drag={id,pointer:event.pointerId,item:{...item},clientX:event.clientX,clientY:event.clientY,previous:snapshot()};
      selected=id;
      const previous=floor.querySelector('[aria-pressed=true]');
      if (previous) {previous.setAttribute('aria-pressed','false');previous.tabIndex=-1;}
      node.setAttribute('aria-pressed','true');
      node.tabIndex=0;
      node.focus({preventScroll:true});
      floor.setPointerCapture(event.pointerId);
    },events);
    floor.addEventListener('pointermove',event=>{
      if (drag?.pointer!==event.pointerId) return;
      const x=event.clientX-drag.clientX,y=event.clientY-drag.clientY;
      if (!drag.moved && Math.abs(x)+Math.abs(y)<3) return;
      drag.moved=true;
      const rect=floor.getBoundingClientRect();
      const item=bounded({...drag.item,x:snap(drag.item.x+x/rect.width*state.width),y:snap(drag.item.y+y/rect.height*state.depth)},state);
      state.items=state.items.map(object=>object.id===item.id?item:object);
      paint(workspace.conflicts(state));
    },events);
    function finishDrag(event) {
      if (drag?.pointer!==event.pointerId) return;
      if (event.type==='pointercancel') state=drag.previous;
      else if (drag.moved) {remember(drag.previous);message='';save();}
      drag=null;
      render();
      floor.querySelector('[data-piece="'+selected+'"]')?.focus({preventScroll:true});
    }
    floor.addEventListener('pointerup',finishDrag,events);
    floor.addEventListener('pointercancel',finishDrag,events);
    setType(type);
    render();
    save();
    return ()=>controller.abort();
  }

  return {mount};
})();
