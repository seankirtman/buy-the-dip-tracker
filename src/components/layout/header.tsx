'use client';

import Link from 'next/link';
import { SearchBar } from './search-bar';

export function Header() {
  return (
    <header className="border-b border-border bg-bg-secondary">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-bold text-text-primary hover:text-accent">
          EventTracker
        </Link>
        <div className="w-full max-w-md px-4">
          <SearchBar />
        </div>
        <div className="text-sm text-text-muted">Stock Event Tracker</div>
      </div>
    </header>
  );
}
