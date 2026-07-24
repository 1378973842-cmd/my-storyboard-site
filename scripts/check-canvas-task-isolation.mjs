import assert from 'node:assert/strict';
import {
  shouldParkTaskResult,
  canOrphanOntoCurrent,
} from '../src/lib/infiniteCanvas/canvasTaskIsolation.js';

assert.equal(shouldParkTaskResult('A', 'B'), true);
assert.equal(shouldParkTaskResult('A', 'A'), false);
assert.equal(shouldParkTaskResult('', 'B'), false);
assert.equal(shouldParkTaskResult('A', ''), false);

assert.equal(canOrphanOntoCurrent('A', 'A'), true);
assert.equal(canOrphanOntoCurrent('A', 'B'), false);
assert.equal(canOrphanOntoCurrent('', 'B'), true);
assert.equal(canOrphanOntoCurrent('A', ''), false);

console.log('check-canvas-task-isolation: ok');
