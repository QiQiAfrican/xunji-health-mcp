import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { getMovementCatalog, getTraining, queryOfficialPlan, XunjiError } from '../src/xunji.js';

let originalFetch;
let originalKey;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalKey = process.env.XUNJI_API_KEY;
  process.env.XUNJI_API_KEY = 'test-key-not-a-secret';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.XUNJI_API_KEY;
  else process.env.XUNJI_API_KEY = originalKey;
});

test('training accepts documented HTTP 200 response containing res without success', async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({ res: { trains: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const result = await getTraining({ date: '2026-10-07', include_full_data: true });
  assert.deepEqual(result.res, { trains: [] });
  assert.equal(request.url, 'https://trains.xunjiapp.cn/api_trains_for_llm_v2');
  assert.equal(request.options.headers.authorization, 'Bearer test-key-not-a-secret');
  assert.deepEqual(JSON.parse(request.options.body), {
    schema_version: 'train_open_api_v2',
    datestr: '2026-10-07',
    include_full_data: true
  });
});

test('movement catalog preserves every upstream field and adds stable unique ids', async () => {
  let request;
  const upstreamMovements = [
    { name: '示例动作', type: '上肢', exetype: '力量', aliases: ['示例'], future_field: { raw: true } },
    { name: '示例动作', type: '下肢', exetype: '力量', aliases: [] }
  ];
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({
      res: { schema: 'movement_catalog_v1', version: 1, movements: upstreamMovements }
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const first = await getMovementCatalog();
  const second = await getMovementCatalog();
  assert.equal(request.url, 'https://trains.xunjiapp.cn/api_movement_catalog_for_llm_v2');
  assert.deepEqual(JSON.parse(request.options.body), {});
  assert.equal(first.schema, 'movement_catalog_v1');
  assert.equal(first.version, 1);
  assert.deepEqual(first.movements[0].future_field, { raw: true });
  assert.match(first.movements[0].catalog_id, /^xjmv_[a-f0-9]{24}$/);
  assert.notEqual(first.movements[0].catalog_id, first.movements[1].catalog_id);
  assert.equal(first.movements[0].catalog_id, second.movements[0].catalog_id);
});

test('official plan list uses the documented gzip endpoint and body', async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({ res: { plans: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' }
    });
  };

  const result = await queryOfficialPlan({ action: 'list' });
  assert.deepEqual(result.res, { plans: [] });
  assert.equal(request.url, 'https://api.xunjiapp.cn/open/plan/query_gzip');
  assert.equal(request.options.headers['accept-encoding'], 'gzip');
  assert.deepEqual(JSON.parse(request.options.body), {
    schema_version: 'plan_open_api_v1',
    action: 'list'
  });
});

test('official plan get validates and sends an optional 92-day range', async () => {
  let body;
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({ res: { days: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  await queryOfficialPlan({
    action: 'get',
    plan_ref: 'platform:155',
    start_date: '2026-07-12',
    end_date: '2026-08-12',
    include_movements: false
  });
  assert.deepEqual(body, {
    schema_version: 'plan_open_api_v1',
    action: 'get',
    plan_ref: 'platform:155',
    start_date: '2026-07-12',
    end_date: '2026-08-12',
    include_movements: false
  });
});

test('official plan get requires plan_ref', async () => {
  await assert.rejects(
    queryOfficialPlan({ action: 'get' }),
    (error) => error instanceof XunjiError && error.code === 'PLAN_REF_REQUIRED'
  );
});
