'use client';

// Phase 14 — 인터랙티브 도움말. AppShell(루트 레이아웃)에 마운트되어 어느 화면에서든
// '?' 단축키로 토글한다. 별도 문서 페이지가 아니라 현재 화면 위 overlay 로 주요 화면과
// 단축키를 한눈에 보여준다. '둘러보기' 를 누르면 사이드바 섹션을 차례로 spotlight 하는
// 가벼운 가이드 투어(라이브러리 없이 직접 구현)로 전환된다.

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ko as t } from '@/copy/ko';
import styles from './HelpOverlay.module.css';

type HelpCtx = { openHelp: () => void };
const Ctx = createContext<HelpCtx | null>(null);

export function useHelp(): HelpCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useHelp must be used within HelpProvider');
  return ctx;
}

// 사이드바 항목과 1:1 — 화면 안내 목록.
const SCREENS = [
  { key: 'dashboard', label: t.nav.dashboard, desc: t.help.screens.dashboard },
  { key: 'inbox', label: t.nav.inbox, desc: t.help.screens.inbox },
  { key: 'projects', label: t.nav.projects, desc: t.help.screens.projects },
  { key: 'issues', label: t.nav.issues, desc: t.help.screens.issues },
  { key: 'todos', label: t.nav.todos, desc: t.help.screens.todos },
  { key: 'notes', label: t.nav.notes, desc: t.help.screens.notes },
  { key: 'agents', label: t.nav.agents, desc: t.help.screens.agents },
  { key: 'clusters', label: t.nav.clusters, desc: t.help.screens.clusters },
  { key: 'reports', label: t.nav.reports, desc: t.help.screens.reports },
] as const;

const SHORTCUTS = [
  { key: t.help.shortcuts.helpKey, desc: t.help.shortcuts.helpDesc },
  { key: t.help.shortcuts.escKey, desc: t.help.shortcuts.escDesc },
  { key: t.help.shortcuts.tourKey, desc: t.help.shortcuts.tourDesc },
] as const;

// 가이드 투어 — 사이드바 핵심 흐름을 차례로 안내. label 은 spotlight 한 화면 이름.
const TOUR = [
  { label: t.nav.inbox, ...t.help.tour.steps.inbox },
  { label: t.nav.clusters, ...t.help.tour.steps.clusters },
  { label: t.nav.agents, ...t.help.tour.steps.agents },
  { label: t.nav.reports, ...t.help.tour.steps.reports },
] as const;

export function HelpProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // null = 화면 안내 목록. 숫자 = 가이드 투어 진행 단계.
  const [tourStep, setTourStep] = useState<number | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setTourStep(null);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // 입력 중에는 '?' 가로채지 않음 — 텍스트 입력 보호.
      const el = e.target as HTMLElement | null;
      const typing =
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable);

      if (e.key === '?' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen((v) => !v);
        setTourStep(null);
        return;
      }
      if (!open) return;
      if (e.key === 'Escape') {
        close();
        return;
      }
      // 투어 중 방향키로 단계 이동.
      if (tourStep !== null && e.key === 'ArrowRight') {
        e.preventDefault();
        setTourStep((s) => (s !== null && s < TOUR.length - 1 ? s + 1 : s));
      }
      if (tourStep !== null && e.key === 'ArrowLeft') {
        e.preventDefault();
        setTourStep((s) => (s !== null && s > 0 ? s - 1 : s));
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, tourStep, close]);

  return (
    <Ctx.Provider value={{ openHelp: () => setOpen(true) }}>
      {children}
      {open ? (
        <HelpOverlay
          tourStep={tourStep}
          onStartTour={() => setTourStep(0)}
          onTourStep={setTourStep}
          onExitTour={() => setTourStep(null)}
          onClose={close}
        />
      ) : null}
    </Ctx.Provider>
  );
}

function HelpOverlay({
  tourStep,
  onStartTour,
  onTourStep,
  onExitTour,
  onClose,
}: {
  tourStep: number | null;
  onStartTour: () => void;
  onTourStep: (step: number) => void;
  onExitTour: () => void;
  onClose: () => void;
}) {
  const inTour = tourStep !== null;

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden />
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={t.help.title}>
        <header className={styles.head}>
          <div className={styles.titleBlock}>
            <h2 className={styles.title}>{t.help.title}</h2>
            <p className={styles.subtitle}>{t.help.subtitle}</p>
          </div>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            aria-label={t.help.close}
            title={t.help.close}
          >
            <CloseIcon />
          </button>
        </header>

        {inTour ? (
          <TourBody step={tourStep} onTourStep={onTourStep} onExitTour={onExitTour} />
        ) : (
          <div className={styles.body}>
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>{t.help.screensTitle}</h3>
              <ul className={styles.screenList}>
                {SCREENS.map((s) => (
                  <li key={s.key} className={styles.screenRow}>
                    <span className={styles.screenLabel}>{s.label}</span>
                    <span className={styles.screenDesc}>{s.desc}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>{t.help.shortcutsTitle}</h3>
              <ul className={styles.shortcutList}>
                {SHORTCUTS.map((s) => (
                  <li key={s.desc} className={styles.shortcutRow}>
                    <kbd className={styles.kbd}>{s.key}</kbd>
                    <span className={styles.screenDesc}>{s.desc}</span>
                  </li>
                ))}
              </ul>
            </section>

            <footer className={styles.footer}>
              <button
                type="button"
                className="ds-btn ds-btn--md ds-btn--filled-blue"
                onClick={onStartTour}
              >
                <span className="ds-btn__label">{t.help.tour.start}</span>
              </button>
            </footer>
          </div>
        )}
      </div>
    </>
  );
}

function TourBody({
  step,
  onTourStep,
  onExitTour,
}: {
  step: number;
  onTourStep: (step: number) => void;
  onExitTour: () => void;
}) {
  const total = TOUR.length;
  const item = TOUR[step];
  const isLast = step === total - 1;

  return (
    <div className={styles.body}>
      <div className={styles.tourCard}>
        <span className={styles.tourSpot}>{item.label}</span>
        <h3 className={styles.tourTitle}>{item.title}</h3>
        <p className={styles.tourDesc}>{item.desc}</p>
        <div className={styles.tourDots} aria-hidden>
          {TOUR.map((s, i) => (
            <span
              key={s.label}
              className={`${styles.tourDot} ${i === step ? styles.tourDotActive : ''}`}
            />
          ))}
        </div>
      </div>

      <footer className={styles.tourFooter}>
        <button
          type="button"
          className="ds-btn ds-btn--sm ds-btn--outlined-basic"
          onClick={onExitTour}
        >
          <span className="ds-btn__label">{t.help.tour.skip}</span>
        </button>
        <span className={styles.tourCount}>{t.help.tour.step(step + 1, total)}</span>
        <div className={styles.tourNav}>
          <button
            type="button"
            className="ds-btn ds-btn--sm ds-btn--outlined-basic"
            onClick={() => onTourStep(step - 1)}
            disabled={step === 0}
          >
            <span className="ds-btn__label">{t.help.tour.prev}</span>
          </button>
          <button
            type="button"
            className="ds-btn ds-btn--sm ds-btn--filled-blue"
            onClick={() => (isLast ? onExitTour() : onTourStep(step + 1))}
          >
            <span className="ds-btn__label">{isLast ? t.help.tour.done : t.help.tour.next}</span>
          </button>
        </div>
      </footer>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1={18} y1={6} x2={6} y2={18} />
      <line x1={6} y1={6} x2={18} y2={18} />
    </svg>
  );
}
