'use strict';

const officePlanner = (() => {
  const format = new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
  const escape = site.escape;
  const {labels,obstacles,offices,customDesk,round,snap,sizeOf,bounded}=workspace;

  function mount(root,{draft,count,models,defaultDesk,defaultChair,onSave,onQuote,onKit}) {
    const palette = Object.fromEntries(Object.keys(labels).map(type=>[type,
      obstacles[type] ? [obstacles[type]] : models.filter(model=>model.type===type)]));
    const config=workspace.planSettings(draft);
    const preset=(type,product)=>palette[type].find(item=>item.product===product) || palette[type][0];
    const fromDraft = item => {
      if (!Number.isInteger(item.id) || item.id<1 || !Number.isFinite(item.x) || !Number.isFinite(item.y) ||
          ![0,90,180,270].includes(item.rotation) || !palette[item.type]) return null;
      const custom=item.type==='desk' && item.product===0 && [item.width,item.depth].every(value=>Number.isFinite(value) && value>=.3 && value<=4);
      const height=item.height>=.4 && item.height<=1.6 ? item.height : .75;
      const model=custom ? customDesk(item.width,item.depth,height) : palette[item.type].find(model=>model.product===item.product);
      if (!model) return null;
      const size=obstacles[item.type] && [item.width,item.depth].every(value=>Number.isFinite(value) && value>=.1 && value<=3)
        ? {width:item.width,depth:item.depth} : {};
      return bounded({...item,...model,...size},config);
    };
    const requested=Math.min(count,40);
    const savedDesk=Array.isArray(draft.items)?draft.items.find(item=>item.type==='desk'):null;
    const desk=savedDesk ? fromDraft(savedDesk) || preset('desk',defaultDesk) : preset('desk',draft.desk || defaultDesk);
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
    let roomEdit;
    let zoom=1;
    const undo=[];
    const controller=new AbortController();
    const events={signal:controller.signal};
    const find=selector=>root.querySelector(selector);
    const button=(name,label,cls='btn secondary')=>'<button type="button" class="'+cls+'" data-plan-action="'+name+'">'+label+'</button>';
    const field=(name,label,min,max,value,step='0.1')=>'<label><span class="field-label">'+label+'</span><input class="field" name="'+name+'" type="number" min="'+min+'" max="'+max+'" step="'+step+'" value="'+value+'" required></label>';
    const option=(value,text,active)=>'<option value="'+value+'" '+(active?'selected':'')+'>'+escape(text)+'</option>';
    const sizeLabel=item=>format.format(item.width)+' × '+format.format(item.depth)+' м';
    const showLabel=item=>labels[item.type]+' '+item.id+(item.label===labels[item.type]?'':' · '+item.label);
    const customFields=(id,width,depth,height=750)=>'<div class="form-two custom-desk-fields" id="'+id+'" hidden>'+
      field('deskWidth','Ширина стола, мм',300,4000,width,'1')+field('deskDepth','Глубина стола, мм',300,4000,depth,'1')+
      field('deskHeight','Высота стола, мм',400,1600,height,'1')+'</div>';
    const presetDeskOptions=palette.desk.map(model=>option(model.product,model.label+' · '+sizeLabel(model),desk?.product===model.product)).join('')+
      option(0,'Стол по своим размерам',desk?.product===0);

    root.innerHTML=
      '<aside class="planner-sidebar"><section class="panel planner-room"><h2>Помещение</h2><form id="room-size" class="form-two">'+
      field('width','Ширина комнаты, м',2,60,state.width,'0.01')+field('depth','Глубина комнаты, м',2,60,state.depth,'0.01')+
      '</form><p id="room-area" class="room-area"></p><details class="planner-presets"><summary>Тип офиса и расстановка</summary><form id="plan-presets">'+
      '<label><span class="field-label">Тип офиса</span><select class="field" name="office">'+Object.entries(offices).map(([key,label])=>option(key,label,state.office===key)).join('')+'</select></label>'+
      '<div id="preset-furniture">'+field('seats','Количество мест',1,40,requested,'1')+
      '<label><span class="field-label">Схема</span><select class="field" name="layout">'+workspace.layouts.map(([id,label])=>option(id,label,state.layout===id)).join('')+'</select></label>'+
      field('gap','Между рядами или группами, м',0.5,4,state.gap,'0.05')+
      '<label><span class="field-label">Стол</span><select class="field" name="desk">'+presetDeskOptions+'</select></label>'+
      customFields('preset-custom-desk',desk?.product===0?Math.round(desk.width*1000):1600,desk?.product===0?Math.round(desk.depth*1000):800,
        desk?.product===0?Math.round(desk.height*1000):750)+'</div>'+
      '<p class="small">Заменяет расстановку мебели. Отменить можно над схемой.</p><button type="submit" class="btn secondary">Расставить мебель</button></form></details></section>'+
      '<section class="panel planner-library"><h2>Добавить на план</h2><div class="planner-kinds">'+Object.entries(labels).map(([id,label])=>
          '<button type="button" class="chip" data-plan-type="'+id+'" aria-pressed="'+String(id===type)+'"><i class="plan-swatch '+id+'" aria-hidden="true"></i>'+label+'</button>').join('')+
      '</div><label><span class="field-label">Размер или модель</span><select class="field" id="plan-library-item"></select></label>'+
      customFields('library-custom-desk',1600,800)+
      button('add','Добавить','btn')+'</section></aside>'+
      '<section class="panel plan-visual"><div class="plan-toolbar"><div><h2>Вид сверху</h2><p id="floor-size" class="small"></p></div><div class="actions">'+
      button('library','Добавить мебель','btn plan-library-trigger')+button('undo','Отменить')+button('download','Скачать PNG')+button('clear','Очистить','btn subtle')+'</div></div>'+
      '<div class="plan-zoom" aria-label="Масштаб схемы">'+
      '<button type="button" class="btn secondary" data-plan-action="zoom-out" aria-label="Уменьшить схему">−</button>'+
      '<output id="plan-zoom-level" aria-label="Масштаб">100%</output>'+
      '<button type="button" class="btn secondary" data-plan-action="zoom-in" aria-label="Увеличить схему">+</button>'+
      button('zoom-fit','Вписать')+'</div>'+
      '<div class="floor-stage" id="room-preview"><div class="floor-scroll-area"><div class="floor" aria-label="Схема помещения"></div></div></div>'+
      '<p id="room-status" class="plan-status" role="status"></p>'+
      '<div id="plan-inspector"><label><span class="field-label">Предмет на плане</span><select class="field" id="plan-selected"></select></label>'+
      '<div class="actions">'+button('rotate','Повернуть на 90°')+button('copy','Дублировать')+button('delete','Удалить','btn subtle')+'</div>'+
      '<details class="plan-position-details" '+(matchMedia('(min-width:961px)').matches?'open':'')+'><summary>Положение и размеры</summary>'+
      '<form id="plan-position" class="form-two">'+field('x','От левой стены, м',0,60,0,'0.001')+
      field('y','От верхней стены, м',0,60,0,'0.001')+'</form>'+
      '<form id="plan-obstacle-size" class="form-two" hidden>'+field('width','Ширина, м',0.1,3,0.9,'0.01')+
      field('depth','Глубина, м',0.1,3,0.9,'0.01')+'</form>'+
      '<form id="plan-custom-size" class="form-two" hidden>'+field('width','Ширина стола, мм',300,4000,1600,'1')+
      field('depth','Глубина стола, мм',300,4000,800,'1')+field('height','Высота стола, мм',400,1600,750,'1')+'</form>'+
      '</details></div>'+
      '<p class="small plan-instructions">Перетащите предмет. Для точного положения откройте «Положение и размеры» или используйте клавиши со стрелками.</p>'+
      '<dl class="plan-metrics" id="plan-metrics" aria-label="Расчёт планировки"></dl>'+
      '<div class="plan-export"><p class="small" id="plan-quote-hint"></p><div class="actions">'+
      button('quote','Запросить смету','btn')+'<button class="btn secondary" type="button" id="plan-to-kit" data-plan-action="kit">Применить к комплекту Riva</button></div>'+
      '<p class="small">Черновик сохраняется в этом браузере.</p></div></section>'+
      '<dialog class="plan-library-dialog" aria-labelledby="plan-library-title"><div class="plan-library-heading">'+
      '<h2 id="plan-library-title">Добавить мебель</h2><button type="button" class="plan-library-close" data-plan-action="close-library" aria-label="Закрыть библиотеку мебели">×</button></div>'+
      '<div class="plan-library-content"></div></dialog>';

    const floor=find('.floor');
    const position=find('#plan-position');
    const roomSize=find('#room-size');
    const presetForm=find('#plan-presets');
    const obstacleSize=find('#plan-obstacle-size');
    const customSize=find('#plan-custom-size');
    const select=find('#plan-selected');
    const library=find('#plan-library-item');
    const action=name=>find('[data-plan-action="'+name+'"]');
    const stage=find('#room-preview');
    const libraryPanel=find('.planner-library');
    const libraryDialog=find('.plan-library-dialog');
    const mobile=matchMedia('(max-width:960px)');
    function syncLibrary() {
      const destination=mobile.matches?find('.plan-library-content'):find('.planner-sidebar');
      if (libraryPanel.parentElement!==destination) destination.append(libraryPanel);
      if (!mobile.matches && libraryDialog.open) libraryDialog.close();
    }
    libraryDialog.addEventListener('close',()=>{
      document.body.classList.remove('plan-library-open');
      if (mobile.matches) action('library').focus({preventScroll:true});
    },events);
    mobile.addEventListener('change',syncLibrary,events);
    syncLibrary();
    function scaleFloor() {
      const area=find('.floor-scroll-area');
      const padding=getComputedStyle(area);
      const available=Math.max(60,stage.clientWidth-parseFloat(padding.paddingLeft)-parseFloat(padding.paddingRight)-4);
      const ratio=state.width/state.depth;
      const fit=Math.min(available,state.width*105,ratio*470);
      floor.style.width=fit*zoom+'px';
      floor.style.maxWidth='none';
      find('#plan-zoom-level').textContent=Math.round(zoom*100)+'%';
      action('zoom-out').disabled=zoom<=1;
      action('zoom-in').disabled=zoom>=4;
    }
    let stageWidth;
    const resizeObserver=new ResizeObserver(()=>{
      if (stageWidth===stage.clientWidth) return;
      stageWidth=stage.clientWidth;
      scaleFloor();
    });
    resizeObserver.observe(stage);
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
      if (type==='desk') library.add(new Option('Стол по своим размерам','0'));
      find('#library-custom-desk').hidden=type!=='desk' || library.value!=='0';
      action('add').disabled=!palette[type].length || state.items.length>=workspace.maxItems;
    }
    function readCustom(section) {
      const fields=[...section.querySelectorAll('input')];
      if (!fields.every(field=>field.reportValidity())) return null;
      return customDesk(...fields.map(field=>Number(field.value)/1000));
    }
    function syncPreset(updateDefaults=false) {
      const {office,layout,gap,seats,desk}=presetForm.elements;
      const isMeeting=office.value==='meeting';
      const free=office.value==='free';
      if (updateDefaults && !free) {
        layout.value=office.value==='private'?'single':'double';
        seats.value=office.value==='private'?'1':isMeeting?'6':String(requested);
        if (isMeeting) {
          desk.value='0';
          presetForm.elements.deskWidth.value='2400';
          presetForm.elements.deskDepth.value='1000';
        } else desk.value=String(preset('desk',defaultDesk)?.product ?? 0);
      }
      find('#preset-furniture').hidden=free;
      for (const field of [layout,gap]) {
        field.closest('label').hidden=free || isMeeting;
        field.disabled=free || isMeeting;
      }
      for (const field of [seats,desk]) field.disabled=free;
      const isCustom=!free && desk.value==='0';
      find('#preset-custom-desk').hidden=!isCustom;
      for (const field of [presetForm.elements.deskWidth,presetForm.elements.deskDepth,presetForm.elements.deskHeight]) field.disabled=!isCustom;
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
      const custom=state.items.some(item=>item.type==='desk' && !item.product);
      find('#plan-quote-hint').textContent=valid && !kit ? (custom?'Столы по своим размерам можно передать в запрос сметы.':'Для комплекта Riva выберите одинаковое число столов и кресел, по одной модели каждого типа.') : '';
      const area=state.width*state.depth;
      find('#room-area').textContent='Площадь '+format.format(area)+' м²';
      const taken=state.items.reduce((sum,item)=>sum+item.width*item.depth,0);
      const priced=state.items.filter(item=>item.product && item.price!=null);
      const total=priced.reduce((sum,item)=>sum+item.price,0);
      const ask=custom || state.items.some(item=>item.product && item.price==null);
      const labels = [
        ['Свободная площадь',problems.size?'Уточните расстановку':format.format(Math.max(0,area-taken))+' м²'],
        ['Места',state.office==='meeting'?chairs:desks],
        ['Мебель по каталогу',priced.length?site.format(total)+(ask?' + по запросу':''):ask?'По запросу':'—']
      ];
      find('#plan-metrics').innerHTML=labels.map(([label,value])=>'<div><dt>'+escape(label)+'</dt><dd>'+escape(value)+'</dd></div>').join('');
    }
    function render() {
      const item=active();
      const problems=workspace.conflicts(state);
      const ratio=state.width/state.depth;
      floor.style.setProperty('--floor-ratio',ratio);
      scaleFloor();
      floor.style.setProperty('--grid-x',(0.5/state.width*100)+'%');
      floor.style.setProperty('--grid-y',(0.5/state.depth*100)+'%');
      find('#floor-size').textContent=offices[state.office]+' · '+format.format(state.width)+' × '+format.format(state.depth)+' м · клетка 0,5 м';
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
      customSize.hidden=!item || item.type!=='desk' || Boolean(item.product);
      if (!customSize.hidden) for (const name of ['width','depth','height']) customSize.elements[name].value=Math.round(item[name]*1000);
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
      if (name==='library') {
        libraryDialog.showModal();
        document.body.classList.add('plan-library-open');
      }
      if (name==='close-library') libraryDialog.close();
      if (['zoom-in','zoom-out','zoom-fit'].includes(name)) {
        const next=name==='zoom-fit'?1:Math.min(4,Math.max(1,zoom+(name==='zoom-in'?.25:-.25)));
        const factor=next/zoom;
        const left=(stage.scrollLeft+stage.clientWidth/2)*factor-stage.clientWidth/2;
        const top=(stage.scrollTop+stage.clientHeight/2)*factor-stage.clientHeight/2;
        zoom=next;
        scaleFloor();
        stage.scrollTo({left:name==='zoom-fit'?0:left,top:name==='zoom-fit'?0:top,behavior:'instant'});
      }
      if (name==='add') {
        const model=type==='desk' && library.value==='0' ? readCustom(find('#library-custom-desk')) : preset(type,Number(library.value));
        const before=state.items.length;
        if (model) place({...model,rotation:0});
        if (libraryDialog.open && state.items.length>before) libraryDialog.close();
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
        presetForm.elements.office.value=state.office;
        syncPreset();
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
      const next={...state,office:values.office.value,layout:values.layout.value,gap:Number(values.gap.value)};
      const free=next.office==='free';
      const model=!free && values.desk.value==='0' ? readCustom(find('#preset-custom-desk')) : preset('desk',Number(values.desk.value));
      const result=free?{items:[]}:workspace.arrange(Number(values.seats.value),model,chair,next);
      if (!result?.items) {
        message=result?fitMessage(result):'Выберите модель стола и число мест.';
        status(workspace.conflicts(state));
        return;
      }
      const furniture=result.items.map(item=>({...item,id:++serial}));
      const items=[...state.items.filter(item=>obstacles[item.type]),...furniture];
      if (items.length>workspace.maxItems) return;
      update({...next,items},items[0]?.id);
    },events);

    function resizeRoom(input,finished) {
      if (!roomSize.checkValidity()) {
        if (finished) {
          input.value=state[input.name];
          message='Укажите размеры комнаты от 2 до 60 м с точностью до сантиметра.';
          status(workspace.conflicts(state));
        }
        return;
      }
      const width=Number(roomSize.elements.width.value);
      const depth=Number(roomSize.elements.depth.value);
      if (state.width===width && state.depth===depth) return;
      const room={...state,width,depth};
      const oversized=state.items.some(item=>{
        const size=sizeOf(item);
        return size.width>room.width+.001 || size.depth>room.depth+.001;
      });
      if (oversized) {
        if (finished) input.value=state[input.name];
        message='При этих размерах один из предметов не помещается. Поверните или удалите его.';
        status(workspace.conflicts(state));
        return;
      }
      roomEdit ||= {original:snapshot(),remembered:false};
      if (!roomEdit.remembered) {
        remember(roomEdit.original);
        roomEdit.remembered=true;
      }
      state={...room,items:roomEdit.original.items.map(item=>bounded(item,room))};
      message='';
      save();
      render();
    }
    roomSize.addEventListener('focusin',()=>{roomEdit={original:snapshot(),remembered:false};},events);
    roomSize.addEventListener('input',event=>resizeRoom(event.target,false),events);
    roomSize.addEventListener('focusout',()=>{roomEdit=null;},events);
    root.addEventListener('change',event=>{
      const input=event.target;
      if (input===select) {selected=Number(select.value)||null;render();}
      if (input.form===roomSize) resizeRoom(input,true);
      if (input===library) find('#library-custom-desk').hidden=type!=='desk' || library.value!=='0';
      if (input===presetForm.elements.office || input===presetForm.elements.desk) syncPreset(input===presetForm.elements.office);
      const item=active();
      if (item && input.form===obstacleSize && obstacleSize.checkValidity()) replace({...item,[input.name]:Number(input.value)});
      if (item && input.form===customSize && customSize.checkValidity()) {
        const sizes=['width','depth','height'].map(name=>Number(customSize.elements[name].value)/1000);
        replace({...item,...customDesk(...sizes)});
      }
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
    syncPreset();
    render();
    save();
    return ()=>{
      controller.abort();
      resizeObserver.disconnect();
      if (libraryDialog.open) libraryDialog.close();
      document.body.classList.remove('plan-library-open');
    };
  }

  return {mount};
})();
