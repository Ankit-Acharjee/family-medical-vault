import { useId } from 'react';

/** Decorative artwork for the overview empty state. */
export function MedicalDocumentArt() {
  const id = useId();
  const backGradient = `${id}-back`;
  const frontGradient = `${id}-front`;
  const orbitGradient = `${id}-orbit`;
  const glow = `${id}-glow`;

  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 280 280" fill="none">
      <defs>
        <linearGradient
          id={backGradient}
          x1="70"
          y1="45"
          x2="199"
          y2="220"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="var(--fmv-focus)" stopOpacity=".8" />
          <stop offset=".52" stopColor="var(--fmv-primary)" stopOpacity=".52" />
          <stop
            offset="1"
            stopColor="var(--fmv-primary-strong)"
            stopOpacity=".6"
          />
        </linearGradient>
        <linearGradient
          id={frontGradient}
          x1="103"
          y1="50"
          x2="192"
          y2="224"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="var(--fmv-primary)" stopOpacity=".45" />
          <stop offset=".49" stopColor="var(--fmv-surface)" stopOpacity=".96" />
          <stop offset="1" stopColor="var(--fmv-primary)" stopOpacity=".35" />
        </linearGradient>
        <linearGradient
          id={orbitGradient}
          x1="28"
          y1="203"
          x2="254"
          y2="151"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="var(--fmv-primary)" stopOpacity="0" />
          <stop offset=".24" stopColor="var(--fmv-primary)" stopOpacity=".6" />
          <stop offset=".69" stopColor="var(--fmv-focus)" stopOpacity=".95" />
          <stop offset="1" stopColor="var(--fmv-primary)" stopOpacity="0" />
        </linearGradient>
        <filter id={glow} x="-30%" y="-50%" width="160%" height="200%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <g transform="rotate(-14 130 131)">
        <rect
          x="70"
          y="43"
          width="128"
          height="169"
          rx="14"
          fill={`url(#${backGradient})`}
          stroke="var(--fmv-focus)"
          strokeOpacity=".7"
        />
      </g>
      <g transform="rotate(8 150 139)">
        <path
          d="M96 58a12 12 0 0 1 12-12h74l31 31v126a12 12 0 0 1-12 12h-93a12 12 0 0 1-12-12V58Z"
          fill={`url(#${frontGradient})`}
          stroke="var(--fmv-focus)"
          strokeOpacity=".9"
          style={{ strokeWidth: 2 }}
        />
        <path
          d="M182 47v20a10 10 0 0 0 10 10h20"
          fill="var(--fmv-primary-soft)"
          fillOpacity=".65"
          stroke="var(--fmv-focus)"
          strokeOpacity=".8"
          style={{ strokeWidth: 2 }}
          strokeLinejoin="round"
        />
        <rect
          x="125"
          y="87"
          width="59"
          height="59"
          rx="15"
          fill="var(--fmv-primary-soft)"
          fillOpacity=".55"
          stroke="var(--fmv-primary)"
          strokeOpacity=".55"
          style={{ strokeWidth: 2 }}
        />
        <path
          d="M149 99h11v12h12v11h-12v12h-11v-12h-12v-11h12V99Z"
          stroke="var(--fmv-primary)"
          style={{ strokeWidth: 3 }}
          strokeLinejoin="round"
        />
        <path
          d="M119 166h70M119 179h70M119 192h48"
          stroke="var(--fmv-primary-strong)"
          strokeOpacity=".48"
          style={{ strokeWidth: 5 }}
          strokeLinecap="round"
        />
      </g>
      <path
        d="M29 200c17 23 80 21 142 3 49-15 78-34 81-49"
        stroke={`url(#${orbitGradient})`}
        style={{ strokeWidth: 9 }}
        strokeLinecap="round"
        opacity=".45"
        filter={`url(#${glow})`}
      />
      <path
        d="M29 200c17 23 80 21 142 3 49-15 78-34 81-49"
        stroke={`url(#${orbitGradient})`}
        style={{ strokeWidth: 3 }}
        strokeLinecap="round"
      />
    </svg>
  );
}
