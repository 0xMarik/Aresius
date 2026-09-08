import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import {
  selectAllProjectFiles,
  selectSelectedProjectFile,
  selectProjectFilesState,
  fetchProjectFiles,
  importProjectFile,
  deleteProjectFile,
  renameProjectFile,
  loadProjectFilePreview,
  setSelectedFileId,
} from '@/store/slices/filesSlice';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  FolderArchive,
  Upload,
  Plus,
  Trash2,
  Edit2,
  Copy,
  Check,
  Search,
  FileText,
  FileCode,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export const FilesPage: React.FC = () => {
  const dispatch = useAppDispatch();
  const projectId = useProjectId();

  const files = useAppSelector(selectAllProjectFiles(projectId));
  const selectedFile = useAppSelector(selectSelectedProjectFile(projectId));
  const filesState = useAppSelector(selectProjectFilesState(projectId));
  const previewLines = filesState.previewLines;

  const [searchQuery, setSearchQuery] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [copied, setCopied] = useState(false);

  // New File Modal State
  const [isNewFileOpen, setIsNewFileOpen] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileContent, setNewFileContent] = useState('');

  // Rename Dialog State
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load files on mount or projectId change
  useEffect(() => {
    if (projectId) {
      dispatch(fetchProjectFiles(projectId));
    }
  }, [projectId, dispatch]);

  // Load preview when selected file changes
  useEffect(() => {
    if (projectId && selectedFile?.id) {
      dispatch(loadProjectFilePreview({ fileId: selectedFile.id, projectId, limit: 1000 }));
    }
  }, [projectId, selectedFile?.id, dispatch]);

  // Filtered files
  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return files;
    const q = searchQuery.toLowerCase();
    return files.filter(
      (f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
    );
  }, [files, searchQuery]);

  // File Upload Handlers
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = event.target.files;
    if (!uploadedFiles || uploadedFiles.length === 0 || !projectId) return;

    for (let i = 0; i < uploadedFiles.length; i++) {
      const file = uploadedFiles[i];
      try {
        const text = await file.text();
        await dispatch(
          importProjectFile({
            projectId,
            name: file.name,
            content: text,
            path: (file as any).path || '',
          })
        ).unwrap();
        toast.success(`Imported ${file.name}`);
      } catch (err: any) {
        toast.error(`Failed to import ${file.name}: ${err}`);
      }
    }
    event.target.value = '';
  };

  // Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (!projectId) return;

    const droppedFiles = e.dataTransfer.files;
    if (!droppedFiles || droppedFiles.length === 0) return;

    for (let i = 0; i < droppedFiles.length; i++) {
      const file = droppedFiles[i];
      try {
        const text = await file.text();
        await dispatch(
          importProjectFile({
            projectId,
            name: file.name,
            content: text,
            path: (file as any).path || '',
          })
        ).unwrap();
        toast.success(`Imported ${file.name}`);
      } catch (err: any) {
        toast.error(`Failed to import ${file.name}: ${err}`);
      }
    }
  };

  const handleCreateNewFile = async () => {
    if (!projectId || !newFileName.trim()) return;
    try {
      await dispatch(
        importProjectFile({
          projectId,
          name: newFileName.trim(),
          content: newFileContent,
        })
      ).unwrap();
      toast.success(`Created file ${newFileName.trim()}`);
      setIsNewFileOpen(false);
      setNewFileName('');
      setNewFileContent('');
    } catch (err: any) {
      toast.error(`Failed to create file: ${err}`);
    }
  };

  const handleDeleteFile = async (fileId: string, fileName: string) => {
    if (!projectId) return;
    try {
      await dispatch(deleteProjectFile({ fileId, projectId })).unwrap();
      toast.success(`Deleted ${fileName}`);
    } catch (err: any) {
      toast.error(`Failed to delete file: ${err}`);
    }
  };

  const handleRenameSubmit = async () => {
    if (!projectId || !renameTarget || !renameValue.trim()) return;
    try {
      await dispatch(
        renameProjectFile({
          fileId: renameTarget.id,
          newName: renameValue.trim(),
          projectId,
        })
      ).unwrap();
      toast.success(`Renamed to ${renameValue.trim()}`);
      setRenameTarget(null);
      setRenameValue('');
    } catch (err: any) {
      toast.error(`Failed to rename: ${err}`);
    }
  };

  const handleCopyPreview = () => {
    if (previewLines.length > 0) {
      navigator.clipboard.writeText(previewLines.join('\n'));
      setCopied(true);
      toast.success('Preview lines copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (timestamp: number): string => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden">
      {/* Hidden file input for file selection */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        multiple
        className="hidden"
      />

      {/* Top Header Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-card shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-md bg-primary/10 text-primary">
            <FolderArchive className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-foreground">Files</h1>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {files.length} {files.length === 1 ? 'file' : 'files'}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Import and manage wordlists and payload files for fuzzer attacks
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsNewFileOpen(true)}
            className="h-8 text-xs gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New File</span>
          </Button>

          <Button
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="h-8 text-xs gap-1.5 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import File</span>
          </Button>
        </div>
      </div>

      {/* Main Content: Resizable Master-Detail Panels */}
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction="horizontal" className="h-full w-full">
          {/* Left Panel: File List */}
          <ResizablePanel defaultSize={35} minSize={25} maxSize={50}>
            <div
              className={cn(
                "flex flex-col orientation-horizontal h-full border-r bg-muted/10 transition-colors",
                isDragging && "bg-primary/5 border-dashed border-primary"
              )}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {/* Search Bar */}
              <div className="p-2 border-b bg-background/50">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Filter files by name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 pl-8 text-xs bg-background"
                  />
                </div>
              </div>

              {/* Files Table / List */}
              <div className="flex-1 overflow-auto p-2 space-y-1">
                {filteredFiles.length === 0 ? (
                  <EmptyState
                    icon={FolderArchive}
                    title={searchQuery ? "No matching files" : "No files imported yet"}
                    description={
                      searchQuery
                        ? "Try searching for a different file name."
                        : "Drag & drop wordlists (.txt, .csv) here, or click Import File."
                    }
                    action={
                      !searchQuery && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => fileInputRef.current?.click()}
                          className="text-xs gap-1.5"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>Import File</span>
                        </Button>
                      )
                    }
                  />
                ) : (
                  filteredFiles.map((file) => {
                    const isSelected = selectedFile?.id === file.id;
                    return (
                      <div
                        key={file.id}
                        onClick={() =>
                          projectId &&
                          dispatch(setSelectedFileId({ projectId, fileId: file.id }))
                        }
                        className={cn(
                          "group flex items-center justify-between p-2.5 rounded-lg border text-xs cursor-pointer transition-all",
                          isSelected
                            ? "bg-accent/80 border-primary/40 shadow-xs"
                            : "bg-card hover:bg-muted/50 border-border/70"
                        )}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 pr-2">
                          <div
                            className={cn(
                              "p-1.5 rounded shrink-0",
                              isSelected
                                ? "bg-primary/20 text-primary"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            <FileText className="w-4 h-4" />
                          </div>

                          <div className="min-w-0">
                            <div className="font-medium text-foreground truncate select-none">
                              {file.name}
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                              <span className="font-mono">
                                {file.lineCount.toLocaleString()} lines
                              </span>
                              <span>•</span>
                              <span>{formatBytes(file.sizeBytes)}</span>
                              <span>•</span>
                              <span>{formatDate(file.createdAt)}</span>
                            </div>
                          </div>
                        </div>

                        {/* Quick Action Icons */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenameTarget({ id: file.id, name: file.name });
                              setRenameValue(file.name);
                            }}
                            className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground cursor-pointer"
                            title="Rename"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteFile(file.id, file.name);
                            }}
                            className="p-1 hover:bg-destructive/10 rounded text-muted-foreground hover:text-destructive cursor-pointer"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle />

          {/* Right Panel: File Preview & Content Inspector */}
          <ResizablePanel defaultSize={65}>
            {selectedFile ? (
              <div className="flex flex-col h-full bg-background">
                {/* Header Bar */}
                <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/20 shrink-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileCode className="w-4 h-4 text-primary shrink-0" />
                    <span className="font-semibold text-xs text-foreground truncate font-mono">
                      {selectedFile.name}
                    </span>
                    <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 shrink-0">
                      {selectedFile.lineCount.toLocaleString()} lines
                    </Badge>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                      {formatBytes(selectedFile.sizeBytes)}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleCopyPreview}
                      className="h-7 text-xs gap-1.5 cursor-pointer"
                    >
                      {copied ? (
                        <Check className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copied ? 'Copied' : 'Copy Preview'}</span>
                    </Button>

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeleteFile(selectedFile.id, selectedFile.name)}
                      className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Content Viewer with Line Numbers */}
                <div className="flex-1 overflow-auto font-mono text-xs p-2 bg-card select-text">
                  {previewLines.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                      File is empty
                    </div>
                  ) : (
                    <div className="table w-full border-collapse">
                      {previewLines.map((line, idx) => (
                        <div
                          key={idx}
                          className="table-row hover:bg-muted/40 group leading-relaxed"
                        >
                          <span className="table-cell pr-4 select-none text-muted-foreground/40 text-right w-12 group-hover:text-muted-foreground/80 font-mono text-[11px]">
                            {idx + 1}
                          </span>
                          <span className="table-cell text-foreground whitespace-pre-wrap break-all">
                            {line}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer info banner */}
                <div className="px-3 py-1.5 border-t bg-muted/20 text-[10px] text-muted-foreground flex items-center justify-between shrink-0 font-mono">
                  <span>
                    Showing {Math.min(previewLines.length, 1000)} of {selectedFile.lineCount.toLocaleString()} lines
                  </span>
                  <span>{selectedFile.path ? `Source: ${selectedFile.path}` : 'Imported content'}</span>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={FileText}
                title="No file selected"
                description="Select a file from the list to preview its wordlist entries and metadata."
              />
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Modal: New Blank File */}
      <Dialog open={isNewFileOpen} onOpenChange={setIsNewFileOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Create New Wordlist File</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="newFileName" className="text-xs">File Name</Label>
              <Input
                id="newFileName"
                placeholder="e.g. custom_payloads.txt"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                className="text-xs h-8"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="newFileContent" className="text-xs">Initial Content (One payload per line)</Label>
              <Textarea
                id="newFileContent"
                placeholder="admin&#10;guest&#10;root"
                value={newFileContent}
                onChange={(e) => setNewFileContent(e.target.value)}
                rows={6}
                className="font-mono text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsNewFileOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!newFileName.trim()}
              onClick={handleCreateNewFile}
              className="text-xs"
            >
              Create File
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Rename File */}
      <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Rename File</DialogTitle>
          </DialogHeader>

          <div className="py-2">
            <Label htmlFor="renameInput" className="text-xs">File Name</Label>
            <Input
              id="renameInput"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="text-xs h-8 mt-1"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRenameTarget(null)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!renameValue.trim()}
              onClick={handleRenameSubmit}
              className="text-xs"
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FilesPage;
