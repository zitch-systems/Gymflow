'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a12',
          color: '#f3f3fa',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <div style={{ fontSize: 48, fontWeight: 700, color: '#7c5cff' }}>GymFlow</div>
          <h1 style={{ fontSize: 22, margin: '16px 0 8px' }}>Something went wrong</h1>
          <p style={{ color: '#9b9bb8', margin: '0 0 24px', lineHeight: 1.6 }}>
            A critical error occurred while loading the app. Please try again.
          </p>
          {error.digest ? (
            <p style={{ color: '#6a6a86', fontSize: 13, marginBottom: 16 }}>Reference: {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              background: 'linear-gradient(135deg, #a48bff, #5d3bff)',
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              padding: '12px 24px',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
