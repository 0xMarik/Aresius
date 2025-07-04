import { Project, WorkspaceState } from '@/types/project.type';
import { createSlice, PayloadAction } from '@reduxjs/toolkit'



const initialState: WorkspaceState = {
    projects: [],
    currentProject: null,
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
      if (state.currentProject && state.currentProject.id === action.payload) {
        state.currentProject = null
      }
    },
    setCurrentProject(state, action: PayloadAction<string | null>) {
      if (action.payload === null) {
        state.currentProject = null;
      } else {
        const project = state.projects.find(p => p.id === action.payload) || null;
        state.currentProject = project;
      }
    },
  },
})

export default projectSlice.reducer;