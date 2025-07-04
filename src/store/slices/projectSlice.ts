import { Project, WorkspaceState } from '@/types/project.type';
import { createSlice, PayloadAction } from '@reduxjs/toolkit'


const initialState: WorkspaceState = {
    projects: [
      {
        id: crypto.randomUUID(),
        name: "Default Project",
        description: "This is a default project.",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        temporary: false,
      }
    ],
    currentProjectId: null,
}

const projectSlice = createSlice({
  name: "project",
  initialState,
  reducers: {
    setProjects(state, action: PayloadAction<Project[]>) {
      state.projects = action.payload
    },
    addProject(state, action: PayloadAction<Project>) {
      state.projects.push(action.payload)
    },
    updateProject(state, action: PayloadAction<Project>) {
      const index = state.projects.findIndex(p => p.id === action.payload.id)
      if (index !== -1) {
        state.projects[index] = action.payload
      }
    },
    deleteProject(state, action: PayloadAction<string>) {
      state.projects = state.projects.filter(p => p.id !== action.payload)
      if (state.currentProjectId && state.currentProjectId === action.payload) {
        state.currentProjectId = null
      }
    },
    setcurrentProjectId(state, action: PayloadAction<string | null>) {
      if (action.payload === null) {
        state.currentProjectId = null;
      } else {
        const project = state.projects.find(p => p.id === action.payload) || null;
        state.currentProjectId = project ? project.id : null;
      }
    },
  },
})

export const {
  setProjects,
  addProject,
  updateProject,
  deleteProject,
  setcurrentProjectId,
} = projectSlice.actions;

export default projectSlice.reducer;