/**
 * RunningDot — animated glowing emerald dot used to indicate an active fuzz run.
 * Shared between the sidebar nav items and the fuzzer session tree.
 */

interface RunningDotProps {
  title?: string
  className?: string
}

export function RunningDot({ title = "Fuzz running", className = "" }: RunningDotProps) {
  return (
    <span
      className={`relative h-2 w-2 shrink-0 rounded-full ${className}`}
      title={title}
    >
      <span className="animate-ping absolute inset-0 rounded-full bg-emerald-400 opacity-75" />
      <span className="absolute inset-0 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
    </span>
  )
}
