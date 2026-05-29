// Phase 7 — /reports 페이지.
// 운영 메트릭 시각화: 자동 머지율 / 일별 인입 / 일별 머지 추이 / 평균 신뢰 점수 / revert 감지.
// 차트는 Recharts (가장 보편적 React 차트 라이브러리). client component 로 분리.

import Link from 'next/link';
import { ko as t } from '@/copy/ko';
import {
  AvgConfidenceChart,
  DailyIncomingChart,
  DailyMergeChart,
} from '@/components/ReportsCharts';
import { getReportsData } from '@/lib/reports';
import { getLlmCostSummary } from '@/lib/llm-cost';
import styles from './page.module.css';

type RevertStatus = keyof typeof t.reports.revertStatus;

export default function ReportsPage() {
  const data = getReportsData();
  const { mergeRate, prevMergeRate, dailyIncoming, dailyMerges, dailyAvgConfidence, reverts } =
    data;
  const llmCost = getLlmCostSummary();

  const delta = mergeRate.autoMergeRate - prevMergeRate.autoMergeRate;
  const deltaText = delta > 0 ? `▲ ${delta}%p` : delta < 0 ? `▼ ${Math.abs(delta)}%p` : `· ±0%p`;
  const deltaClass = delta > 0 ? styles.deltaUp : delta < 0 ? styles.deltaDown : styles.deltaFlat;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.reports.title}</h1>
        <p className={styles.subtitle}>{t.reports.subtitle}</p>
      </header>

      <section className={styles.section} aria-label={t.reports.section.mergeRate}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t.reports.section.mergeRate}</h2>
          <p className={styles.sectionDesc}>{t.reports.section.mergeRateDesc}</p>
        </div>
        <div className={styles.mergeRateBox}>
          <div className={styles.mergeRateValue}>
            <span className={styles.mergeRatePct}>{mergeRate.autoMergeRate}%</span>
            <span className={`${styles.mergeRateDelta} ${deltaClass}`}>{deltaText}</span>
          </div>
          <div className={styles.mergeRateMeta}>
            <div>{t.reports.mergeRate.total(mergeRate.autoCount, mergeRate.totalMerged)}</div>
            <div className={styles.mergeRateBreakdown}>
              {t.reports.mergeRate.breakdown(
                mergeRate.autoCount,
                mergeRate.humanCount,
                mergeRate.githubCount,
              )}
            </div>
            <div className={styles.mergeRateCompare}>
              {t.reports.mergeRate.compareTo(prevMergeRate.autoMergeRate)}
            </div>
          </div>
        </div>
      </section>

      <div className={styles.cols2}>
        <section className={styles.section} aria-label={t.reports.section.dailyIncoming}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{t.reports.section.dailyIncoming}</h2>
            <p className={styles.sectionDesc}>{t.reports.section.dailyIncomingDesc}</p>
          </div>
          <DailyIncomingChart points={dailyIncoming} />
        </section>

        <section className={styles.section} aria-label={t.reports.section.dailyMerges}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{t.reports.section.dailyMerges}</h2>
            <p className={styles.sectionDesc}>{t.reports.section.dailyMergesDesc}</p>
          </div>
          <DailyMergeChart points={dailyMerges} />
        </section>
      </div>

      <section className={styles.section} aria-label={t.reports.section.avgConfidence}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t.reports.section.avgConfidence}</h2>
          <p className={styles.sectionDesc}>{t.reports.section.avgConfidenceDesc}</p>
        </div>
        <AvgConfidenceChart points={dailyAvgConfidence} />
      </section>

      <section className={styles.section} aria-label={t.reports.section.reverts}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t.reports.section.reverts}</h2>
          <p className={styles.sectionDesc}>{t.reports.section.revertsDesc}</p>
        </div>
        {reverts.length === 0 ? (
          <div className={styles.empty}>{t.reports.revertEmpty}</div>
        ) : (
          <ul className={styles.revertList}>
            {reverts.map((r) => {
              const statusKey: RevertStatus = (
                Object.keys(t.reports.revertStatus).includes(r.status) ? r.status : 'open'
              ) as RevertStatus;
              return (
                <li key={r.prId} className={styles.revertRow}>
                  <Link href={`/pr/${r.prId}`} className={styles.revertLink}>
                    <span className={styles.revertSlug}>
                      {r.slug} #{r.number}
                    </span>
                    <span className={styles.revertTitle}>{r.title}</span>
                  </Link>
                  <span
                    className={`${styles.revertStatus} ${styles[`revertStatus_${statusKey}`] ?? ''}`}
                  >
                    {t.reports.revertStatus[statusKey]}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-label={t.reports.section.llmCost}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t.reports.section.llmCost}</h2>
          <p className={styles.sectionDesc}>{t.reports.section.llmCostDesc}</p>
        </div>
        {llmCost.callCount === 0 ? (
          <div className={styles.empty}>{t.reports.llmCost.empty}</div>
        ) : (
          <div className={styles.llmCostBox}>
            <div className={styles.llmCostStats}>
              <div className={styles.llmCostStat}>
                <span className={styles.llmCostLabel}>{t.reports.llmCost.total}</span>
                <span className={styles.llmCostValue}>
                  {t.reports.llmCost.usd(llmCost.totalCostUsd)}
                </span>
              </div>
              <div className={styles.llmCostStat}>
                <span className={styles.llmCostLabel}>{t.reports.llmCost.week}</span>
                <span className={styles.llmCostValue}>
                  {t.reports.llmCost.usd(llmCost.weekCostUsd)}
                </span>
              </div>
              <div className={styles.llmCostStat}>
                <span className={styles.llmCostLabel}>{t.reports.llmCost.calls}</span>
                <span className={styles.llmCostValue}>
                  {t.reports.llmCost.callsUnit(llmCost.callCount)}
                </span>
              </div>
            </div>
            {llmCost.byModel.length > 0 && (
              <ul className={styles.llmCostModels}>
                {llmCost.byModel.map((m) => (
                  <li key={m.model} className={styles.llmCostModelRow}>
                    {t.reports.llmCost.modelRow(m.model, m.costUsd, m.calls)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
