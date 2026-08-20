import { createSlice, PayloadAction, createSelector } from '@reduxjs/toolkit';
import type { RootState } from '@/store';
import { deleteProject, resetProjectData } from './projectSlice';
import { MatchReplaceCollection, MatchReplaceRule } from '@/pages/match-replace/types';
import { INITIAL_COLLECTIONS } from '@/pages/match-replace/dummyData';
import { invoke } from '@tauri-apps/api/core';

export interface MatchReplaceProjectState {
    collections: MatchReplaceCollection[];
    selectedCollectionId: string | null;
    selectedRuleId: string | null;
    isLoaded?: boolean;
}

export type MatchReplaceStateByProject = Record<string, MatchReplaceProjectState>;

export const defaultMatchReplaceProjectState = (): MatchReplaceProjectState => ({
    collections: JSON.parse(JSON.stringify(INITIAL_COLLECTIONS)),
    selectedCollectionId: INITIAL_COLLECTIONS[0]?.id || null,
    selectedRuleId: INITIAL_COLLECTIONS[0]?.rules[0]?.id || null,
    isLoaded: false,
});

const initialState: MatchReplaceStateByProject = {};

function getBucket(state: MatchReplaceStateByProject, projectId: string): MatchReplaceProjectState {
    if (!state[projectId]) {
        state[projectId] = defaultMatchReplaceProjectState();
    }
    return state[projectId];
}

async function safeInvoke(cmd: string, args?: Record<string, unknown>) {
    try {
        if (typeof window !== 'undefined') {
            return await invoke(cmd, args);
        }
    } catch (e) {
        console.warn(`Failed to invoke ${cmd}:`, e);
    }
}

const matchReplaceSlice = createSlice({
    name: 'matchReplace',
    initialState,
    reducers: {
        setLoadedMatchReplaceData: (
            state,
            action: PayloadAction<{ projectId: string; collections: MatchReplaceCollection[] }>
        ) => {
            const bucket = getBucket(state, action.payload.projectId);
            bucket.collections = action.payload.collections;
            bucket.isLoaded = true;
            if (!bucket.selectedCollectionId || !bucket.collections.some((c) => c.id === bucket.selectedCollectionId)) {
                bucket.selectedCollectionId = bucket.collections[0]?.id || null;
            }
            const activeCol = bucket.collections.find((c) => c.id === bucket.selectedCollectionId);
            if (!bucket.selectedRuleId || !activeCol?.rules.some((r) => r.id === bucket.selectedRuleId)) {
                bucket.selectedRuleId = activeCol?.rules[0]?.id || null;
            }
        },

        initializeProjectMatchReplace: (state, action: PayloadAction<{ projectId: string }>) => {
            getBucket(state, action.payload.projectId);
        },

        selectMatchReplaceRule: (
            state,
            action: PayloadAction<{ projectId: string; collectionId: string; ruleId: string }>
        ) => {
            const bucket = getBucket(state, action.payload.projectId);
            bucket.selectedCollectionId = action.payload.collectionId;
            bucket.selectedRuleId = action.payload.ruleId;
        },

        toggleMatchReplaceRule: (
            state,
            action: PayloadAction<{ projectId: string; collectionId: string; ruleId: string; enabled: boolean }>
        ) => {
            const bucket = getBucket(state, action.payload.projectId);
            const col = bucket.collections.find((c) => c.id === action.payload.collectionId);
            if (col) {
                const rule = col.rules.find((r) => r.id === action.payload.ruleId);
                if (rule) {
                    rule.enabled = action.payload.enabled;
                    safeInvoke('toggle_match_replace_rule', {
                        projectId: action.payload.projectId,
                        ruleId: action.payload.ruleId,
                        enabled: action.payload.enabled,
                    });
                }
            }
        },

        updateMatchReplaceRule: (
            state,
            action: PayloadAction<{
                projectId: string;
                collectionId: string;
                ruleId: string;
                updated: Partial<MatchReplaceRule>;
            }>
        ) => {
            const bucket = getBucket(state, action.payload.projectId);
            const col = bucket.collections.find((c) => c.id === action.payload.collectionId);
            if (col) {
                const rule = col.rules.find((r) => r.id === action.payload.ruleId);
                if (rule) {
                    Object.assign(rule, action.payload.updated);
                    safeInvoke('save_match_replace_rule', {
                        projectId: action.payload.projectId,
                        collectionId: action.payload.collectionId,
                        rule,
                    });
                }
            }
        },

        createMatchReplaceCollection: (
            state,
            action: PayloadAction<{ projectId: string }>
        ) => {
            const bucket = getBucket(state, action.payload.projectId);
            const newId = `col-${Date.now()}`;
            const name = `New Collection ${bucket.collections.length + 1}`;
            const newCol: MatchReplaceCollection = {
                id: newId,
                name,
                rules: [],
            };
            bucket.collections.push(newCol);
            bucket.selectedCollectionId = newId;
            bucket.selectedRuleId = null;

            safeInvoke('save_match_replace_collection', {
                projectId: action.payload.projectId,
                collectionId: newId,
                name,
            });
        },

        createMatchReplaceRule: (
            state,
            action: PayloadAction<{ projectId: string; collectionId: string }>
        ) => {
            const bucket = getBucket(state, action.payload.projectId);
            const col = bucket.collections.find((c) => c.id === action.payload.collectionId);
            if (col) {
                const newRuleId = `rule-${Date.now()}`;
                const newRule: MatchReplaceRule = {
                    id: newRuleId,
                    name: 'New Match Rule',
                    enabled: false,
                    type: 'request_header',
                    match: '',
                    replace: '',
                    comment: '',
                    isRegex: false,
                    isCaseSensitive: false,
                    onlyInScope: true,
                };
                col.rules.push(newRule);
                bucket.selectedCollectionId = action.payload.collectionId;
                bucket.selectedRuleId = newRuleId;

                safeInvoke('save_match_replace_rule', {
                    projectId: action.payload.projectId,
                    collectionId: action.payload.collectionId,
                    rule: newRule,
                });
            }
        },

        renameMatchReplaceCollection: (
            state,
            action: PayloadAction<{ projectId: string; collectionId: string; newName: string }>
        ) => {
            const bucket = getBucket(state, action.payload.projectId);
            const col = bucket.collections.find((c) => c.id === action.payload.collectionId);
            if (col) {
                col.name = action.payload.newName;
                safeInvoke('save_match_replace_collection', {
                    projectId: action.payload.projectId,
                    collectionId: action.payload.collectionId,
                    name: action.payload.newName,
                });
            }
        },

        renameMatchReplaceRule: (
            state,
            action: PayloadAction<{
                projectId: string;
                collectionId: string;
                ruleId: string;
                newName: string;
            }>
        ) => {
            const bucket = getBucket(state, action.payload.projectId);
            const col = bucket.collections.find((c) => c.id === action.payload.collectionId);
            if (col) {
                const rule = col.rules.find((r) => r.id === action.payload.ruleId);
                if (rule) {
                    rule.name = action.payload.newName;
                    safeInvoke('save_match_replace_rule', {
                        projectId: action.payload.projectId,
                        collectionId: action.payload.collectionId,
                        rule,
                    });
                }
            }
        },

        deleteMatchReplaceCollection: (
            state,
            action: PayloadAction<{ projectId: string; collectionId: string }>
        ) => {
            const bucket = getBucket(state, action.payload.projectId);
            bucket.collections = bucket.collections.filter((c) => c.id !== action.payload.collectionId);
            if (bucket.selectedCollectionId === action.payload.collectionId) {
                bucket.selectedCollectionId = bucket.collections[0]?.id || null;
                bucket.selectedRuleId = bucket.collections[0]?.rules[0]?.id || null;
            }

            safeInvoke('delete_match_replace_collection', {
                projectId: action.payload.projectId,
                collectionId: action.payload.collectionId,
            });
        },

        deleteMatchReplaceRule: (
            state,
            action: PayloadAction<{ projectId: string; collectionId: string; ruleId: string }>
        ) => {
            const bucket = getBucket(state, action.payload.projectId);
            const col = bucket.collections.find((c) => c.id === action.payload.collectionId);
            if (col) {
                col.rules = col.rules.filter((r) => r.id !== action.payload.ruleId);
                if (bucket.selectedRuleId === action.payload.ruleId) {
                    bucket.selectedRuleId = col.rules[0]?.id || null;
                }
            }

            safeInvoke('delete_match_replace_rule', {
                projectId: action.payload.projectId,
                ruleId: action.payload.ruleId,
            });
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(deleteProject, (state, action) => {
                delete state[action.payload];
            })
            .addCase(resetProjectData, (state, action) => {
                state[action.payload] = defaultMatchReplaceProjectState();
            });
    },
});

export const {
    setLoadedMatchReplaceData,
    initializeProjectMatchReplace,
    selectMatchReplaceRule,
    toggleMatchReplaceRule,
    updateMatchReplaceRule,
    createMatchReplaceCollection,
    createMatchReplaceRule,
    renameMatchReplaceCollection,
    renameMatchReplaceRule,
    deleteMatchReplaceCollection,
    deleteMatchReplaceRule,
} = matchReplaceSlice.actions;

export const fetchMatchReplaceDataForProject = (projectId: string) => async (dispatch: any) => {
    if (!projectId) return;
    try {
        const data = (await safeInvoke('get_match_replace', { projectId })) as
            | {
                  collections: MatchReplaceCollection[];
              }
            | undefined;

        if (data && data.collections) {
            dispatch(
                setLoadedMatchReplaceData({
                    projectId,
                    collections: data.collections,
                })
            );
        }
    } catch (err) {
        console.warn('Failed to load match replace data for project:', err);
    }
};

export const selectMatchReplaceState = (projectId: string | null | undefined) =>
    createSelector(
        (state: RootState) => state.matchReplace,
        (matchReplaceState): MatchReplaceProjectState => {
            if (!projectId || !matchReplaceState[projectId]) {
                return defaultMatchReplaceProjectState();
            }
            return matchReplaceState[projectId];
        }
    );

export default matchReplaceSlice.reducer;
