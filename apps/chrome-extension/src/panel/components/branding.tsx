/**
 * DevBridge branding: a geometric "D" mark, nav-rail icons, and the
 * Inspect landing illustration. All inline SVG — no assets, no deps.
 */

export function DevBridgeMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" role="presentation">
      <rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="#1c1f26" stroke="#6d5ef0" strokeWidth="1.6" />
      <path
        d="M8 6.5h4.2a5.2 5.2 0 0 1 0 11H8z"
        fill="none"
        stroke="#9d8cff"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="15.6" cy="15.8" r="1.7" fill="#67e8f9" />
    </svg>
  );
}

/**
 * Centered welcome mark: a clean geometric "D" with a violet-to-blue
 * gradient on a transparent background. Vector-only so it stays sharp at
 * any DevTools panel size; the wrapper scales it down gracefully via
 * max-width (see InspectLanding).
 */
export function DevBridgeWelcomeMark({ size = 88 }: { size?: number }) {
  const gradientId = "db-welcome-d-grad";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      role="presentation"
      aria-hidden="true"
      style={{ maxWidth: "100%", height: "auto", display: "block" }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="0.55" stopColor="#7c6cf0" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      {/* Geometric D: outer silhouette with an even-odd inner cutout. */}
      <path
        d="M32 12 H52 A36 36 0 0 1 52 84 H32 Z M42 24 V72 H50 A24 24 0 0 0 50 24 H42 Z"
        fill={`url(#${gradientId})`}
        fillRule="evenodd"
      />
    </svg>
  );
}

function iconBase(children: React.ReactNode) {
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden="true" role="presentation" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export const NavIcons = {
  inspect: iconBase(<><path d="M4 3l7 7-3.5.8L6 14.5 4 3z" /><circle cx="13.5" cy="13.5" r="1.2" /></>),
  components: iconBase(<><rect x="2.5" y="2.5" width="5.5" height="5.5" rx="1" /><rect x="10" y="2.5" width="5.5" height="5.5" rx="1" /><rect x="2.5" y="10" width="5.5" height="5.5" rx="1" /><rect x="10" y="10" width="5.5" height="5.5" rx="1" /></>),
  files: iconBase(<><path d="M4 2.5h5.5L13 6v9.5H4z" /><path d="M9.5 2.5V6H13" /></>),
  settings: iconBase(<><circle cx="9" cy="9" r="2.4" /><path d="M9 2.5v2M9 13.5v2M2.5 9h2M13.5 9h2M4.4 4.4l1.4 1.4M12.2 12.2l1.4 1.4M13.6 4.4l-1.4 1.4M5.8 12.2l-1.4 1.4" /></>),
};

/**
 * Browser-to-source workflow illustration: a minimal browser frame on the
 * left, a code fragment on the right, joined by a single connector.
 */
export function WorkflowIllustration() {
  return (
    <svg width={220} height={96} viewBox="0 0 220 96" aria-hidden="true" role="presentation">
      {/* browser frame */}
      <rect x="4" y="14" width="86" height="68" rx="6" fill="#1c1f26" stroke="#2a2e38" strokeWidth="1.2" />
      <line x1="4" y1="28" x2="90" y2="28" stroke="#2a2e38" strokeWidth="1.2" />
      <circle cx="12" cy="21" r="2.2" fill="#3a3f4c" />
      <circle cx="20" cy="21" r="2.2" fill="#3a3f4c" />
      <circle cx="28" cy="21" r="2.2" fill="#6d5ef0" />
      <rect x="12" y="36" width="52" height="7" rx="2" fill="#2a2e38" />
      <rect x="12" y="48" width="70" height="7" rx="2" fill="#2a2e38" />
      <rect x="12" y="60" width="40" height="7" rx="2" fill="#6d5ef0" opacity="0.65" />
      {/* connector */}
      <line x1="90" y1="48" x2="130" y2="48" stroke="#6d5ef0" strokeWidth="1.4" strokeDasharray="4 3" />
      <circle cx="110" cy="48" r="2.4" fill="#9d8cff" />
      {/* code fragment */}
      <rect x="130" y="14" width="86" height="68" rx="6" fill="#1c1f26" stroke="#2a2e38" strokeWidth="1.2" />
      <rect x="138" y="24" width="46" height="5" rx="1.5" fill="#0e7490" />
      <rect x="138" y="34" width="64" height="5" rx="1.5" fill="#3a3f4c" />
      <rect x="144" y="44" width="52" height="5" rx="1.5" fill="#3a3f4c" />
      <rect x="144" y="54" width="60" height="5" rx="1.5" fill="#67e8f9" opacity="0.7" />
      <rect x="138" y="64" width="38" height="5" rx="1.5" fill="#3a3f4c" />
    </svg>
  );
}
