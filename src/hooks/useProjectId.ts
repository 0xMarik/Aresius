/**
 * Hook that returns the current project ID from the Redux store.
 * Used by feature slices' selectors to scope data per project.
 */
import { useAppSelector } from './redux'

export const useProjectId = () =>
  useAppSelector((s) => s.workspacestate.currentProjectId)
