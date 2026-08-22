import * as React from "react"
import { cn } from "@/lib/utils"
import { isMac } from "@/lib/platform"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "bg-muted/60 text-muted-foreground border border-border/50 shadow-2xs pointer-events-none inline-flex h-4 w-fit min-w-4 select-none items-center justify-center rounded-[3px] px-1 font-mono text-[9.5px] font-medium leading-none tracking-tight",
        "[&_svg:not([class*='size-'])]:size-2.5",
        "[[data-slot=tooltip-content]_&]:bg-background/20 [[data-slot=tooltip-content]_&]:text-background dark:[[data-slot=tooltip-content]_&]:bg-background/10",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-0.5 text-muted-foreground/70 text-[9px] font-mono", className)}
      {...props}
    />
  )
}

interface ShortcutProps {
  shortcut: string;
  className?: string;
}

/**
 * Convenience component that renders an OS-adaptive shortcut using KbdGroup + Kbd.
 * Examples:
 *   <Shortcut shortcut="Ctrl+O" />  => <KbdGroup><Kbd>Ctrl</Kbd><span>+</span><Kbd>O</Kbd></KbdGroup> (Windows/Linux)
 *                                   => <KbdGroup><Kbd>⌘</Kbd><Kbd>O</Kbd></KbdGroup> (macOS)
 */
function Shortcut({ shortcut, className }: ShortcutProps) {
  if (!shortcut) return null;

  if (shortcut === "F11") {
    return (
      <KbdGroup className={className}>
        <Kbd>F11</Kbd>
      </KbdGroup>
    );
  }

  if (shortcut.startsWith("Ctrl+") || shortcut.startsWith("Cmd+") || shortcut.startsWith("⌘")) {
    const key = shortcut.startsWith("Ctrl+")
      ? shortcut.slice(5)
      : shortcut.startsWith("Cmd+")
      ? shortcut.slice(4)
      : shortcut.slice(1);

    if (isMac) {
      return (
        <KbdGroup className={className}>
          <Kbd>⌘</Kbd>
          <Kbd>{key}</Kbd>
        </KbdGroup>
      );
    }

    return (
      <KbdGroup className={className}>
        <Kbd>Ctrl</Kbd>
        <span>+</span>
        <Kbd>{key}</Kbd>
      </KbdGroup>
    );
  }

  return (
    <KbdGroup className={className}>
      <Kbd>{shortcut}</Kbd>
    </KbdGroup>
  );
}

export { Kbd, KbdGroup, Shortcut }
