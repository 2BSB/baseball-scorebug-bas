/* 生成可直接粘贴到 B 站高级弹幕编辑器的 BAS 脚本（默认贴右下角） */
const fs = require('fs');
const path = require('path');
const G = require('./scorebug-generator.js');

const demoEvents = [
  { t: 12, field: 'strikes', value: '0' },
  { t: 12, field: 'balls',   value: '0' },
  { t: 18, field: 'outs',    value: '1' },
  { t: 26, field: 'homeScore', value: '5' },
  { t: 34, field: 'inning',  value: '6' },
  { t: 34, field: 'half',    value: '上' },
  { t: 42, field: 'b1',      value: '0' },
  { t: 42, field: 'b2',      value: '0' },
  { t: 42, field: 'b3',      value: '1' }
];

function emit(name, code) {
  const out = path.join(__dirname, name);
  fs.writeFileSync(out, code, 'utf8');
  const defs = (code.match(/^def /gm) || []).length;
  const chains = (code.match(/^set /gm) || []).length;
  console.log('written:', name, code.length, 'chars,', defs, 'defs,', chains, 'animation chains');
}

const pos = G.effectivePosition(G.DEFAULT_OPTIONS);
console.log('placement: X=' + pos.x.toFixed(3) + '% Y=' + pos.y.toFixed(3) + '% height=' + pos.h.toFixed(3) + '%');

emit('棒球实时计分.bas', G.generateBAS(G.DEFAULT_STATE, G.DEFAULT_OPTIONS, []));
emit('棒球实时计分-时间轴示例.bas', G.generateBAS(G.DEFAULT_STATE, G.DEFAULT_OPTIONS, demoEvents));
