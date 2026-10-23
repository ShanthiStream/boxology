export function Wordmark() {
  return (
    <div className="flex items-center gap-3">
      {/* Same mark as public/icon.svg: hollow input, elbow, filled output. */}
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="text-accent"
      >
        <rect x="3.5" y="4.5" width="8" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
        <rect
          x="12.5"
          y="14"
          width="8"
          height="5.5"
          rx="1.5"
          stroke="currentColor"
          strokeWidth="1.4"
          fill="currentColor"
        />
        <path
          d="M7.5 10v2.5h9V14"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="font-serif text-[23px] italic leading-none tracking-tightest text-text">
        Boxology
      </span>
    </div>
  );
}
