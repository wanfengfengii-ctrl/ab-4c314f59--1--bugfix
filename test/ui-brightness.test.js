import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './helpers/dom.js';

// 先装 DOM 桩并种入含超大十进制亮度（文本形式）的草稿，再导入前端模块：
// 模拟研究员的草稿经 localStorage 恢复后发起复原的完整流程。
// 场景：第 2 帧 low 与 high 同坐标、经 c/d 的路径几何条件相同，
// 亮度文本 2^53 与 2^53+1，low 先录入——必须采用更亮的 high。
const dom = installDom();

const P53 = '9007199254740992';   // 2^53
const P53_1 = '9007199254740993'; // 2^53 + 1（Number 无法精确表示）

dom.localStorage.setItem('algae-lineage-draft-v1', JSON.stringify({
  frames: [
    [{ id: 'a', x: 0, y: 0, brightness: 0 }, { id: 'z1', x: 9, y: 9, brightness: 0 }],
    [{ id: 'low', x: 1, y: 0, brightness: P53 }, { id: 'high', x: 1, y: 0, brightness: P53_1 }],
    [{ id: 'c', x: 2, y: 0, brightness: 0 }, { id: 'z3', x: 9, y: 9, brightness: 0 }],
    [{ id: 'd', x: 3, y: 0, brightness: 0 }, { id: 'z4', x: 9, y: 9, brightness: 0 }],
  ],
  params: { startId: 'a', maxMove: 1, maxSkip: 0, survivors: 1 },
}));

await import('../public/app.js');

const byId = dom.byId;

function brightnessInputs() {
  return byId('frames-editor')._walk()
    .filter((e) => e.tagName === 'input' && e.dataset.field === 'brightness');
}
function adoptedRows() {
  return byId('adopted-tables')._walk().filter((e) => e.classList.contains('af-spot'));
}
function adoptedIds() {
  return adoptedRows().map((e) => e.children[0].textContent.replace(/^● /, ''));
}
function setBrightness(rowIdx, value) {
  const input = brightnessInputs()[rowIdx];
  input.value = value;
  byId('frames-editor').dispatch('input', { target: input });
}
// 亮度输入框按帧序展开：0=a, 1=z1, 2=low, 3=high, 4=c, 5=z3, 6=d, 7=z4
const LOW_ROW = 2;
const HIGH_ROW = 3;

test('草稿恢复：超大十进制亮度按原文显示，不被四舍五入', () => {
  const bs = brightnessInputs().map((e) => String(e.value));
  assert.equal(bs[LOW_ROW], P53);
  assert.equal(bs[HIGH_ROW], P53_1);
});

test('复原：采用更亮的 high（a、high、c、d），总亮度精确显示 9007199254740993', () => {
  byId('btn-solve').dispatch('click');

  assert.equal(byId('broke-view').hidden, true);
  assert.equal(byId('input-errors').hidden, true); // 超大亮度合法，不是校验错误
  assert.equal(byId('summary').hidden, false);
  const summary = byId('summary').innerHTML;
  assert.match(summary, /总亮度/);
  assert.ok(summary.includes(P53_1), `摘要应精确显示 ${P53_1}：${summary}`);
  assert.ok(!summary.includes(P53), `摘要不得显示被压缩的 ${P53}：${summary}`);

  const ids = adoptedIds();
  assert.deepEqual(ids, ['a', 'high', 'c', 'd']);
  // 采用表中 high 的亮度按精确文本回显
  const highRow = adoptedRows().find((e) => e.children[0].textContent.includes('high'));
  assert.ok(highRow.children[1].textContent.includes(P53_1));
});

test('草稿落盘不丢精度：亮度文本原样保留', async () => {
  await new Promise((r) => setTimeout(r, 250)); // 等过草稿防抖落盘
  const raw = dom.localStorage.getItem('algae-lineage-draft-v1');
  assert.ok(raw.includes(P53_1));
  assert.ok(raw.includes(P53));
});

test('把 high 改成与 low 真正同亮度：按录入顺序稳定裁决，采用 low', () => {
  setBrightness(HIGH_ROW, P53); // high 与 low 亮度真正相同
  byId('btn-solve').dispatch('click');

  assert.equal(byId('summary').hidden, false);
  assert.deepEqual(adoptedIds(), ['a', 'low', 'c', 'd']);
  assert.ok(byId('summary').innerHTML.includes(P53));
});

test('普通非负整数亮度：既有结果不变（更亮者胜出、总亮度照常显示）', () => {
  setBrightness(LOW_ROW, '5');
  setBrightness(HIGH_ROW, '7');
  byId('btn-solve').dispatch('click');

  assert.equal(byId('summary').hidden, false);
  assert.deepEqual(adoptedIds(), ['a', 'high', 'c', 'd']);
  const summary = byId('summary').innerHTML;
  assert.match(summary, /总亮度/);
  assert.ok(summary.includes('7'));
});

test('非法亮度（负数、小数、空）显示校验错误，不出谱系', () => {
  setBrightness(HIGH_ROW, '-3');
  byId('btn-solve').dispatch('click');
  assert.equal(byId('input-errors').hidden, false);
  assert.match(byId('input-errors').textContent, /非负整数/);

  setBrightness(HIGH_ROW, '1.5');
  byId('btn-solve').dispatch('click');
  assert.match(byId('input-errors').textContent, /非负整数/);

  setBrightness(HIGH_ROW, '');
  byId('btn-solve').dispatch('click');
  assert.match(byId('input-errors').textContent, /非负整数/);
});
