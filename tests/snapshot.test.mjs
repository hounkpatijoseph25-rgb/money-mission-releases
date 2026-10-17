import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decision, parseCache, cacheKey, validData } from '../source/account/snapshot.mjs';
const data = { budgets: [], bills: [], goals: [], transactions: [] };
test('new devices pull the existing cloud budget without uploading an empty budget', () => {
  assert.equal(decision(null, { revision: 10, data }), 'pull');
  assert.equal(decision(null, null), 'new');
});
test('unpublished changes survive a newer cloud revision as a conflict', () => {
  assert.equal(decision({ revision: 1, dirty: true }, { revision: 2 }), 'conflict');
  assert.equal(decision({ revision: 1, dirty: true }, { revision: 1 }), 'push');
  assert.equal(decision({ revision: 0, dirty: true }, { revision: 1 }), 'conflict');
});
test('deleted remote rows cannot silently erase an existing local budget', () => {
  assert.equal(decision({ revision: 2, dirty: false }, null), 'conflict');
});
test('malformed caches are rejected and user IDs partition the cache', () => {
  assert.equal(parseCache('{oops'), null);
  assert.equal(parseCache(JSON.stringify({ data: {}, revision: 1 })), null);
  assert.equal(parseCache(JSON.stringify({ data, revision: -1 })), null);
  assert.ok(parseCache(JSON.stringify({ data, revision: 1 })));
  assert.notEqual(cacheKey('user-a'), cacheKey('user-b'));
  assert.equal(validData(null), null);
});
