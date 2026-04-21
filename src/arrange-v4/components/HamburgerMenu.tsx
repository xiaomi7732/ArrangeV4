'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMsal } from '@azure/msal-react';
import { getLastBookId } from '@/lib/bookStorage';
import { useTopBarActions } from './TopBarProvider';
import styles from './HamburgerMenu.module.css';

const version = process.env.NEXT_PUBLIC_APP_VERSION || 'local';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  matchPrefix?: boolean;
}

const BASE_NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Home', icon: '🏠' },
  { href: '/books', label: 'My Books', icon: '📚' },
  { href: '/matrix', label: 'Matrix', icon: '📊', matchPrefix: true },
  { href: '/scrum', label: 'Scrum Board', icon: '🏃', matchPrefix: true },
  { href: '/cancelled', label: 'Cancelled Tasks', icon: '🗑️', matchPrefix: true },
];

function ViewSwitcherInner({ isOnMatrix, isOnScrum }: { isOnMatrix: boolean; isOnScrum: boolean }) {
  const searchParams = useSearchParams();
  const bookId = searchParams.get('bookId') || getLastBookId();
  const query = bookId ? `?bookId=${encodeURIComponent(bookId)}` : '';

  return (
    <div className={styles.viewSwitcher} role="navigation" aria-label="Switch view">
      <Link
        href={`/matrix${query}`}
        className={`${styles.viewSwitcherButton} ${isOnMatrix ? styles.viewSwitcherActive : ''}`}
        aria-label="Matrix view"
        aria-current={isOnMatrix ? 'page' : undefined}
      >
        📊
      </Link>
      <Link
        href={`/scrum${query}`}
        className={`${styles.viewSwitcherButton} ${isOnScrum ? styles.viewSwitcherActive : ''}`}
        aria-label="Scrum view"
        aria-current={isOnScrum ? 'page' : undefined}
      >
        🏃
      </Link>
    </div>
  );
}

export default function HamburgerMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [navItems, setNavItems] = useState<NavItem[]>(BASE_NAV_ITEMS);
  const pathname = usePathname();
  const { instance, accounts } = useMsal();
  const sidebarRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const { leftActions, rightActions } = useTopBarActions();

  const isAuthenticated = accounts.length > 0;

  const isOnMatrix = pathname.startsWith('/matrix');
  const isOnScrum = pathname.startsWith('/scrum');
  const showViewSwitcher = isOnMatrix || isOnScrum;

  function isActive(item: NavItem): boolean {
    if (item.matchPrefix) {
      const basePath = item.href.split('?')[0];
      return pathname.startsWith(basePath);
    }
    return pathname === item.href;
  }

  const currentPage = navItems.find(item => isActive(item));
  const pageLabel = currentPage?.label || 'Arrange';

  const handleSignOut = () => {
    setIsOpen(false);
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
    instance.logoutPopup({ postLogoutRedirectUri: `${window.location.origin}${basePath}/` });
  };

  useEffect(() => {
    const savedBookId = getLastBookId();
    if (savedBookId) {
      setNavItems(BASE_NAV_ITEMS.map(item =>
        item.matchPrefix ? { ...item, href: `${item.href}?bookId=${encodeURIComponent(savedBookId)}` } : item
      ));
    } else {
      setNavItems(BASE_NAV_ITEMS);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      triggerRef.current?.focus();
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        return;
      }
      // Focus trap
      if (e.key === 'Tab' && sidebarRef.current) {
        const focusable = sidebarRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    // Move focus into sidebar
    const closeBtn = sidebarRef.current?.querySelector<HTMLElement>('button');
    closeBtn?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  return (
    <>
      <header className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <button
            ref={triggerRef}
            className={styles.menuButton}
            onClick={() => setIsOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={isOpen}
            aria-controls="nav-sidebar"
          >
            ☰
          </button>
          <h1 className={styles.pageLabel}>{pageLabel}</h1>
          {showViewSwitcher && (
            <Suspense>
              <ViewSwitcherInner isOnMatrix={isOnMatrix} isOnScrum={isOnScrum} />
            </Suspense>
          )}
          {leftActions}
        </div>
        <div className={styles.topBarMiddle} />
        <div className={styles.topBarRight}>
          {rightActions}
          <span className={styles.version} aria-label={`Build version ${version}`}>{version}</span>
        </div>
      </header>

      {isOpen && (
        <>
          <div className={styles.overlay} onClick={() => setIsOpen(false)} />
          <aside id="nav-sidebar" ref={sidebarRef} className={styles.sidebar} role="navigation" aria-label="Main navigation">
            <div className={styles.sidebarHeader}>
              <span className={styles.sidebarTitle}>Arrange</span>
              <button
                className={styles.closeButton}
                onClick={() => setIsOpen(false)}
                aria-label="Close navigation menu"
              >
                ✕
              </button>
            </div>
            <nav className={styles.nav}>
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${styles.navLink} ${isActive(item) ? styles.navLinkActive : ''}`}
                  onClick={() => setIsOpen(false)}
                >
                  <span className={styles.navIcon}>{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </nav>
            {isAuthenticated && (
              <div className={styles.sidebarFooter}>
                <button className={styles.signOutButton} onClick={handleSignOut}>
                  <span className={styles.navIcon}>🚪</span>
                  Sign Out
                </button>
              </div>
            )}
          </aside>
        </>
      )}
    </>
  );
}
