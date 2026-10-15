# Dashboard weather

The dashboard weather widget defaults to Doha, Qatar (Asia/Qatar). It shows
current temperature, apparent temperature, wind, humidity and the next three
days of forecasts. English and Arabic labels follow the dashboard locale.

The authenticated `/api/dashboard/weather` endpoint fetches Open-Meteo data
with a 10-second timeout and a 15-minute Next.js fetch cache. The widget refreshes
every 15 minutes while the page is visible and includes a manual refresh button.
Manual refresh requests the latest cached reading. Failed refreshes keep the last
successful reading visible with a status message.

Set the server-only `OPEN_METEO_API_KEY` environment variable to use the customer
endpoint for commercial deployments. Without a key, the public endpoint is used
for evaluation/prototyping. See [Open-Meteo plans](https://open-meteo.com/en/pricing).
The key is never returned to the browser. The widget credits Open-Meteo.

The sky illustration animates once when conditions change with a 250 ms transform
and opacity reveal. Dashboard animations always play, including when the OS
requests reduced motion. Readings and forecast data stay stationary. The layout adapts to narrow screens and supports
RTL and dark mode.
