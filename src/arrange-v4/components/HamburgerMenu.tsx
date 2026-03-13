'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMsal } from '@azure/msal-react';
import styles from './HamburgerMenu.module.css';

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
];

export default function HamburgerMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [navItems, setNavItems] = useState<NavItem[]>(BASE_NAV_ITEMS);
  const pathname = usePathname();
  const { instance, accounts } = useMsal();

  const isAuthenticated = accounts.length > 0;

  const handleSignOut = () => {
    setIsOpen(false);
    instance.logoutPopup({ postLogoutRedirectUri: '/' });
  };

  useEffect(() => {
    const savedBookId = localStorage.getItem('lastBookId');
    if (savedBookId) {
      setNavItems(BASE_NAV_ITEMS.map(item =>
        item.matchPrefix ? { ...item, href: `/matrix?bookId=${savedBookId}` } : item
      ));
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen]);

  function isActive(item: NavItem): boolean {
    if (item.matchPrefix) {
      return pathname.startsWith('/matrix');
    }
    return pathname === item.href;
  }

  return (
    <>
      <button
        className={styles.menuButton}
        onClick={() => setIsOpen(true)}
        aria-label="Open navigation menu"
      >
        ☰
      </button>

      {isOpen && (
        <>
          <div className={styles.overlay} onClick={() => setIsOpen(false)} />
          <aside className={styles.sidebar} role="navigation" aria-label="Main navigation">
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
