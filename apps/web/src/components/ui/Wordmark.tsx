export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <div className={`u-display flex items-center gap-2 ${className}`}>
      <span className="text-accent font-bold text-lg leading-none">OUR</span>
      <span className="inline-grid place-items-center h-6 w-8 rounded bg-accent text-header font-bold text-base leading-none">
        52
      </span>
    </div>
  );
}
