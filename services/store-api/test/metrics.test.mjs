import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApplicationMetrics } from '../src/metrics.mjs'
import { createStoreApi } from '../src/app.mjs'
import { MemoryStore } from '../src/memory-store.mjs'

function fixture(send = async () => ({})) {
  let clock = 120000
  const sent = []; const warnings = []
  const metrics = createApplicationMetrics({
    instanceId: 'i-12345678', region: 'us-east-1', now: () => clock,
    logger: { warn: m => warnings.push(m) },
    client: { send: async c => { sent.push(c.input); return send(c) } },
  })
  return { metrics, sent, warnings, advance: n => { clock += n } }
}

test('records accurate counts and weighted latency statistics without request identifiers', async () => {
  const f = fixture()
  for (const [statusCode, durationMs] of [[200, 10], [403, 20], [500, 90]]) f.metrics.record({ statusCode, durationMs })
  f.advance(60000)
  await f.metrics.flush()
  const data = Object.fromEntries(f.sent[0].MetricData.map(m => [m.MetricName, m]))
  assert.equal(f.sent[0].Namespace, 'Fieldwork/StoreApi')
  assert.equal(data.RequestCount.Value, 3)
  assert.equal(data.ClientErrorCount.Value, 1)
  assert.equal(data.ServerErrorCount.Value, 1)
  assert.equal(data.CollectionSeconds.Value, 60)
  assert.deepEqual(data.ResponseDuration.StatisticValues, { SampleCount: 3, Sum: 120, Minimum: 10, Maximum: 90 })
  assert.deepEqual(data.RequestCount.Dimensions, [{ Name: 'Service', Value: 'store-api' }, { Name: 'InstanceId', Value: 'i-12345678' }])
  f.advance(60000)
  await f.metrics.flush()
  assert.equal(f.sent[1].MetricData.find(m => m.MetricName === 'RequestCount').Value, 0)
  assert.equal(f.sent[1].MetricData.some(m => m.MetricName === 'ResponseDuration'), false, 'idle latency must not be fabricated')
})

test('failed publishing warns without throwing or replaying counts; later observations survive in-flight sends', async () => {
  let release
  let fail = true
  const f = fixture(() => fail ? new Promise((resolve, reject) => { release = reject }) : Promise.resolve())
  f.metrics.record({ statusCode: 500, durationMs: 5 }); f.advance(60000)
  const pending = f.metrics.flush()
  await Promise.resolve()
  assert.equal(f.metrics.flush(), pending, 'concurrent flush must not duplicate a batch')
  f.metrics.record({ statusCode: 200, durationMs: 10 })
  release(new Error('publisher unavailable'))
  assert.equal(await pending, false)
  assert.equal(f.warnings.length, 1)
  assert.equal(f.sent.length, 1)
  fail = false; f.advance(60000)
  await f.metrics.flush()
  assert.equal(f.sent[1].MetricData.find(m => m.MetricName === 'RequestCount').Value, 1)
  assert.equal(f.sent[1].MetricData.find(m => m.MetricName === 'ServerErrorCount').Value, 0)
})

test('HTTP instrumentation excludes health and preflight; includes rejected and failed API requests', async () => {
  const events = []
  const repository = new MemoryStore()
  const server = createStoreApi({ repository, observeRequest: e => events.push(e), logger: { error() {} } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    await fetch(origin + '/health')
    await fetch(origin + '/api/products', { method: 'OPTIONS' })
    await fetch(origin + '/api/products?customer=private-value')
    assert.equal((await fetch(origin + '/api/missing')).status, 404)
    repository.listProducts = async () => { throw new Error('dependency unavailable') }
    assert.equal((await fetch(origin + '/api/products')).status, 500)
    assert.deepEqual(events.map(e => e.statusCode), [200, 404, 500])
    assert(events.every(e => Number.isFinite(e.durationMs) && e.durationMs >= 0))
    assert(events.every(e => Object.keys(e).join(',') === 'statusCode,durationMs'))
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('observer failures never turn successful catalog responses into failures', async () => {
  const server = createStoreApi({ repository: new MemoryStore(), observeRequest() { throw new Error('observer failed') }, logger: { warn() {} } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try { assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/products`)).status, 200) }
  finally { await new Promise(resolve => server.close(resolve)) }
})
