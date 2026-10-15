import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function GET() {
  try {
    await requireRole('agent');
    const key = process.env.OPEN_METEO_API_KEY;
    const url = new URL(
      '/v1/forecast',
      key ? 'https://customer-api.open-meteo.com' : 'https://api.open-meteo.com'
    );
    url.search = new URLSearchParams({
      latitude: '25.2854',
      longitude: '51.5310',
      timezone: 'Asia/Qatar',
      current:
        'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min',
      forecast_days: '4',
      ...(key ? { apikey: key } : {}),
    }).toString();
    const response = await fetch(url, {
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      return Response.json({ error: 'Weather unavailable' }, { status: 502 });
    const data = await response.json();
    if (
      !data.current ||
      !data.daily ||
      ![
        'temperature_2m',
        'apparent_temperature',
        'relative_humidity_2m',
        'weather_code',
        'is_day',
        'wind_speed_10m',
      ].every((field) => Number.isFinite(data.current[field])) ||
      ![
        'time',
        'weather_code',
        'temperature_2m_max',
        'temperature_2m_min',
      ].every(
        (field) =>
          Array.isArray(data.daily[field]) && data.daily[field].length === 4
      ) ||
      !['weather_code', 'temperature_2m_max', 'temperature_2m_min'].every(
        (field) => data.daily[field].every(Number.isFinite)
      ) ||
      !data.daily.time.every(
        (day: unknown) =>
          typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
      )
    ) {
      return Response.json({ error: 'Weather unavailable' }, { status: 502 });
    }
    return Response.json({ current: data.current, daily: data.daily });
  } catch (error) {
    return toErrorResponse(error);
  }
}
