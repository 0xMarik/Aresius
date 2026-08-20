import { useMemo, useEffect } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { MatchReplaceTree } from './MatchReplaceTree';
import { RuleEditorPane } from './RuleEditorPane';
import { RuleTesterPane } from './RuleTesterPane';
import { MatchReplaceRule } from './types';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import {
    selectMatchReplaceState,
    selectMatchReplaceRule,
    toggleMatchReplaceRule,
    updateMatchReplaceRule,
    createMatchReplaceCollection,
    createMatchReplaceRule,
    renameMatchReplaceCollection,
    renameMatchReplaceRule,
    deleteMatchReplaceCollection,
    deleteMatchReplaceRule,
    fetchMatchReplaceDataForProject,
} from '@/store/slices/matchReplaceSlice';

export default function MatchAndReplacePage() {
    const projectId = useProjectId();
    const dispatch = useAppDispatch();
    const matchState = useAppSelector(selectMatchReplaceState(projectId));

    useEffect(() => {
        if (projectId && !matchState.isLoaded) {
            dispatch(fetchMatchReplaceDataForProject(projectId) as any);
        }
    }, [projectId, matchState.isLoaded, dispatch]);

    const collections = matchState.collections;
    const selectedCollectionId = matchState.selectedCollectionId;
    const selectedRuleId = matchState.selectedRuleId;

    // Find currently selected rule and its parent collection
    const selectedCollection = useMemo(() => {
        return collections.find((c) => c.id === selectedCollectionId) || null;
    }, [collections, selectedCollectionId]);

    const selectedRule = useMemo(() => {
        if (!selectedCollection) return null;
        return selectedCollection.rules.find((r) => r.id === selectedRuleId) || null;
    }, [selectedCollection, selectedRuleId]);

    // Flat list of all rules across all collections
    const allRules = useMemo(() => {
        return collections.flatMap((c) => c.rules);
    }, [collections]);

    // Handlers mapped to Redux actions
    const handleSelectRule = (colId: string, ruleId: string) => {
        if (!projectId) return;
        dispatch(selectMatchReplaceRule({ projectId, collectionId: colId, ruleId }));
    };

    const handleToggleRule = (colId: string, ruleId: string, enabled: boolean) => {
        if (!projectId) return;
        dispatch(toggleMatchReplaceRule({ projectId, collectionId: colId, ruleId, enabled }));
    };

    const handleUpdateRule = (updated: Partial<MatchReplaceRule>) => {
        if (!projectId || !selectedCollectionId || !selectedRuleId) return;
        dispatch(
            updateMatchReplaceRule({
                projectId,
                collectionId: selectedCollectionId,
                ruleId: selectedRuleId,
                updated,
            })
        );
    };

    const handleCreateCollection = () => {
        if (!projectId) return;
        dispatch(createMatchReplaceCollection({ projectId }));
    };

    const handleCreateRule = (colId: string) => {
        if (!projectId) return;
        dispatch(createMatchReplaceRule({ projectId, collectionId: colId }));
    };

    const handleRenameCollection = (colId: string, newName: string) => {
        if (!projectId) return;
        dispatch(renameMatchReplaceCollection({ projectId, collectionId: colId, newName }));
    };

    const handleRenameRule = (colId: string, ruleId: string, newName: string) => {
        if (!projectId) return;
        dispatch(renameMatchReplaceRule({ projectId, collectionId: colId, ruleId, newName }));
    };

    const handleDeleteCollection = (colId: string) => {
        if (!projectId) return;
        dispatch(deleteMatchReplaceCollection({ projectId, collectionId: colId }));
    };

    const handleDeleteRule = (colId: string, ruleId: string) => {
        if (!projectId) return;
        dispatch(deleteMatchReplaceRule({ projectId, collectionId: colId, ruleId }));
    };

    return (
        <ResizablePanelGroup direction="horizontal" autoSaveId="aresius-match-replace-layout">
            {/* Left Column: Collection & Rules Hierarchy Tree */}
            <ResizablePanel defaultSize={18} minSize={13} maxSize={45}>
                <MatchReplaceTree
                    collections={collections}
                    selectedCollectionId={selectedCollectionId}
                    selectedRuleId={selectedRuleId}
                    onSelectRule={handleSelectRule}
                    onToggleRule={handleToggleRule}
                    onCreateCollection={handleCreateCollection}
                    onCreateRule={handleCreateRule}
                    onRenameCollection={handleRenameCollection}
                    onRenameRule={handleRenameRule}
                    onDeleteCollection={handleDeleteCollection}
                    onDeleteRule={handleDeleteRule}
                />
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Right Column: Configuration (Top) & Tester (Bottom) */}
            <ResizablePanel defaultSize={82} minSize={30}>
                <ResizablePanelGroup direction="vertical" autoSaveId="aresius-match-replace-right-pane">
                    {/* Upper Right Section: Rule Configuration Form */}
                    <ResizablePanel defaultSize={42} minSize={25}>
                        <RuleEditorPane
                            rule={selectedRule}
                            collectionName={selectedCollection?.name}
                            onUpdateRule={handleUpdateRule}
                        />
                    </ResizablePanel>

                    <ResizableHandle withHandle />

                    {/* Bottom Right Section: Tester with Before/After Editors */}
                    <ResizablePanel defaultSize={58} minSize={25}>
                        <RuleTesterPane
                            activeRule={selectedRule}
                            allRules={allRules}
                        />
                    </ResizablePanel>
                </ResizablePanelGroup>
            </ResizablePanel>
        </ResizablePanelGroup>
    );
}
