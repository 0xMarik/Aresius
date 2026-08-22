/**
 * Operating system detection and keyboard shortcut formatting utilities.
 */

export const isMac =
  typeof window !== "undefined" &&
  ((navigator as any)?.userAgentData?.platform === "macOS" ||
    /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent));

export const isWindows =
  typeof window !== "undefined" &&
  ((navigator as any)?.userAgentData?.platform === "Windows" ||
    /Win/.test(navigator.platform || navigator.userAgent));

export const isLinux =
  typeof window !== "undefined" &&
  !isMac &&
  !isWindows &&
  /Linux/.test(navigator.platform || navigator.userAgent);

/**
 * Primary modifier key symbol/prefix (⌘ on macOS, Ctrl+ on Windows/Linux).
 */
export const modKey = isMac ? "⌘" : "Ctrl+";

/**
 * Primary modifier key name (Cmd on macOS, Ctrl on Windows/Linux).
 */
export const modKeyName = isMac ? "Cmd" : "Ctrl";

/**
 * Format a keyboard shortcut for display based on the detected OS.
 * Examples:
 *   formatShortcut("O")   => "⌘O" (macOS) or "Ctrl+O" (Windows/Linux)
 *   formatShortcut("+")   => "⌘+" (macOS) or "Ctrl++" (Windows/Linux)
 *   formatShortcut("-")   => "⌘-" (macOS) or "Ctrl+-" (Windows/Linux)
 *   formatShortcut("0")   => "⌘0" (macOS) or "Ctrl+0" (Windows/Linux)
 */
export function formatShortcut(key: string): string {
  if (isMac) {
    return `⌘${key}`;
  }
  return `Ctrl+${key}`;
}
