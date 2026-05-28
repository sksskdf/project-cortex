'use client';

// Phase 8.x — GitHub App 다중 설정 관리 UI. 목록 + 추가/수정/삭제.
// private key 는 표시하지 않고 보유 여부만(hasPrivateKey). 수정 시 키를 비워두면 기존 유지.

import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import {
  createGithubAppAction,
  deleteGithubAppAction,
  updateGithubAppAction,
  type GithubAppActionState,
} from '@/actions/settings';
import type { GithubAppView } from '@/lib/github-apps';
import styles from './GithubAppsManager.module.css';

const c = t.settings.githubApps;

export function GithubAppsManager({ apps }: { apps: ReadonlyArray<GithubAppView> }) {
  // null = 폼 닫힘, 'new' = 추가, number = 해당 id 수정.
  const [editing, setEditing] = useState<number | 'new' | null>(null);

  return (
    <div className={styles.wrap}>
      {apps.length === 0 ? (
        <p className={styles.empty}>{c.empty}</p>
      ) : (
        <ul className={styles.list}>
          {apps.map((app) => (
            <li key={app.id} className={styles.item}>
              {editing === app.id ? (
                <AppForm app={app} onClose={() => setEditing(null)} />
              ) : (
                <AppRow app={app} onEdit={() => setEditing(app.id)} />
              )}
            </li>
          ))}
        </ul>
      )}

      {editing === 'new' ? (
        <div className={styles.item}>
          <AppForm app={null} onClose={() => setEditing(null)} />
        </div>
      ) : (
        <button
          type="button"
          className="ds-btn ds-btn--sm ds-btn--outlined-basic"
          onClick={() => setEditing('new')}
        >
          <span className="ds-btn__label">{c.add}</span>
        </button>
      )}
    </div>
  );
}

function AppRow({ app, onEdit }: { app: GithubAppView; onEdit: () => void }) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);

  function onDelete() {
    setConfirm(false);
    startTransition(async () => {
      await deleteGithubAppAction(app.id);
    });
  }

  return (
    <div className={styles.row}>
      <div className={styles.rowMain}>
        <span className={styles.name}>{app.name}</span>
        <span className={styles.meta}>
          App ID {app.appId}
          {app.hasPrivateKey ? ` · ${c.hasKey}` : ''}
          {app.hasWebhookSecret ? ` · ${c.hasSecret}` : ''}
        </span>
      </div>
      {confirm ? (
        <div className={styles.actions}>
          <span className={styles.confirmText}>{c.removeConfirm(app.name)}</span>
          <button
            type="button"
            className="ds-btn ds-btn--sm ds-btn--filled-red"
            onClick={onDelete}
            disabled={pending}
          >
            <span className="ds-btn__label">{c.removeConfirmYes}</span>
          </button>
          <button
            type="button"
            className="ds-btn ds-btn--sm ds-btn--outlined-basic"
            onClick={() => setConfirm(false)}
            disabled={pending}
          >
            <span className="ds-btn__label">{c.removeConfirmNo}</span>
          </button>
        </div>
      ) : (
        <div className={styles.actions}>
          <button
            type="button"
            className="ds-btn ds-btn--sm ds-btn--outlined-basic"
            onClick={onEdit}
            disabled={pending}
          >
            <span className="ds-btn__label">{c.edit}</span>
          </button>
          <button
            type="button"
            className="ds-btn ds-btn--sm ds-btn--outlined-basic"
            onClick={() => setConfirm(true)}
            disabled={pending}
          >
            <span className="ds-btn__label">{c.remove}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function AppForm({ app, onClose }: { app: GithubAppView | null; onClose: () => void }) {
  const [name, setName] = useState(app?.name ?? '');
  const [appId, setAppId] = useState(app?.appId ?? '');
  const [privateKey, setPrivateKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const input = { name, appId, privateKey, webhookSecret: webhookSecret || undefined };
      const r: GithubAppActionState = app
        ? await updateGithubAppAction(app.id, input)
        : await createGithubAppAction(input);
      if (r.kind === 'created' || r.kind === 'updated') {
        onClose();
        return;
      }
      if (r.kind === 'invalid') setError(c.result.invalid(r.reason));
      else if (r.kind === 'duplicate-name') setError(c.result.duplicate);
      else if (r.kind === 'error') setError(c.result.error(r.message));
      else if (r.kind === 'not-found') setError(c.result.error('not-found'));
    });
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <label className={styles.field}>
        <span className={styles.label}>{c.nameLabel}</span>
        <input
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={c.namePlaceholder}
          disabled={pending}
          required
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>{c.appIdLabel}</span>
        <input
          className={styles.input}
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
          placeholder={c.appIdPlaceholder}
          disabled={pending}
          required
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>{c.privateKeyLabel}</span>
        <textarea
          className={styles.textarea}
          value={privateKey}
          onChange={(e) => setPrivateKey(e.target.value)}
          placeholder={c.privateKeyPlaceholder}
          rows={4}
          disabled={pending}
          required={!app}
        />
        {app ? <span className={styles.hint}>{c.privateKeyKeepHint}</span> : null}
      </label>
      <label className={styles.field}>
        <span className={styles.label}>{c.webhookSecretLabel}</span>
        <input
          className={styles.input}
          value={webhookSecret}
          onChange={(e) => setWebhookSecret(e.target.value)}
          placeholder={c.webhookSecretPlaceholder}
          disabled={pending}
        />
      </label>
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.formActions}>
        <button
          type="button"
          className="ds-btn ds-btn--sm ds-btn--outlined-basic"
          onClick={onClose}
          disabled={pending}
        >
          <span className="ds-btn__label">{c.cancel}</span>
        </button>
        <button
          type="submit"
          className="ds-btn ds-btn--sm ds-btn--filled-blue"
          disabled={pending}
          aria-busy={pending}
        >
          <span className="ds-btn__label">{c.save}</span>
        </button>
      </div>
    </form>
  );
}
