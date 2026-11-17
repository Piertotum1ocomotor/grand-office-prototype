'use strict';

const workspace = (() => {
  const layouts = [
    ['single','Один ряд'],
    ['double','Два ряда'],
    ['islands','Группы по четыре']
  ];
  const offices = {open:'Открытый офис',private:'Кабинет',meeting:'Переговорная',free:'Свободная расстановка'};

  function readNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= minimum && number <= maximum ? number : fallback;
  }

  function planSettings(value) {
    return {
      width: readNumber(value?.width,2,60,8),
      depth: readNumber(value?.depth,2,60,4.5),
      gap: readNumber(value?.gap,0.5,4,1),
      layout: layouts.some(([id])=>id===value?.layout) ? value.layout : 'double',
      office: Object.hasOwn(offices,value?.office) ? value.office : 'open'
    };
  }

  const labels = {desk:'Стол',chair:'Кресло',storage:'Тумба',door:'Дверной проём',column:'Колонна'};
  const colors = {desk:'#e7c0ac',chair:'#d5e1d8',storage:'#d9cbbc',door:'#e4edf7',column:'#c5cbd1'};
  const obstacles = {
    door:{type:'door',product:0,width:0.9,depth:0.9,label:labels.door},
    column:{type:'column',product:0,width:0.4,depth:0.4,label:labels.column}
  };
  const maxItems = 120;
  const epsilon = .001;
  const round = value=>Math.round(value*1000)/1000;
  const snap = value=>Math.round(value*20)/20;
  const sizeOf = (item) => item.rotation % 180 ? {width:item.depth,depth:item.width} : {width:item.width,depth:item.depth};
  const customDesk=(width,depth,height=.75)=>({
    type:'desk',product:0,width,depth,height,
    label:'Стол по размеру '+[width,depth,height].map(value=>Math.round(value*1000)).join(' × ')+' мм'
  });
  const itemKey=item=>item.product || (item.type==='desk'?'desk:'+item.width+':'+item.depth+':'+item.height:item.type);

  function arrange(count, desk, chair, room) {
    if (!Number.isInteger(count) || count < 1 || count > 40 || !desk || !chair) return null;
    if (room.office==='meeting') {
      const topCount=Math.ceil(count/2);
      const width=Math.max(desk.width,topCount*chair.width);
      const depth=desk.depth+chair.depth*(count>1?2:1);
      const items=[
        {...desk,id:1,x:(width-desk.width)/2,y:chair.depth,rotation:0},
        ...Array.from({length:count},(_,i)=>{
          const top=i<topCount;
          const rowCount=top?topCount:count-topCount;
          const index=top?i:i-topCount;
          return {...chair,id:i+2,x:(width-rowCount*chair.width)/2+index*chair.width,
            y:top?0:chair.depth+desk.depth,rotation:top?0:180};
        })
      ];
      return center(items,width,depth,room);
    }
    const columnWidth = Math.max(desk.width,chair.width);
    const pitch = desk.depth + chair.depth;
    const perRow = room.layout==='single' ? count : Math.ceil(count/2);
    const items = Array.from({length:count},(_,index)=>{
      const second = room.layout==='islands' ? index % 4 >= 2 : index >= perRow;
      const column = room.layout==='islands' ? (index % 2) : index % perRow;
      const group = room.layout==='islands' ? Math.floor(index/4) : 0;
      const x = column * columnWidth + group * (2 * columnWidth + room.gap);
      return [
        {...desk,id:2*index+1,x:x+(columnWidth-desk.width)/2,y:second?pitch+room.gap:chair.depth,rotation:second?180:0},
        {...chair,id:2*index+2,x:x+(columnWidth-chair.width)/2,y:second?pitch+room.gap+desk.depth:0,rotation:second?180:0}
      ];
    }).flat();
    const width=Math.max(...items.map(item=>item.x+item.width));
    const depth=Math.max(...items.map(item=>item.y+item.depth));
    return center(items,width,depth,room);
  }

  function center(items,width,depth,room) {
    if (width>room.width+epsilon || depth>room.depth+epsilon) return {width,depth,items:null};
    return {width,depth,items:items.map(item=>({...item,x:round(item.x+(room.width-width)/2),y:round(item.y+(room.depth-depth)/2)}))};
  }

  function bounded(item, room) {
    const {width,depth}=sizeOf(item);
    return {...item,x:round(Math.max(0,Math.min(item.x,room.width-width))),y:round(Math.max(0,Math.min(item.y,room.depth-depth)))};
  }

  function conflicts(room) {
    const found=new Set();
    const rects=room.items.map(item=>({...item,...sizeOf(item)}));
    rects.forEach((rect,i)=>{
      if (rect.x<0 || rect.y<0 || rect.x+rect.width>room.width+epsilon || rect.y+rect.depth>room.depth+epsilon) found.add(rect.id);
      for (const other of rects.slice(i+1)) {
        if (rect.x+epsilon<other.x+other.width && other.x+epsilon<rect.x+rect.width &&
            rect.y+epsilon<other.y+other.depth && other.y+epsilon<rect.y+rect.depth) {
          found.add(rect.id);
          found.add(other.id);
        }
      }
    });
    return found;
  }

  function composition(plan) {
    const groups=new Map();
    for (const item of plan.items) {
      if (!item.product && item.type!=='desk') continue;
      const key=itemKey(item);
      const entry=groups.get(key);
      if (entry) entry.count++;
      else groups.set(key,{type:item.type,id:item.product,label:item.label,count:1});
    }
    return [...groups.values()];
  }

  function kitFor(plan) {
    const all=composition(plan);
    const desk=all.find(item=>item.type==='desk');
    const chair=all.find(item=>item.type==='chair');
    if (!desk || !desk.id || !chair || desk.count!==chair.count || all.length!==new Set(all.map(item=>item.type)).size) return null;
    return {seats:desk.count,desk:desk.id,groups:all};
  }

  function seats(plan) {
    const type=plan.office==='meeting'?'chair':'desk';
    return plan.items.filter(item=>item.type===type).length;
  }

  function download(plan) {
    const scale=Math.min(112,1500/Math.max(plan.width,plan.depth));
    const inventory=new Map();
    for (const item of plan.items) {
      const key=itemKey(item);
      if (!inventory.has(key)) inventory.set(key,{type:item.type,label:item.label,ids:[]});
      inventory.get(key).ids.push(item.id);
    }
    const legend=[...inventory.values()].flatMap(({type,label,ids})=>Array.from({length:Math.ceil(ids.length/12)},(_,i)=>({
      color:colors[type],text:(i?'':label+' · ')+ids.slice(i*12,(i+1)*12).map(id=>'№'+id).join(', ')
    })));
    const canvas=document.createElement('canvas');
    const padding=54;
    canvas.width=Math.ceil(Math.max(540,plan.width*scale+2*padding));
    canvas.height=Math.ceil(plan.depth*scale+2*padding+legend.length*20);
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#fff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.font='18px sans-serif';
    ctx.fillStyle='#282828';
    const title=offices[plan.office] || 'План офиса';
    ctx.fillText(title+' · '+plan.width+' × '+plan.depth+' м',padding,32);
    ctx.save();
    ctx.translate((canvas.width-plan.width*scale)/2,padding);
    for (let x=0;x<plan.width;x++) {
      ctx.fillStyle='#eee9e2';
      ctx.fillRect(x*scale,0,1,plan.depth*scale);
    }
    for (let y=0;y<plan.depth;y++) ctx.fillRect(0,y*scale,plan.width*scale,1);
    const problems=conflicts(plan);
    for (const item of plan.items) {
      const size=sizeOf(item);
      const x=item.x*scale,y=item.y*scale,w=size.width*scale,h=size.depth*scale;
      ctx.fillStyle=colors[item.type];
      ctx.strokeStyle=problems.has(item.id)?'#a14232':'#6f6258';
      ctx.beginPath();
      if (item.type==='chair') ctx.ellipse(x+w/2,y+h/2,w/2,h/2,0,0,2*Math.PI);
      else ctx.rect(x,y,w,h);
      ctx.fill();
      ctx.stroke();
      if (w>17 && h>13) {
        ctx.fillStyle='#282828';
        ctx.font=(w>68 && h>22?'13':'10')+'px sans-serif';
        const label=labels[item.type]+' '+item.id;
        const text=ctx.measureText(label).width<w-7?label:String(item.id);
        ctx.fillText(text,x+(w-ctx.measureText(text).width)/2,y+h/2+4);
      }
    }
    ctx.strokeStyle='#3a3835';
    ctx.strokeRect(0,0,plan.width*scale,plan.depth*scale);
    ctx.restore();
    ctx.font='14px sans-serif';
    legend.forEach(({color,text},i)=>{
      const y=2*padding+plan.depth*scale+20*i-20;
      ctx.fillStyle=color;
      ctx.fillRect(padding,y-10,12,12);
      ctx.fillStyle='#282828';
      ctx.fillText(text,padding+21,y,canvas.width-2*padding-21);
    });
    canvas.toBlob(blob=>{
      if (!blob) return;
      const url=URL.createObjectURL(blob);
      const anchor=document.createElement('a');
      anchor.href=url;
      anchor.download='План офиса.png';
      anchor.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    },'image/png');
  }

  return {layouts,offices,labels,obstacles,maxItems,round,snap,planSettings,arrange,sizeOf,bounded,conflicts,composition,kitFor,seats,customDesk,download};
})();
