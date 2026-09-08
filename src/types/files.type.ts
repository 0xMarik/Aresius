export interface ProjectFileSummary {
  id: string;
  projectId: string;
  name: string;
  path: string;
  sizeBytes: number;
  lineCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectFile extends ProjectFileSummary {
  content: string;
}

export interface FilesState {
  filesByProject: Record<string, ProjectFileSummary[]>;
  selectedFileId: string | null;
  selectedFilePreview: string[] | null;
  loading: boolean;
  error: string | null;
}
