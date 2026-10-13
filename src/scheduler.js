// Deterministic, single-core preemptive priority scheduler (larger value wins).
// Equal priorities use FIFO arrival order, then task declaration order.
export const CHALLENGES = {
  C1: { title: 'Priority inversion', description: 'L arrives at 0 and holds R for 3 ticks. H arrives at 1; M arrives at 2.' },
  C2: { title: 'Ordinary lock blocking', description: 'Remove M to isolate the 2 ticks H waits for L to release R.' },
  C3: { title: 'Scale test · 1,000 tasks', description: '1,000 finite synthetic tasks share R. The detailed event trace is capped at 200.' },
  C4: { title: 'Task failure', description: 'L fails at logical time 2 while holding R. Safe stop preserves owner and waiters.' },
  C5: { title: 'PIP overhead', description: 'Compare the same arrival schedule with and without inheritance.' }
};

export function validateTaskSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new TypeError('Task specification must be an object.');
  if (typeof spec.id !== 'string' || !spec.id.trim()) throw new TypeError('Task id must be a non-empty string.');
  if (!Number.isInteger(spec.basePriority) || spec.basePriority < 1 || spec.basePriority > 3) throw new RangeError('Base priority must be an integer from 1 to 3.');
  if (!Number.isInteger(spec.duration) || spec.duration < 1) throw new RangeError('Duration must be a positive integer.');
  if (!Number.isInteger(spec.arrival) || spec.arrival < 0) throw new RangeError('Arrival must be a non-negative integer.');
  if (spec.requiresMutex !== undefined && typeof spec.requiresMutex !== 'boolean') throw new TypeError('requiresMutex must be a boolean.');
  return true;
}

const makeTask = ({ id, label = id, basePriority, duration, arrival = 0, requiresMutex = false }) => ({
  id, label, basePriority, effectivePriority: basePriority, total: duration, remaining: duration,
  arrival, requiresMutex, waitingFor: null, acquiredAt: null, status: 'new', waitingTime: 0, blockedTime: 0,
  declarationOrder: 0
});

function record(sim, type, message, extra = {}) {
  sim.eventCount++;
  if (sim.events.length < sim.traceLimit) sim.events.push({ time: sim.time, type, message, ...extra });
}

function specsFor(challenge) {
  if (challenge === 'C3') {
    return Array.from({ length: 1000 }, (_, i) => ({
      id: `T${i + 1}`, label: `Synthetic task ${i + 1}`, basePriority: 1 + ((i * 17 + 3) % 3),
      duration: 1 + ((i * 13 + 2) % 3), arrival: 0, requiresMutex: true
    }));
  }
  const specs = [{ id: 'L', label: 'Non-urgent assessment · L', basePriority: 1, duration: 3, arrival: 0, requiresMutex: true }];
  if (challenge !== 'C2') specs.push({ id: 'M', label: 'Routine assessment · M', basePriority: 2, duration: 4, arrival: 2 });
  specs.push({ id: 'H', label: 'Emergency assessment · H', basePriority: 3, duration: 1, arrival: 1, requiresMutex: true });
  return specs;
}

export function createSimulation({ challenge = 'C1', pip = true, traceLimit = 500, taskSpecs } = {}) {
  if (!Object.hasOwn(CHALLENGES, challenge)) throw new RangeError(`Unknown challenge mode: ${challenge}`);
  if (!Number.isInteger(traceLimit) || traceLimit < 1) throw new RangeError('traceLimit must be a positive integer.');
  const specs = taskSpecs ?? specsFor(challenge);
  if (!Array.isArray(specs) || specs.length === 0) throw new TypeError('At least one task is required.');
  specs.forEach(validateTaskSpec);
  if (new Set(specs.map(s => s.id)).size !== specs.length) throw new RangeError('Task ids must be unique.');
  const tasks = specs.map((spec, i) => ({ ...makeTask(spec), declarationOrder: i }));
  const taskById = Object.fromEntries(tasks.map(t => [t.id, t]));
  const scale = challenge === 'C3';
  return {
    challenge, pip: Boolean(pip), tasks, taskById, time: 0, running: null, lastDispatched: null,
    resource: { id: 'R', owner: null, status: 'unlocked', waitQueue: [] }, events: [], eventCount: 0,
    traceLimit: scale ? Math.min(200, traceLimit) : traceLimit, done: false, failed: false,
    history: [], historyLimit: scale ? 200 : 1000,
    metrics: { inheritanceUpdates: 0, contextSwitches: 0, executionTicks: 0, taskCompletions: 0 },
    failurePolicy: challenge === 'C4' ? 'safe-stop; retain failed owner and mutex' : null
  };
}

function refreshInheritance(sim) {
  const owner = sim.taskById[sim.resource.owner];
  if (!owner) return;
  const waiters = sim.resource.waitQueue.map(id => sim.taskById[id]).filter(Boolean);
  const effective = Math.max(owner.basePriority, ...waiters.map(t => t.basePriority));
  if (owner.effectivePriority !== effective) {
    const from = owner.effectivePriority;
    owner.effectivePriority = effective;
    sim.metrics.inheritanceUpdates++;
    record(sim, 'inherit', `${owner.id} inherited priority ${effective} from a blocked waiter.`, { taskId: owner.id, from, to: effective });
  }
}

function requestMutex(sim, task) {
  if (!task.requiresMutex) return;
  if (sim.resource.owner === null) {
    sim.resource.owner = task.id; sim.resource.status = 'locked'; task.acquiredAt = sim.time;
    record(sim, 'lock', `${task.id} acquired mutex R.`, { taskId: task.id });
  } else {
    task.status = 'blocked'; task.waitingFor = 'R';
    sim.resource.waitQueue.push(task.id);
    record(sim, 'block', `${task.id} requested R and blocked behind ${sim.resource.owner}.`, { taskId: task.id, owner: sim.resource.owner });
    if (sim.pip) refreshInheritance(sim);
  }
}

function processArrivals(sim) {
  for (const task of sim.tasks) {
    if (task.status !== 'new' || task.arrival > sim.time) continue;
    task.status = 'ready';
    record(sim, 'arrival', `${task.id} arrived (priority ${task.basePriority}).`, { taskId: task.id });
    requestMutex(sim, task);
  }
}

function handoffMutex(sim, oldOwner) {
  if (sim.resource.owner !== oldOwner.id) throw new Error(`${oldOwner.id} cannot unlock R because it is not the owner.`);
  sim.resource.owner = null; sim.resource.status = 'unlocked';
  oldOwner.effectivePriority = oldOwner.basePriority;
  record(sim, 'unlock', `${oldOwner.id} released R; effective priority restored to ${oldOwner.basePriority}.`, { taskId: oldOwner.id });
  const next = sim.resource.waitQueue
    .map(id => sim.taskById[id]).filter(Boolean)
    .sort((a, b) => b.effectivePriority - a.effectivePriority || a.arrival - b.arrival || a.declarationOrder - b.declarationOrder)[0];
  if (next) {
    sim.resource.waitQueue = sim.resource.waitQueue.filter(id => id !== next.id);
    next.status = 'ready'; next.waitingFor = null; next.acquiredAt = sim.time;
    sim.resource.owner = next.id; sim.resource.status = 'locked';
    record(sim, 'unblock', `${next.id} acquired R and became ready.`, { taskId: next.id, previousOwner: oldOwner.id });
    if (sim.pip) refreshInheritance(sim);
  }
}

function stopOnOwnerFailure(sim) {
  const owner = sim.taskById[sim.resource.owner];
  if (sim.challenge !== 'C4' || sim.failed || sim.time < 2 || owner?.id !== 'L') return false;
  owner.status = 'failed'; sim.failed = true; sim.done = true; sim.running = null;
  sim.resource.status = 'owner-failed';
  record(sim, 'failure', 'L failed at logical time 2 while holding R. The mutex remains owned by failed task L.');
  record(sim, 'halt', 'Safe stop: affected execution halted; waiters and ownership are retained for diagnosis.');
  return true;
}

export function stepSimulation(sim) {
  if (sim.done) return sim;
  processArrivals(sim);
  if (stopOnOwnerFailure(sim)) return sim;
  const candidates = sim.tasks.filter(t => t.status === 'ready' || t.status === 'running')
    .sort((a, b) => b.effectivePriority - a.effectivePriority || a.arrival - b.arrival || a.declarationOrder - b.declarationOrder);
  const next = candidates[0];
  if (!next) {
    if (sim.tasks.every(t => ['complete', 'failed'].includes(t.status))) sim.done = true;
    return sim;
  }
  if (sim.running && sim.running !== next.id) {
    const previous = sim.taskById[sim.running];
    if (previous?.status === 'running') previous.status = 'ready';
  }
  if (sim.lastDispatched !== null && sim.lastDispatched !== next.id) sim.metrics.contextSwitches++;
  if (sim.lastDispatched !== next.id) record(sim, 'schedule', `${next.id} dispatched to CPU (effective priority ${next.effectivePriority}).`, { taskId: next.id });
  sim.running = next.id; sim.lastDispatched = next.id; next.status = 'running';
  if (sim.history.length < sim.historyLimit) sim.history.push({ start: sim.time, end: sim.time + 1, taskId: next.id });
  for (const t of sim.tasks) {
    if (t.id !== next.id && t.status === 'ready') t.waitingTime++;
    if (t.status === 'blocked') t.blockedTime++;
  }
  next.remaining--; sim.time++; sim.metrics.executionTicks++;
  if (next.remaining === 0) {
    next.status = 'complete'; sim.metrics.taskCompletions++;
    record(sim, 'complete', `${next.id} completed.`, { taskId: next.id });
    if (sim.resource.owner === next.id) handoffMutex(sim, next);
    sim.running = null;
  }
  if (sim.tasks.every(t => t.status === 'complete')) sim.done = true;
  return sim;
}

export function runSimulation(sim) { while (!sim.done) stepSimulation(sim); return sim; }
export function resetSimulation(sim, options = {}) { return createSimulation({ challenge: options.challenge ?? sim.challenge, pip: options.pip ?? sim.pip, traceLimit: options.traceLimit ?? sim.traceLimit }); }

export function runChallenge(id, { pip = true } = {}) {
  if (id === 'C5') {
    const baseline = runSimulation(createSimulation({ challenge: 'C1', pip: false }));
    const inherited = runSimulation(createSimulation({ challenge: 'C1', pip: true }));
    return { baseline, inherited, metrics: { baseline: summarize(baseline), pip: summarize(inherited), extraExecutionTicks: inherited.metrics.executionTicks - baseline.metrics.executionTicks, extraContextSwitches: inherited.metrics.contextSwitches - baseline.metrics.contextSwitches, inheritanceUpdates: inherited.metrics.inheritanceUpdates } };
  }
  return runSimulation(createSimulation({ challenge: id, pip, traceLimit: id === 'C3' ? 200 : 500 }));
}

export function summarize(sim) {
  const h = sim.taskById.H;
  const l = sim.taskById.L;
  const mediumRanWhileBlocked = sim.tasks.some(t => t.id === 'M') && sim.history.some(x => x.taskId === 'M') && Boolean(h?.blockedTime);
  return {
    waitingTime: sim.tasks.reduce((n, t) => n + t.waitingTime, 0),
    hWaitingTime: h?.waitingTime ?? 0,
    blockingTime: h?.blockedTime ?? (sim.challenge === 'C3' ? sim.tasks.reduce((n, t) => n + t.blockedTime, 0) : 0),
    inversion: Boolean(!sim.pip && mediumRanWhileBlocked), inheritedPriority: l?.effectivePriority ?? null,
    eventsRecorded: sim.events.length, totalEvents: sim.eventCount, truncated: sim.eventCount > sim.events.length,
    contextSwitches: sim.metrics.contextSwitches, executionTicks: sim.metrics.executionTicks,
    completedTasks: sim.metrics.taskCompletions
  };
}

// Shared by the UI test centre and automated tests so displayed statuses are measured.
export function runVerificationSuite() {
  const checks = [];
  const check = (name, fn) => { try { checks.push({ name, pass: fn() === true }); } catch (error) { checks.push({ name, pass: false, error: error.message }); } };
  check('Mutex acquisition assigns one owner', () => { const s = createSimulation(); stepSimulation(s); return s.resource.owner === 'L'; });
  check('H arrives at tick 1 and blocks on R', () => { const s = createSimulation(); stepSimulation(s); stepSimulation(s); return s.time === 2 && s.tasks.find(t => t.id === 'H').status === 'blocked'; });
  check('M arrives at tick 2 and delays baseline L', () => { const s = runChallenge('C1', { pip: false }); return s.history.some(x => x.taskId === 'M' && x.start < 6) && s.tasks.find(t => t.id === 'H').blockedTime > 2; });
  check('PIP changes effective priority, not base priority', () => { const s = createSimulation(); stepSimulation(s); stepSimulation(s); const l = s.tasks.find(t => t.id === 'L'); return l.basePriority === 1 && l.effectivePriority === 3; });
  check('PIP restores L priority after mutex release', () => { const s = runChallenge('C1'); const l = s.tasks.find(t => t.id === 'L'); return l.effectivePriority === 1 && s.events.some(e => e.type === 'unlock'); });
  check('Mutex handoff gives R to H and H completes', () => { const s = runChallenge('C1'); return s.tasks.find(t => t.id === 'H').status === 'complete' && s.resource.owner === null; });
  check('C2 blocks H without any medium task', () => { const s = runChallenge('C2'); return !s.tasks.some(t => t.id === 'M') && s.tasks.find(t => t.id === 'H').blockedTime === 2; });
  check('C3 completes 1,000 tasks using shared R', () => { const s = runChallenge('C3'); return s.tasks.length === 1000 && s.tasks.every(t => t.status === 'complete') && s.metrics.taskCompletions === 1000; });
  check('C3 caps detail at 200 and retains aggregates', () => { const s = runChallenge('C3'); return s.events.length <= 200 && s.eventCount > s.events.length && summarize(s).completedTasks === 1000 && summarize(s).blockingTime > 0; });
  check('C4 safe stop retains failed owner and blocked waiter', () => { const s = runChallenge('C4'); return s.done && s.resource.owner === 'L' && s.resource.status === 'owner-failed' && s.tasks.find(t => t.id === 'H').status === 'blocked'; });
  check('C5 metrics derive from equivalent measured workloads', () => { const c = runChallenge('C5'); return c.metrics.baseline.blockingTime > c.metrics.pip.blockingTime && c.metrics.extraExecutionTicks === 0 && c.metrics.inheritanceUpdates === 1; });
  check('Invalid task priority is rejected', () => { try { createSimulation({ taskSpecs: [{ id: 'bad', basePriority: 4, duration: 1 }] }); return false; } catch (e) { return e instanceof RangeError; } });
  check('Reset returns same challenge and PIP setting to time zero', () => { let s = runChallenge('C1', { pip: false }); s = resetSimulation(s); return s.challenge === 'C1' && !s.pip && s.time === 0 && s.events.length === 0 && s.resource.owner === null; });
  return checks;
}
