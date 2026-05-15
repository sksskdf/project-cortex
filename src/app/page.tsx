import { ko } from '@/copy/ko';

export default function Page() {
  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--ds-spacing-12)',
        padding: 'var(--ds-spacing-32)',
      }}
    >
      <h1
        style={{
          fontSize: 'var(--ds-typography-font-size-24)',
          fontWeight: 'var(--ds-typography-font-weight-bold)',
          color: 'var(--ds-color-text-03-high)',
        }}
      >
        {ko.scaffold.title}
      </h1>
      <p style={{ color: 'var(--ds-color-text-02)' }}>{ko.scaffold.body}</p>
    </main>
  );
}
