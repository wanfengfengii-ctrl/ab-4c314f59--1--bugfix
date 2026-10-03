import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveLineage, validateInput, isNonNegInt } from '../src/lineage.js';

const S = (id, x, y, brightness = 0) => ({ id, x, y, brightness });
const P53 = '9007199254740992';   // 2^53（double 可精确表示）
const P53_1 = '9007199254740993'; // 2^53 + 1（double 不可表示，Number 解析会丢成 2^53）

/**
 * 任务回归场景（草稿恢复）：4 帧各 2 斑点；第 2 帧 low 与 high 同坐标，
 * 经 c、d 的候选路径几何条件完全相同；亮度文本 2^53 与 2^53+1，low 先录入。
 */
const bigFrames = () => [
  [S('a', 0, 0), S('z1', 9, 9)],
  [S('low', 1, 0, P53), S('high', 1, 0, P53_1)],
  [S('c', 2, 0), S('z3', 9, 9)],
  [S('d', 3, 0), S('z4', 9, 9)],
];
const OPTS = { startId: 'a', maxMove: 1, maxSkip: 0, survivors: 1 };

const adoptedIds = (r) => r.lineage.adopted.map((a) => a.spot.id);

test('超大非负整数亮度不被校验拒绝（契约允许，不设安全整数上限）', () => {
  assert.deepEqual(validateInput(bigFrames(), OPTS), []);
  assert.ok(isNonNegInt(P53_1));            // 十进制文本
  assert.ok(isNonNegInt(9007199254740993n)); // bigint
  assert.ok(isNonNegInt(0));
  assert.ok(isNonNegInt(9007199254740992)); // 可精确表示的 number 照常接受
  assert.ok(!isNonNegInt(-1));
  assert.ok(!isNonNegInt('-5'));
  assert.ok(!isNonNegInt('1.5'));
  assert.ok(!isNonNegInt(0.5));
  assert.ok(!isNonNegInt(''));
  assert.ok(!isNonNegInt(null));
});

test('回归：相差 1 的超大亮度按真实值裁决——采用更亮的 high 而非先录入的 low', () => {
  const r = solveLineage(bigFrames(), OPTS);
  assert.equal(r.ok, true);
  assert.deepEqual(adoptedIds(r), ['a', 'high', 'c', 'd']);
  assert.deepEqual(r.lineage.survivors, ['d']);
  // 总亮度精确报告为 9007199254740993，而不是被压缩成的 9007199254740992
  assert.equal(r.lineage.totalBrightness, P53_1);
  // 采用斑点回显保留原始十进制文本
  const high = r.lineage.adopted.find((a) => a.spot.id === 'high');
  assert.equal(high.spot.brightness, P53_1);
});

test('真正同亮度（文本相同）时按输入顺序稳定裁决：先录入的 low 胜出', () => {
  const frames = bigFrames();
  frames[1][1] = S('high', 1, 0, P53); // high 与 low 亮度真正相同
  const r1 = solveLineage(frames, OPTS);
  const r2 = solveLineage(frames, OPTS);
  assert.equal(r1.ok, true);
  assert.deepEqual(adoptedIds(r1), ['a', 'low', 'c', 'd']);
  assert.equal(r1.lineage.totalBrightness, P53); // 2^53 超出安全整数 → 精确文本
  assert.deepEqual(adoptedIds(r2), adoptedIds(r1));
});

test('普通非负整数亮度：既有结果不变，总亮度仍为 number', () => {
  const frames = bigFrames();
  frames[1][0] = S('low', 1, 0, 5);
  frames[1][1] = S('high', 1, 0, 7);
  const r = solveLineage(frames, OPTS);
  assert.equal(r.ok, true);
  assert.deepEqual(adoptedIds(r), ['a', 'high', 'c', 'd']);
  assert.strictEqual(r.lineage.totalBrightness, 7);
  // 同亮度时同样按录入顺序（low 在前）
  frames[1][1] = S('high', 1, 0, 5);
  const tie = solveLineage(frames, OPTS);
  assert.deepEqual(adoptedIds(tie), ['a', 'low', 'c', 'd']);
  assert.strictEqual(tie.lineage.totalBrightness, 5);
});

test('number 与字符串亮度混合录入：结论一致，汇总精确', () => {
  const frames = bigFrames();
  frames[1][0] = S('low', 1, 0, 9007199254740992); // 2^53 以 number 给出
  const r = solveLineage(frames, OPTS);
  assert.equal(r.ok, true);
  assert.deepEqual(adoptedIds(r), ['a', 'high', 'c', 'd']);
  assert.equal(r.lineage.totalBrightness, P53_1);
});

test('分裂谱系的超大亮度汇总精确：2^53 + (2^53+1) = 18014398509481985', () => {
  const frames = [
    [S('a', 0, 0), S('z1', 9, 9)],
    [S('b1', 1, 1, P53), S('b2', 1, -1, P53_1), S('z2', 9, 9)],
    [S('c1', 2, 1), S('c2', 2, -1), S('z3', 9, 9)],
    [S('d1', 3, 1), S('d2', 3, -1), S('z4', 9, 9)],
  ];
  const r = solveLineage(frames, { startId: 'a', maxMove: 3, maxSkip: 0, survivors: 2 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.lineage.survivors.sort(), ['d1', 'd2']);
  assert.equal(r.lineage.totalBrightness, '18014398509481985');
  // 汇总与采用斑点亮度逐一对应（精确相加）
  const sum = r.lineage.adopted.reduce((t, a) => t + BigInt(a.spot.brightness), 0n);
  assert.equal(r.lineage.totalBrightness, sum.toString());
});

test('总亮度报告边界：安全整数内为 number，超出为精确十进制文本', () => {
  const chain = (brightness) => [
    [S('a', 0, 0, brightness), S('z1', 9, 9)],
    [S('b', 1, 0), S('z2', 9, 9)],
    [S('c', 2, 0), S('z3', 9, 9)],
    [S('d', 3, 0), S('z4', 9, 9)],
  ];
  const safe = solveLineage(chain('9007199254740991'), OPTS); // Number.MAX_SAFE_INTEGER
  assert.strictEqual(safe.lineage.totalBrightness, 9007199254740991);
  const beyond = solveLineage(chain(P53), OPTS); // 2^53 已超出安全整数
  assert.equal(beyond.lineage.totalBrightness, P53);
  assert.equal(typeof beyond.lineage.totalBrightness, 'string');
});

test('漏检路径上的超大亮度同样精确裁决', () => {
  // 直连走廊亮度 2^53，漏检走廊亮度 2^53+1：更亮的漏检路径必须以真实差值胜出
  const frames = [
    [S('a', 0, 0), S('z1', 9, 9)],
    [S('b', 1, 0, P53), S('z2', 9, 9)],
    [S('c', 2, 0), S('cp', 2, 3, P53_1), S('z3', 9, 9)],
    [S('d', 3, 0), S('dp', 3, 3), S('z4', 9, 9)],
  ];
  const r = solveLineage(frames, { startId: 'a', maxMove: 3, maxSkip: 1, survivors: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.lineage.misses, 1);
  assert.deepEqual(adoptedIds(r), ['a', 'cp', 'dp']);
  assert.equal(r.lineage.totalBrightness, P53_1);
});
