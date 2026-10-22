export interface StoreMetricsData {
  status: 'available' | 'partial' | 'stale' | 'no_data' | 'error';
  request_count: number | null;
  requests_per_minute: number | null;
  average_response_ms: number | null;
  server_errors: number | null;
  client_errors: number | null;
  server_error_percent: number | null;
  observed_seconds: number;
  last_sample: string | null;
  instance_id: string;
}

export interface LambdaWebMetricsData {
  status: 'available' | 'no_data' | 'error';
  request_count: number | null;
  requests_per_minute: number | null;
  client_errors: number | null;
  server_errors: number | null;
  environment_cpu_ms: number | null;
  peak_memory_mb: number | null;
  peak_concurrent_requests: number | null;
  active_environments: number | null;
  endpoint_request_throttles: number | null;
  environment_throttles: number | null;
  observed_seconds: number;
  last_sample: string | null;
  function_name: string;
  endpoint_name: string;
}

export function StoreMetrics({ data, fetchFailed }: { data: StoreMetricsData | null; fetchFailed: boolean }) {
  const available = !fetchFailed && (data?.status === 'available' || data?.status === 'partial');
  const format = (n: number | null | undefined, suffix = '') => available && typeof n === 'number' && Number.isFinite(n) ? `${n.toLocaleString()}${suffix}` : '—';
  const label = fetchFailed ? 'Unavailable: dashboard refresh failed' : !data || data.status === 'no_data' ? 'No application data received yet' : data.status === 'stale' ? 'Application data is stale' : data.status === 'error' ? 'Application metrics unavailable' : data.status === 'partial' ? 'Partial collection window' : 'Receiving application metrics';
  const cards = [
    ['API requests', format(data?.request_count), 'Completed API responses'],
    ['Requests per minute', format(data?.requests_per_minute), 'Rate over observed collection time'],
    ['Average response time', format(data?.average_response_ms, ' ms'), available && data?.request_count === 0 ? 'No API requests in this window' : 'Measured inside the Store API'],
    ['Server errors (5xx)', format(data?.server_errors), `Error rate: ${format(data?.server_error_percent, '%')}`],
    ['Client errors (4xx)', format(data?.client_errors), 'Includes denied and invalid requests'],
  ];
  return <section aria-label="Store API monitoring">
    <h2>EC2 Store API activity</h2>
    <p role="status" style={{ color: 'var(--text-secondary)', margin: '0.75rem 0 1rem' }}>
      {label}. Last 5 completed minutes; health checks and preflight requests excluded.
      {available && data && ` Observed ${Math.round(data.observed_seconds)} seconds.`}
      {data?.last_sample && ` Latest interval: ${new Date(data.last_sample).toLocaleTimeString()}.`}
      {data?.instance_id && ` EC2: ${data.instance_id}.`}
    </p>
    <div className="bento-grid">
      {cards.map(([title, value, detail]) => <div className="glass-panel status-card" key={title}>
        <div className="status-header">{title}</div>
        <p className="status-value">{value}</p>
        <p className="status-sub">{detail}</p>
      </div>)}
    </div>
  </section>;
}

export function LambdaWebMetrics({ data, fetchFailed }: { data: LambdaWebMetricsData | null; fetchFailed: boolean }) {
  const available = !fetchFailed && data?.status === 'available';
  const noData = !fetchFailed && data?.status === 'no_data';
  const formatCount = (n: number | null | undefined) => {
    if (available && typeof n === 'number' && Number.isFinite(n)) return n.toLocaleString();
    if (noData) return '0';
    return '—';
  };
  const formatMeasurement = (n: number | null | undefined, unit: string) =>
    available && typeof n === 'number' && Number.isFinite(n) ? `${n.toLocaleString()} ${unit}` : '—';
  const label = fetchFailed || data?.status === 'error'
    ? 'Lambda Web metrics unavailable'
    : noData
      ? 'No Lambda requests observed in the last 5 completed minutes'
      : 'Receiving native Lambda Web metrics';
  const cards = [
    ['API requests', formatCount(data?.request_count), 'Requests that reached a Lambda execution environment'],
    ['Requests per minute', formatCount(data?.requests_per_minute), 'Rate over the last 5 completed minutes'],
    ['Client errors (4xx)', formatCount(data?.client_errors), 'Includes Lambda throttling responses'],
    ['Server errors (5xx)', formatCount(data?.server_errors), 'Responses returned to callers'],
    ['Lambda CPU time', formatMeasurement(data?.environment_cpu_ms, 'ms'), 'Total execution-environment CPU time in this window'],
    ['Peak memory', formatMeasurement(data?.peak_memory_mb, 'MB'), 'Highest reported environment memory use'],
    ['Peak concurrent requests', formatCount(data?.peak_concurrent_requests), 'Highest simultaneous requests on one environment'],
    ['Active environments', formatCount(data?.active_environments), 'Peak active environments in this Region'],
    ['Endpoint throttles', formatCount(data?.endpoint_request_throttles), 'Requests throttled by the endpoint rate limit'],
    ['Environment throttles', formatCount(data?.environment_throttles), 'Requests throttled by the environment limit'],
  ];
  return <section aria-label="Lambda Web API monitoring">
    <h2>Lambda API activity</h2>
    <p role="status" style={{ color: 'var(--text-secondary)', margin: '0.75rem 0 1rem' }}>
      {label}. CloudWatch namespace AWS/Lambda/Web; endpoint {data?.endpoint_name || 'storefront'} on function {data?.function_name || 'fieldwork-store-api-web'}.
      {' '}Execution-environment CPU and memory are function-wide metrics; endpoint throttles and active environments use the selected Region.
      {data?.last_sample && ` Latest sample: ${new Date(data.last_sample).toLocaleTimeString()}.`}
    </p>
    <div className="bento-grid">
      {cards.map(([title, value, detail]) => <div className="glass-panel status-card" key={title}>
        <div className="status-header">{title}</div>
        <p className="status-value">{value}</p>
        <p className="status-sub">{detail}</p>
      </div>)}
    </div>
  </section>;
}
