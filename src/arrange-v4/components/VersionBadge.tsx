"use client";

import styles from "./VersionBadge.module.css";

const version = process.env.NEXT_PUBLIC_APP_VERSION || "local";

export default function VersionBadge() {
  return (
    <span className={styles.badge} aria-label={`Build version ${version}`}>
      {version}
    </span>
  );
}
