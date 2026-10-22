import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch'

export const METRICS_NAMESPACE = 'Fieldwork/StoreApi'

// Fixed dimensions keep customer IDs, URLs, tokens, and order IDs out of telemetry.
export function createApplicationMetrics({ instanceId, region, client, now = Date.now, logger = console }) {
  if (!/^i-[0-9a-f]{8,17}$/.test(instanceId || '')) throw new Error('STORE_METRICS_INSTANCE_ID must identify the monitored EC2 instance.')
  if (!region) throw new Error('AWS_REGION is required for application metrics.')
  const publisher = client || new CloudWatchClient({ region, maxAttempts: 2 })
  const dimensions = [{ Name: 'Service', Value: 'store-api' }, { Name: 'InstanceId', Value: instanceId }]
  const empty = () => ({ started: now(), count: 0, clientErrors: 0, serverErrors: 0, sum: 0, min: Infinity, max: 0 })
  let bucket = empty()
  let inFlight
  let timer
  let running = false

  function record({ statusCode, durationMs }) {
    if (!Number.isFinite(durationMs) || durationMs < 0 || !Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) return
    bucket.count++
    if (statusCode >= 400 && statusCode < 500) bucket.clientErrors++
    if (statusCode >= 500) bucket.serverErrors++
    bucket.sum += durationMs
    bucket.min = Math.min(bucket.min, durationMs)
    bucket.max = Math.max(bucket.max, durationMs)
  }

  function flush() {
    if (inFlight) return inFlight
    if (now() <= bucket.started) return Promise.resolve(false)
    const snapshot = bucket
    bucket = empty()
    const timestamp = new Date(Math.floor(snapshot.started / 60000) * 60000)
    const metric = (MetricName, Value, Unit = 'Count') => ({ MetricName, Value, Unit, Dimensions: dimensions, Timestamp: timestamp, StorageResolution: 60 })
    const data = [
      metric('RequestCount', snapshot.count),
      metric('ClientErrorCount', snapshot.clientErrors),
      metric('ServerErrorCount', snapshot.serverErrors),
      // A positive collection sample distinguishes idle traffic from missing data.
      metric('CollectionSeconds', (bucket.started - snapshot.started) / 1000, 'Seconds'),
    ]
    if (snapshot.count) data.push({
      MetricName: 'ResponseDuration', Dimensions: dimensions, Timestamp: timestamp,
      Unit: 'Milliseconds', StorageResolution: 60,
      StatisticValues: { SampleCount: snapshot.count, Sum: snapshot.sum, Minimum: snapshot.min, Maximum: snapshot.max },
    })
    // Publishing is outside the HTTP response path. On failure, drop this batch
    // and warn; missing intervals remain gaps instead of becoming false zeroes.
    inFlight = Promise.resolve().then(() => publisher.send(
      new PutMetricDataCommand({ Namespace: METRICS_NAMESPACE, MetricData: data }),
      { abortSignal: AbortSignal.timeout(4000) },
    )).then(() => true, () => {
      logger.warn('Store API metrics batch could not be published; this interval will be unavailable.')
      return false
    }).finally(() => { inFlight = undefined })
    return inFlight
  }

  function schedule() {
    if (!running) return
    timer = setTimeout(async () => { await flush(); schedule() }, 60000 - now() % 60000)
    timer.unref()
  }

  return {
    record, flush,
    start() { if (!running) { running = true; schedule() } },
    async stop() {
      running = false
      clearTimeout(timer)
      if (inFlight) await inFlight
      await flush()
      publisher.destroy?.()
    },
  }
}
