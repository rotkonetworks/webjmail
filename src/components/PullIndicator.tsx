// Refresh indicator that fills/rotates as the user pulls, snaps to an "armed"
// look once past the threshold, then spins while refreshing.
export function PullIndicator({
  pull,
  refreshing,
  threshold,
  armed,
}: {
  pull: number
  refreshing: boolean
  threshold: number
  armed?: boolean
}) {
  if (pull <= 0 && !refreshing) return null
  const progress = Math.min(pull / threshold, 1)
  const isArmed = armed ?? pull >= threshold
  return (
    <div
      className="flex items-center justify-center overflow-hidden transition-colors"
      style={{
        height: refreshing ? 40 : pull,
        color: isArmed || refreshing ? 'var(--primary-color)' : 'var(--text-tertiary)',
      }}
    >
      <div
        className={`i-lucide:refresh-cw text-lg ${refreshing ? 'animate-spin' : ''}`}
        style={
          refreshing
            ? undefined
            : {
                transform: `rotate(${progress * 270}deg) scale(${0.7 + progress * 0.3})`,
                opacity: 0.3 + progress * 0.7,
              }
        }
      />
    </div>
  )
}
