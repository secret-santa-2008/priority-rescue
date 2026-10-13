import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, stepSimulation, runChallenge, runVerificationSuite, summarize, validateTaskSpec, resetSimulation } from './scheduler.js';

test('mutex acquisition, arrival order, and H blocking are deterministic', () => {
  const s = createSimulation();
  assert.equal(s.resource.owner, null);
  stepSimulation(s); assert.equal(s.resource.owner, 'L'); assert.equal(s.time, 1);
  stepSimulation(s); assert.equal(s.tasks.find(t => t.id === 'H').status, 'blocked'); assert.equal(s.tasks.find(t => t.id === 'H').arrival, 1);
});
test('baseline permits M interference while H waits; PIP schedules L first', () => {
  const base = runChallenge('C1', { pip: false });
  const pip = runChallenge('C1', { pip: true });
  assert.ok(base.history.findIndex(x => x.taskId === 'M') < base.history.findIndex(x => x.taskId === 'L' && x.start >= 6));
  assert.equal(base.tasks.find(t => t.id === 'H').blockedTime, 6);
  assert.equal(pip.tasks.find(t => t.id === 'H').blockedTime, 2);
  assert.equal(summarize(base).inversion, true);
});
test('inheritance preserves base priority and restores on unlock', () => {
  const s = createSimulation(); stepSimulation(s); stepSimulation(s);
  const l = s.tasks.find(t => t.id === 'L'); assert.equal(l.basePriority, 1); assert.equal(l.effectivePriority, 3);
  const done = runChallenge('C1'); assert.equal(done.tasks.find(t => t.id === 'L').effectivePriority, 1);
  assert.ok(done.events.some(e => e.type === 'unlock'));
});
test('released mutex hands off to H and H completes', () => {
  const s = runChallenge('C1'); assert.equal(s.tasks.find(t => t.id === 'H').status, 'complete'); assert.equal(s.resource.owner, null);
  assert.ok(s.events.some(e => e.type === 'unblock' && e.taskId === 'H'));
});
test('C2 has ordinary two-tick blocking without medium interference', () => {
  const s = runChallenge('C2'); assert.equal(s.tasks.some(t => t.id === 'M'), false); assert.equal(s.tasks.find(t => t.id === 'H').blockedTime, 2);
});
test('C3 completes 1,000 finite tasks sharing one mutex', () => {
  const s = runChallenge('C3'); assert.equal(s.tasks.length, 1000); assert.ok(s.tasks.every(t => t.status === 'complete'));
  assert.equal(s.metrics.taskCompletions, 1000); assert.equal(s.resource.owner, null);
});
test('C3 caps trace detail while preserving aggregate metrics', () => {
  const s = runChallenge('C3'); assert.equal(s.events.length, 200); assert.ok(s.eventCount > s.events.length);
  assert.equal(summarize(s).completedTasks, 1000); assert.ok(summarize(s).blockingTime > 0);
});
test('C4 safe stop retains mutex owner and blocked waiters on owner failure', () => {
  const s = runChallenge('C4'); assert.equal(s.time, 2); assert.equal(s.resource.owner, 'L');
  assert.equal(s.resource.status, 'owner-failed'); assert.equal(s.tasks.find(t => t.id === 'H').status, 'blocked');
  assert.equal(s.tasks.find(t => t.id === 'M').status, 'ready'); assert.ok(s.events.some(e => e.type === 'failure'));
});
test('C5 metrics are calculated from equal-workload executions', () => {
  const c = runChallenge('C5'); assert.equal(c.baseline.metrics.executionTicks, c.inherited.metrics.executionTicks);
  assert.equal(c.metrics.baseline.blockingTime, 6); assert.equal(c.metrics.pip.blockingTime, 2);
  assert.equal(c.metrics.extraExecutionTicks, 0); assert.equal(c.metrics.inheritanceUpdates, 1);
});
test('invalid task fields and duplicate ids are rejected', () => {
  assert.throws(() => validateTaskSpec({ id: 'X', basePriority: 4, duration: 1, arrival: 0 }), RangeError);
  assert.throws(() => validateTaskSpec({ id: '', basePriority: 1, duration: 1, arrival: 0 }), TypeError);
  assert.throws(() => validateTaskSpec({ id: 'X', basePriority: 1, duration: 0, arrival: 0 }), RangeError);
  assert.throws(() => createSimulation({ taskSpecs: [
    { id: 'X', basePriority: 1, duration: 1, arrival: 0 }, { id: 'X', basePriority: 2, duration: 2, arrival: 1 }
  ] }), RangeError);
});
test('reset builds a clean copy of the selected scenario', () => {
  let s = runChallenge('C1', { pip: false }); s = resetSimulation(s);
  assert.equal(s.time, 0); assert.equal(s.challenge, 'C1'); assert.equal(s.pip, false);
  assert.equal(s.events.length, 0); assert.equal(s.resource.owner, null); assert.equal(s.tasks[0].status, 'new');
});
test('dashboard verification suite returns measured checks', () => {
  const checks = runVerificationSuite(); assert.equal(checks.length, 13); assert.ok(checks.every(c => c.pass));
});
