'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4">
      <div className="text-center">
        <h2 className="mb-2 text-xl font-bold text-text-primary">Something went wrong</h2>
        <p className="mb-4 text-sm text-text-secondary">
          {error.message || 'An unexpected error occurred.'}
        </p>
        <button
          onClick={reset}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
