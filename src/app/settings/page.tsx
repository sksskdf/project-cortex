import { ko as t } from '@/copy/ko';
import { WorktreeToggle } from '@/components/WorktreeToggle';
import { HeadroomToggle } from '@/components/HeadroomToggle';
import { CliAllowedToolsToggle } from '@/components/CliAllowedToolsToggle';
import { GithubAppsManager } from '@/components/GithubAppsManager';
import { InstallCortexSkillButton } from '@/components/InstallCortexSkillButton';
import { listGithubApps } from '@/lib/github-apps';
import { isHeadroomAvailable } from '@/lib/headroom';
import { getSettings } from '@/lib/settings';
import styles from './page.module.css';

export default async function SettingsPage() {
  const settings = getSettings();
  const githubApps = listGithubApps();
  const headroomAvailable = isHeadroomAvailable();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.settings.title}</h1>
        <p className={styles.subtitle}>{t.settings.subtitle}</p>
      </header>

      <section className={styles.card} aria-label={t.settings.githubApps.title}>
        <div className={styles.cardHead}>
          <div>
            <div className={styles.cardTitle}>{t.settings.githubApps.title}</div>
            <div className={styles.cardDesc}>{t.settings.githubApps.desc}</div>
          </div>
        </div>
        <GithubAppsManager apps={githubApps} />
      </section>

      <section className={styles.card} aria-label={t.settings.worktree.title}>
        <div className={styles.cardHead}>
          <div>
            <div className={styles.cardTitle}>{t.settings.worktree.title}</div>
            <div className={styles.cardDesc}>{t.settings.worktree.desc}</div>
          </div>
        </div>
        <WorktreeToggle initial={settings.agentWorktreeEnabled} />
      </section>

      <section className={styles.card} aria-label={t.settings.headroom.title}>
        <div className={styles.cardHead}>
          <div>
            <div className={styles.cardTitle}>{t.settings.headroom.title}</div>
            <div className={styles.cardDesc}>{t.settings.headroom.desc}</div>
          </div>
        </div>
        <HeadroomToggle initial={settings.headroomEnabled} available={headroomAvailable} />
      </section>

      <section className={styles.card} aria-label={t.settings.cliAllowedTools.title}>
        <div className={styles.cardHead}>
          <div>
            <div className={styles.cardTitle}>{t.settings.cliAllowedTools.title}</div>
            <div className={styles.cardDesc}>{t.settings.cliAllowedTools.desc}</div>
          </div>
        </div>
        <CliAllowedToolsToggle initial={settings.cliAllowedToolsEnabled} />
      </section>

      <section className={styles.card} aria-label={t.settings.skill.title}>
        <div className={styles.cardHead}>
          <div>
            <div className={styles.cardTitle}>{t.settings.skill.title}</div>
            <div className={styles.cardDesc}>{t.settings.skill.desc}</div>
          </div>
        </div>
        <InstallCortexSkillButton />
      </section>
    </div>
  );
}
