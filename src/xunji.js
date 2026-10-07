const DEFAULT_BASE_URL = 'https://trains.xunjiapp.cn';
const DEFAULT_PLAN_BASE_URL = 'https://api.xunjiapp.cn';
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 60_000;

export class XunjiError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'XunjiError';
    this.code = code;
    this.status = status;
  }
}

function getConfig(baseEnvName = 'XUNJI_API_BASE', defaultBaseUrl = DEFAULT_BASE_URL) {
  const apiKey = process.env.XUNJI_API_KEY?.trim();
  if (!apiKey) {
    throw new XunjiError(
      'XUNJI_NOT_CONFIGURED',
      'XUNJI_API_KEY is not configured on the server.',
      503
    );
  }

  const configuredBase = process.env[baseEnvName]?.trim() || defaultBaseUrl;
  let baseUrl;
  try {
    baseUrl = new URL(configuredBase);
  } catch {
    throw new XunjiError('XUNJI_BAD_CONFIG', `${baseEnvName} is invalid.`, 500);
  }
  if (baseUrl.protocol !== 'https:') {
    throw new XunjiError('XUNJI_BAD_CONFIG', `${baseEnvName} must use HTTPS.`, 500);
  }

  const parsedTimeout = Number.parseInt(process.env.XUNJI_REQUEST_TIMEOUT_MS || '', 10);
  const timeoutMs = Number.isFinite(parsedTimeout)
    ? Math.min(Math.max(parsedTimeout, 1_000), MAX_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS;

  return { apiKey, baseUrl, timeoutMs };
}

export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function enumerateDates(startDate, endDate, limit = 31) {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    throw new XunjiError('INVALID_DATE', 'Dates must use YYYY-MM-DD.', 400);
  }

  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (start > end) {
    throw new XunjiError('INVALID_RANGE', 'start_date must not be after end_date.', 400);
  }

  const dates = [];
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.valueOf() + 86_400_000)) {
    dates.push(cursor.toISOString().slice(0, 10));
    if (dates.length > limit) {
      throw new XunjiError('RANGE_TOO_LARGE', `Date range must not exceed ${limit} days.`, 400);
    }
  }
  return dates;
}

function hasResult(payload) {
  return payload !== null
    && typeof payload === 'object'
    && Object.prototype.hasOwnProperty.call(payload, 'res');
}

function upstreamError(response) {
  const code = response.status === 401 || response.status === 403
    ? 'XUNJI_AUTH_FAILED'
    : response.status === 429
      ? 'XUNJI_RATE_LIMITED'
      : 'XUNJI_API_ERROR';
  const status = response.status === 429 ? 429 : response.status >= 400 ? response.status : 502;
  const message = code === 'XUNJI_AUTH_FAILED'
    ? 'Xunji rejected the configured API key.'
    : code === 'XUNJI_RATE_LIMITED'
      ? 'Xunji rate limit reached. Please retry later.'
      : `Xunji API request failed (HTTP ${response.status}).`;
  return new XunjiError(code, message, status);
}

async function postXunjiJson(endpoint, body, baseEnvName, defaultBaseUrl) {
  const { apiKey, baseUrl, timeoutMs } = getConfig(baseEnvName, defaultBaseUrl);
  const url = new URL(endpoint, baseUrl);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'accept-encoding': 'gzip',
        'user-agent': 'xunji-health-mcp/0.3.2'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new XunjiError('XUNJI_TIMEOUT', 'Xunji API request timed out.', 504);
    }
    throw new XunjiError('XUNJI_UNREACHABLE', 'Could not reach the Xunji API.', 502);
  }

  let payload;
  try {
    // Node fetch transparently decompresses Content-Encoding: gzip.
    payload = await response.json();
  } catch {
    throw new XunjiError(
      'XUNJI_INVALID_RESPONSE',
      `Xunji API returned a non-JSON response (HTTP ${response.status}).`,
      502
    );
  }

  if (!response.ok || !hasResult(payload)) {
    throw upstreamError(response);
  }
  return payload.res;
}

async function postTrainingRequest(datestr, includeFullData = false) {
  const res = await postXunjiJson(
    '/api_trains_for_llm_v2',
    {
        schema_version: 'train_open_api_v2',
        datestr,
        include_full_data: includeFullData
    },
    'XUNJI_API_BASE',
    DEFAULT_BASE_URL
  );

  return {
    schema_version: 'train_open_api_v2',
    datestr,
    res
  };
}

export async function getTraining({ date, include_full_data = false }) {
  if (!isIsoDate(date)) {
    throw new XunjiError('INVALID_DATE', 'date must use YYYY-MM-DD.', 400);
  }
  return postTrainingRequest(date, include_full_data);
}

export async function queryOfficialPlan({
  action,
  plan_ref,
  start_date,
  end_date,
  include_movements = true
}) {
  if (action !== 'list' && action !== 'get') {
    throw new XunjiError('INVALID_ACTION', 'action must be list or get.', 400);
  }
  const body = { schema_version: 'plan_open_api_v1', action };
  if (action === 'get') {
    if (typeof plan_ref !== 'string' || !plan_ref.trim()) {
      throw new XunjiError('PLAN_REF_REQUIRED', 'plan_ref is required for action get.', 400);
    }
    if ((start_date && !end_date) || (!start_date && end_date)) {
      throw new XunjiError('INVALID_RANGE', 'start_date and end_date must be provided together.', 400);
    }
    if (start_date && end_date) enumerateDates(start_date, end_date, 92);
    Object.assign(body, {
      plan_ref: plan_ref.trim(),
      ...(start_date ? { start_date, end_date } : {}),
      include_movements
    });
  }
  const res = await postXunjiJson(
    '/open/plan/query_gzip',
    body,
    'XUNJI_PLAN_API_BASE',
    DEFAULT_PLAN_BASE_URL
  );
  return {
    schema_version: 'plan_open_api_v1',
    action,
    res
  };
}
