import { createSlice, createSelector, PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/store';
import { deleteProject } from './projectSlice';

// ─── Data types ────────────────────────────────────────────────────────────────

export interface ScopeRule {
    id: string;
    pattern: string;
}

export interface Scope {
    id: string;
    name: string;
    color: string;
    allow: ScopeRule[];
    deny: ScopeRule[];
}

interface ScopeState {
    scopes: Scope[];
    activeScopeId: string | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const SCOPE_COLORS = [
    '#6366f1', '#10b981', '#f59e0b', '#ef4444',
    '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16',
];

const defaultScopeState = (): ScopeState => ({
    scopes: [],
    activeScopeId: null,
});

// ─── Per-project map ────────────────────────────────────────────────────────────

type ScopeByProject = Record<string, ScopeState>

const initialState: ScopeByProject = {}

// ─── Helper to get or create a project bucket ──────────────────────────────────

function getBucket(state: ScopeByProject, projectId: string): ScopeState {
    if (!state[projectId]) state[projectId] = defaultScopeState();
    return state[projectId];
}

// ─── Slice ─────────────────────────────────────────────────────────────────────

const scopeSlice = createSlice({
    name: 'scope',
    initialState,
    reducers: {
        createScope: (state, action: PayloadAction<{ name: string; projectId: string }>) => {
            const bucket = getBucket(state, action.payload.projectId);
            const colorIndex = bucket.scopes.length % SCOPE_COLORS.length;
            bucket.scopes.push({
                id: generateId(),
                name: action.payload.name,
                color: SCOPE_COLORS[colorIndex],
                allow: [],
                deny: [],
            });
        },

        deleteScope: (state, action: PayloadAction<{ id: string; projectId: string }>) => {
            const bucket = getBucket(state, action.payload.projectId);
            bucket.scopes = bucket.scopes.filter((s) => s.id !== action.payload.id);
            if (bucket.activeScopeId === action.payload.id) bucket.activeScopeId = null;
        },

        renameScope: (state, action: PayloadAction<{ id: string; name: string; projectId: string }>) => {
            const scope = getBucket(state, action.payload.projectId).scopes.find((s) => s.id === action.payload.id);
            if (scope) scope.name = action.payload.name;
        },

        setScopeColor: (state, action: PayloadAction<{ id: string; color: string; projectId: string }>) => {
            const scope = getBucket(state, action.payload.projectId).scopes.find((s) => s.id === action.payload.id);
            if (scope) scope.color = action.payload.color;
        },

        setActiveScope: (state, action: PayloadAction<{ scopeId: string | null; projectId: string }>) => {
            const bucket = getBucket(state, action.payload.projectId);
            bucket.activeScopeId = action.payload.scopeId;
        },

        addRule: (
            state,
            action: PayloadAction<{ scopeId: string; list: 'allow' | 'deny'; pattern: string; projectId: string }>
        ) => {
            const scope = getBucket(state, action.payload.projectId).scopes.find((s) => s.id === action.payload.scopeId);
            if (!scope) return;
            scope[action.payload.list].push({ id: generateId(), pattern: action.payload.pattern.trim() });
        },

        removeRule: (
            state,
            action: PayloadAction<{ scopeId: string; list: 'allow' | 'deny'; ruleId: string; projectId: string }>
        ) => {
            const scope = getBucket(state, action.payload.projectId).scopes.find((s) => s.id === action.payload.scopeId);
            if (!scope) return;
            scope[action.payload.list] = scope[action.payload.list].filter((r) => r.id !== action.payload.ruleId);
        },

        updateRule: (
            state,
            action: PayloadAction<{ scopeId: string; list: 'allow' | 'deny'; ruleId: string; pattern: string; projectId: string }>
        ) => {
            const scope = getBucket(state, action.payload.projectId).scopes.find((s) => s.id === action.payload.scopeId);
            if (!scope) return;
            const rule = scope[action.payload.list].find((r) => r.id === action.payload.ruleId);
            if (rule) rule.pattern = action.payload.pattern.trim();
        },

        importScopeRules: (
            state,
            action: PayloadAction<{
                projectId: string;
                scopeId?: string | null;
                scopeName?: string;
                include: { id?: string; pattern: string }[];
                exclude: { id?: string; pattern: string }[];
                mode: 'merge' | 'replace' | 'create';
            }>
        ) => {
            const bucket = getBucket(state, action.payload.projectId);
            const { scopeId, scopeName, include, exclude, mode } = action.payload;

            const mapRules = (rules: { id?: string; pattern: string }[]): ScopeRule[] =>
                rules
                    .map((r) => ({
                        id: r.id || generateId(),
                        pattern: r.pattern.trim(),
                    }))
                    .filter((r) => r.pattern.length > 0);

            if (mode === 'create' || !scopeId || !bucket.scopes.some((s) => s.id === scopeId)) {
                const colorIndex = bucket.scopes.length % SCOPE_COLORS.length;
                const newScopeId = generateId();
                const newScope: Scope = {
                    id: newScopeId,
                    name: scopeName || `Imported Scope ${bucket.scopes.length + 1}`,
                    color: SCOPE_COLORS[colorIndex],
                    allow: mapRules(include),
                    deny: mapRules(exclude),
                };
                bucket.scopes.push(newScope);
                if (bucket.activeScopeId === null) {
                    bucket.activeScopeId = newScopeId;
                }
                return;
            }

            const targetScope = bucket.scopes.find((s) => s.id === scopeId);
            if (!targetScope) return;

            const newAllow = mapRules(include);
            const newDeny = mapRules(exclude);

            if (mode === 'replace') {
                targetScope.allow = newAllow;
                targetScope.deny = newDeny;
            } else if (mode === 'merge') {
                const existingAllowPatterns = new Set(targetScope.allow.map((r) => r.pattern));
                for (const rule of newAllow) {
                    if (!existingAllowPatterns.has(rule.pattern)) {
                        targetScope.allow.push(rule);
                        existingAllowPatterns.add(rule.pattern);
                    }
                }

                const existingDenyPatterns = new Set(targetScope.deny.map((r) => r.pattern));
                for (const rule of newDeny) {
                    if (!existingDenyPatterns.has(rule.pattern)) {
                        targetScope.deny.push(rule);
                        existingDenyPatterns.add(rule.pattern);
                    }
                }
            }
        },
    },
    extraReducers: (builder) => {
        builder.addCase(deleteProject, (state, action) => {
            delete state[action.payload];
        });
    },
});

// ─── Actions ───────────────────────────────────────────────────────────────────

export const {
    createScope,
    deleteScope,
    renameScope,
    setScopeColor,
    setActiveScope,
    addRule,
    removeRule,
    updateRule,
    importScopeRules,
} = scopeSlice.actions;

// ─── Selectors ─────────────────────────────────────────────────────────────────

const EMPTY_SCOPES: Scope[] = [];

const allScopesSelectorsCache = new Map<string | null, (state: RootState) => Scope[]>();
const activeScopeIdSelectorsCache = new Map<string | null, (state: RootState) => string | null>();
const activeScopeSelectorsCache = new Map<string | null, (state: RootState) => Scope | null>();

export const selectAllScopes = (projectId: string | null) => {
    if (!allScopesSelectorsCache.has(projectId)) {
        allScopesSelectorsCache.set(
            projectId,
            (state: RootState): Scope[] =>
                projectId && state.scope[projectId]?.scopes ? state.scope[projectId].scopes : EMPTY_SCOPES
        );
    }
    return allScopesSelectorsCache.get(projectId)!;
};

export const selectActiveScopeId = (projectId: string | null) => {
    if (!activeScopeIdSelectorsCache.has(projectId)) {
        activeScopeIdSelectorsCache.set(
            projectId,
            (state: RootState): string | null =>
                projectId && state.scope[projectId] ? state.scope[projectId].activeScopeId : null
        );
    }
    return activeScopeIdSelectorsCache.get(projectId)!;
};

export const selectActiveScope = (projectId: string | null) => {
    if (!activeScopeSelectorsCache.has(projectId)) {
        activeScopeSelectorsCache.set(
            projectId,
            createSelector(
                [(state: RootState) => (projectId ? state.scope[projectId] : undefined)],
                (bucket) => {
                    if (!bucket || !bucket.activeScopeId) return null;
                    return bucket.scopes.find((s) => s.id === bucket.activeScopeId) ?? null;
                }
            )
        );
    }
    return activeScopeSelectorsCache.get(projectId)!;
};

export default scopeSlice.reducer;
