export function HabitSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading habits…">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="skeleton-row"
          style={{ animationDelay: `${i * 0.15}s` }}
        >
          <div className="skeleton-circle" />
          <div className="skeleton-lines">
            <div className="skeleton-line w-3/4" />
            <div className="skeleton-line w-1/3" />
          </div>
          <div className="skeleton-box" />
        </div>
      ))}
    </div>
  );
}
