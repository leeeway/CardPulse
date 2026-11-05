import { it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createIdleLockTimer,
  idleLockRemaining,
  IDLE_LOCK_MINUTES,
} from '../src/core/idle-lock.js';

const MINUTE = 60_000;
function fakeClock() {
  let wall = 1_000_000;
  let elapsed = 0;
  let sequence = 0;
  const pending = new Map();
  const advanceClock = (next) => {
    wall += next - elapsed;
    elapsed = next;
  };
  return {
    now: () => wall,
    setTimer(callback, delay) {
      const id = ++sequence;
      pending.set(id, { at: elapsed + delay, callback });
      return id;
    },
    clearTimer: (id) => pending.delete(id),
    get pendingCount() {
      return pending.size;
    },
    setWall(value) {
      wall = value;
    },
    sleep(ms) {
      advanceClock(elapsed + ms);
    },
    advance(ms) {
      const target = elapsed + ms;
      while (pending.size) {
        const [id, next] = [...pending].sort((a, b) => a[1].at - b[1].at)[0];
        if (next.at > target) break;
        pending.delete(id);
        advanceClock(next.at);
        next.callback();
      }
      advanceClock(target);
    },
  };
}

it('空闲锁定仅支持关闭或5/15/30分钟，截止当天毫秒和时钟回拨边界明确', () => {
  assert.deepEqual(IDLE_LOCK_MINUTES, [0, 5, 15, 30]);
  for (const value of [0, -1, 1, '5', undefined])
    assert.equal(idleLockRemaining(value, 0, 10), null);
  assert.equal(idleLockRemaining(5, 1_000, 300_999), 1);
  assert.equal(idleLockRemaining(5, 1_000, 301_000), 0);
  assert.equal(idleLockRemaining(5, 1_000, 900), 5 * MINUTE);
});

it('窗口活动延后截止，超时只锁定一次且不会为每次鼠标活动创建定时器', () => {
  const clock = fakeClock();
  let locks = 0;
  const timer = createIdleLockTimer({
    minutes: 5,
    onLock: () => locks++,
    ...clock,
  });
  clock.advance(2 * MINUTE);
  for (let index = 0; index < 100; index++)
    assert.equal(timer.activity(), false);
  assert.equal(clock.pendingCount, 1);
  clock.advance(3 * MINUTE);
  assert.equal(locks, 0);
  clock.advance(2 * MINUTE);
  assert.equal(locks, 1);
  assert.equal(timer.check(), true);
  assert.equal(timer.activity(), true);
  assert.equal(clock.pendingCount, 0);
  assert.equal(locks, 1);
});

it('休眠后聚焦或第一次输入先检查截止，不让活动绕过已经到期的锁定', () => {
  for (const method of ['check', 'activity']) {
    const clock = fakeClock();
    let locks = 0;
    const timer = createIdleLockTimer({
      minutes: 5,
      onLock: () => locks++,
      ...clock,
    });
    clock.sleep(10 * MINUTE);
    assert.equal(timer[method](), true);
    assert.equal(locks, 1);
    assert.equal(clock.pendingCount, 0);
  }
});

it('聚焦和可见性检查不被误认为输入活动，不延后原截止时间', () => {
  const clock = fakeClock();
  let locks = 0;
  const timer = createIdleLockTimer({
    minutes: 5,
    onLock: () => locks++,
    ...clock,
  });
  clock.advance(4 * MINUTE);
  assert.equal(timer.check(), false);
  clock.advance(MINUTE);
  assert.equal(locks, 1);
});

it('临时拒绝锁定后重新完整计时，停用时清理定时器且不再回调', () => {
  const clock = fakeClock();
  let attempts = 0;
  const timer = createIdleLockTimer({
    minutes: 5,
    onLock: () => ++attempts > 1,
    ...clock,
  });
  clock.advance(5 * MINUTE);
  assert.equal(attempts, 1);
  clock.advance(5 * MINUTE - 1);
  assert.equal(attempts, 1);
  clock.advance(1);
  assert.equal(attempts, 2);
  timer.stop();
  assert.equal(timer.activity(), false);
  assert.equal(clock.pendingCount, 0);
  const another = createIdleLockTimer({
    minutes: 5,
    onLock: () => attempts++,
    ...clock,
  });
  another.stop();
  clock.advance(10 * MINUTE);
  assert.equal(attempts, 2);
});

it('系统时间回拨后从当前时间重新计时，关闭状态完全不启动计时', () => {
  const clock = fakeClock();
  let locks = 0;
  const timer = createIdleLockTimer({
    minutes: 5,
    onLock: () => locks++,
    ...clock,
  });
  clock.advance(2 * MINUTE);
  clock.setWall(100);
  assert.equal(timer.check(), false);
  clock.advance(5 * MINUTE - 1);
  assert.equal(locks, 0);
  clock.advance(1);
  assert.equal(locks, 1);
  timer.stop();
  const disabled = createIdleLockTimer({
    minutes: 0,
    onLock: () => locks++,
    ...clock,
  });
  assert.equal(clock.pendingCount, 0);
  clock.advance(60 * MINUTE);
  assert.equal(disabled.check(), false);
  assert.equal(locks, 1);
});
