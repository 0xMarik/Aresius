import * as Diff from 'diff';

/**
 * Applies a unified diff delta patch to a base string.
 * Returns the patched string, or the base string if the patch is null/empty or application fails.
 */
export function applyDeltaPatch(base: string, patch?: string | null): string {
    if (!patch || !base) return base;
    try {
        const result = Diff.applyPatch(base, patch);
        if (typeof result === 'string') {
            return result;
        }
        return base;
    } catch (err) {
        console.warn('Failed to apply delta patch:', err);
        return base;
    }
}
