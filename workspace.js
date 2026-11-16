'use strict';

const workspace = (() => {
  const layouts = [
    ['single','Один ряд'],
    ['double','Два ряда'],
    ['islands','Группы по четыре']
  ];

  function readNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= minimum && number <= maximum ? number : fallback;
  }

  function planSettings(value) {
    return {
      width: readNumber(value?.width,2,60,8),
      depth: readNumber(value?.depth,2,60,4.5),
      gap: readNumber(value?.gap,0.5,4,1),
      layout: layouts.some(([id])=>id===value?.layout) ? value.layout : 'double'
    };
  }

  function arrange(count, table, room) {
    if (!Number.isInteger(count) || count < 1 || count > 40 || !table?.[0] || !table[1]) return null;
    const width = table[0] / 1000;
    const depth = table[1] / 1000;
    const chair = 0.7;
    const pitch = depth + chair;
    const perRow = room.layout==='single' ? count : Math.ceil(count/2);
    const tables = Array.from({length:count},(_,index)=>{
      const second = room.layout==='islands' ? index % 4 >= 2 : index >= perRow;
      const column = room.layout==='islands' ? (index % 2) : index % perRow;
      const group = room.layout==='islands' ? Math.floor(index/4) : 0;
      const x = column * width + group * (2 * width + room.gap);
      const chairTop = second ? 2 * pitch + room.gap - chair : 0;
      const y = second ? pitch + room.gap : chair;
      return {x,y,width,depth,chairTop,chair,number:index+1};
    });
    return {tables,width:Math.max(...tables.map(item=>item.x+width)),depth:Math.max(...tables.map(item=>Math.max(item.y+depth,item.chairTop+chair)))};
  }

  return {layouts,planSettings,arrange};
})();
