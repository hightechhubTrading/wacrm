'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { MessageSquare, UserPlus, DollarSign, Send } from 'lucide-react';

import {
  loadActivity,
  loadConversationsSeries,
  loadMetrics,
  loadPipelineDonut,
  loadResponseTime,
} from '@/lib/dashboard/queries';
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  ResponseTimeSummary,
} from '@/lib/dashboard/types';

import { DashboardGreeting } from '@/components/dashboard/dashboard-greeting';
import dashboardStyles from '@/components/dashboard/dashboard-design.module.css';
import { Agenda } from '@/components/dashboard/agenda';
import { WeatherWidget } from '@/components/dashboard/weather-widget';
import { WorkdayWidget } from '@/components/dashboard/workday-widget';
import widgetStyles from '@/components/dashboard/workday-widget.module.css';
import { MetricCard } from '@/components/dashboard/metric-card';
import { SkeletonCard } from '@/components/dashboard/skeleton';
import { QuickActions } from '@/components/dashboard/quick-actions';
import { ConversationsChart } from '@/components/dashboard/conversations-chart';
import { PipelineDonut } from '@/components/dashboard/pipeline-donut';
import { ResponseTimeChart } from '@/components/dashboard/response-time-chart';
import { ActivityFeed } from '@/components/dashboard/activity-feed';

import { useTranslations } from 'next-intl';

type RangeDays = 7 | 30 | 90;

export default function DashboardPage() {
  const t = useTranslations('Dashboard.page');
  const { defaultCurrency } = useAuth();
  const [metrics, setMetrics] = useState<MetricsBundle | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);

  const [range, setRange] = useState<RangeDays>(30);
  // Keep a cache per range so switching tabs doesn't re-fetch what we
  // already have. Ranges the user hasn't opened yet stay null and
  // trigger a fetch on first view.
  const [series, setSeries] = useState<
    Record<RangeDays, ConversationsSeriesPoint[] | null>
  >({
    7: null,
    30: null,
    90: null,
  });
  const [seriesLoading, setSeriesLoading] = useState(true);

  const [pipeline, setPipeline] = useState<PipelineDonutData | null>(null);
  const [pipelineLoading, setPipelineLoading] = useState(true);

  const [responseTime, setResponseTime] = useState<ResponseTimeSummary | null>(
    null
  );
  const [responseTimeLoading, setResponseTimeLoading] = useState(true);

  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);

  const loadAll = useCallback(() => {
    const db = createClient();

    // Kick everything off in parallel. Each block has its own
    // setState + finally so a slow query doesn't hold up faster
    // sections — each widget shows its own skeleton independently.
    void loadMetrics(db)
      .then((m) => setMetrics(m))
      .catch((err) => console.error('[dashboard] metrics failed:', err))
      .finally(() => setMetricsLoading(false));

    void loadConversationsSeries(db, 30)
      .then((s) => setSeries((prev) => ({ ...prev, 30: s })))
      .catch((err) => console.error('[dashboard] series failed:', err))
      .finally(() => setSeriesLoading(false));

    void loadPipelineDonut(db)
      .then((p) => setPipeline(p))
      .catch((err) => console.error('[dashboard] pipeline failed:', err))
      .finally(() => setPipelineLoading(false));

    void loadResponseTime(db)
      .then((r) => setResponseTime(r))
      .catch((err) => console.error('[dashboard] response time failed:', err))
      .finally(() => setResponseTimeLoading(false));

    // Fetch up to 50 so the biggest page-size option in the feed
    // (50 rows) is already in memory — switching sizes then becomes
    // a pure client-side slice with no extra round trip.
    void loadActivity(db, 50)
      .then((a) => setActivity(a))
      .catch((err) => console.error('[dashboard] activity failed:', err))
      .finally(() => setActivityLoading(false));
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Range switch handler — kept in an event callback (not an effect)
  // so the setState calls stay out of the react-hooks/set-state-in-effect
  // rule's way. The cached bucket check means switching back to a
  // previously-viewed range is instant and doesn't re-fetch.
  const handleRangeChange = useCallback(
    (r: RangeDays) => {
      setRange(r);
      if (series[r] !== null) return;
      setSeriesLoading(true);
      const db = createClient();
      loadConversationsSeries(db, r)
        .then((s) => setSeries((prev) => ({ ...prev, [r]: s })))
        .catch((err) => console.error('[dashboard] series failed:', err))
        .finally(() => setSeriesLoading(false));
    },
    [series]
  );

  return (
    <div
      className={`crm-dashboard space-y-5 ${widgetStyles.dashboard} ${dashboardStyles.surface}`}
    >
      <DashboardGreeting />
      <Agenda />
      <QuickActions />
      <div className={widgetStyles.widgets}>
        <div className={widgetStyles.weatherSlot}>
          <WeatherWidget />
        </div>
        <WorkdayWidget />
      </div>

      <section aria-labelledby="dashboard-overview">
        <div className="crm-dashboard-section-heading">
          <div>
            <p>{t('overviewEyebrow')}</p>
            <h2 id="dashboard-overview">{t('overviewTitle')}</h2>
          </div>
          <span>{t('overviewHint')}</span>
        </div>
        <div className="crm-dashboard-metrics">
          {metricsLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} className="crm-dashboard-metric-skeleton" />
            ))
          ) : !metrics ? (
            <p
              role="status"
              className="text-muted-foreground col-span-full text-sm"
            >
              {t('unavailable')}{' '}
              <button onClick={loadAll} className="text-primary underline">
                {t('retry')}
              </button>
            </p>
          ) : (
            <>
              <MetricCard
                href="/inbox"
                tone="sage"
                title={t('activeConversations')}
                value={metrics.activeConversations.current.toLocaleString()}
                icon={MessageSquare}
                delta={{
                  sign: metrics.activeConversations.previous,
                  label: deltaLabel(
                    metrics.activeConversations.previous,
                    t('newTodayVsYesterday'),
                    t('noChange', { suffix: t('newTodayVsYesterday') })
                  ),
                }}
              />
              <MetricCard
                href="/contacts"
                tone="sky"
                comparison={{
                  current: metrics.newContactsToday.current,
                  previous: metrics.newContactsToday.previous,
                  currentLabel: t('today'),
                  previousLabel: t('yesterday'),
                }}
                title={t('newContactsToday')}
                value={metrics.newContactsToday.current.toLocaleString()}
                icon={UserPlus}
                delta={{
                  sign:
                    metrics.newContactsToday.current -
                    metrics.newContactsToday.previous,
                  label: deltaLabel(
                    metrics.newContactsToday.current -
                      metrics.newContactsToday.previous,
                    t('vsYesterday'),
                    t('noChange', { suffix: t('vsYesterday') })
                  ),
                }}
              />
              <MetricCard
                href="/pipelines"
                tone="sand"
                title={t('openDealsValue')}
                value={formatCurrency(metrics.openDealsValue, defaultCurrency)}
                icon={DollarSign}
                subtitle={t('openDeals', { count: metrics.openDealsCount })}
              />
              <MetricCard
                href="/inbox"
                tone="rose"
                comparison={{
                  current: metrics.messagesSentToday.current,
                  previous: metrics.messagesSentToday.previous,
                  currentLabel: t('today'),
                  previousLabel: t('yesterday'),
                }}
                title={t('messagesSentToday')}
                value={metrics.messagesSentToday.current.toLocaleString()}
                icon={Send}
                delta={{
                  sign:
                    metrics.messagesSentToday.current -
                    metrics.messagesSentToday.previous,
                  label: deltaLabel(
                    metrics.messagesSentToday.current -
                      metrics.messagesSentToday.previous,
                    t('vsYesterday'),
                    t('noChange', { suffix: t('vsYesterday') })
                  ),
                }}
              />
            </>
          )}
        </div>
      </section>

      <section
        className="crm-dashboard-insights"
        aria-labelledby="dashboard-insights"
      >
        <div className="crm-dashboard-section-heading">
          <div>
            <p>{t('insightsEyebrow')}</p>
            <h2 id="dashboard-insights">{t('insightsTitle')}</h2>
          </div>
          <span>{t('insightsHint')}</span>
        </div>
        <div className="crm-dashboard-charts">
          <ConversationsChart
            series={series}
            loading={seriesLoading}
            range={range}
            onRangeChange={handleRangeChange}
          />
          <PipelineDonut
            data={pipeline}
            loading={pipelineLoading}
            currency={defaultCurrency}
          />
        </div>
      </section>
      <div className="crm-dashboard-bottom">
        <ResponseTimeChart data={responseTime} loading={responseTimeLoading} />
        <ActivityFeed items={activity} loading={activityLoading} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------

function deltaLabel(
  delta: number,
  suffix: string,
  noChangeLabel: string
): string {
  if (delta === 0) return noChangeLabel;
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toLocaleString()} ${suffix}`;
}
