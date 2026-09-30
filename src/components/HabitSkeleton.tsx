export function HabitSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading habits…">
      {Array.from({ length: count }, (_, i) => {
        // The shimmer lives on the blocks, not on the row (see globals.css),
        // so the stagger has to be applied to each block rather than inherited.
        const delay = { animationDelay: `${i * 0.15}s` };
        return (
          <div key={i} className="skeleton-row">
            <div className="skeleton-circle" style={delay} />
            <div className="skeleton-lines">
              <div className="skeleton-line w-3/4" style={delay} />
              <div className="skeleton-line w-1/3" style={delay} />
            </div>
            <div className="skeleton-box" style={delay} />
          </div>
        );
      })}
    </div>
  );
}
