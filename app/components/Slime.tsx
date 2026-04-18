type Props = {
  size?: number;
  className?: string;
  tone?: "light" | "dim";
};

export default function Slime({
  size = 28,
  className = "",
  tone = "light",
}: Props) {
  const body = tone === "light" ? "#e5e7eb" : "#52525b";
  const stroke = tone === "light" ? "#27272a" : "#18181b";
  const shine = tone === "light" ? "#ffffff" : "#a1a1aa";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden
    >
      <ellipse cx="32" cy="58" rx="18" ry="2.5" fill="#000" opacity="0.5" />
      <path
        d="M 12 52 C 12 22, 52 22, 52 52 Z"
        fill={body}
        stroke={stroke}
        strokeWidth="1.5"
      />
      <path
        d="M 16 44 C 18 28, 28 24, 34 24"
        stroke={shine}
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
        opacity="0.7"
      />
      <ellipse cx="24" cy="38" rx="3" ry="4" fill="#fff" />
      <ellipse cx="40" cy="38" rx="3" ry="4" fill="#fff" />
      <circle cx="24.5" cy="39" r="1.6" fill="#111827" />
      <circle cx="40.5" cy="39" r="1.6" fill="#111827" />
      <path
        d="M 28 46 Q 32 49 36 46"
        stroke="#111827"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
