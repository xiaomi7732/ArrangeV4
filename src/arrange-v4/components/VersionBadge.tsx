"use client";

const version = process.env.NEXT_PUBLIC_APP_VERSION || "local";

export default function VersionBadge() {
  return (
    <span
      style={{
        position: "fixed",
        top: 8,
        right: 12,
        fontSize: "0.7rem",
        color: "#888",
        zIndex: 9999,
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      {version}
    </span>
  );
}
