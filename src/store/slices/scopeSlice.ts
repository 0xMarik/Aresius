import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/store';

// ─── Data types ────────────────────────────────────────────────────────────────

export interface ScopeRule {
    id: string;
    pattern: string; // e.g. "*.target.com", "target.com/api/*"
}

export interface Scope {
    id: string;
    name: string;
    color: string; // hex, e.g. "#6366f1"
    allow: ScopeRule[];
    deny: ScopeRule[];
}

interface ScopeState {
    scopes: Scope[];
    activeScopeId: string | null; // null = no active scope (everything passes)
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const SCOPE_COLORS = [
    '#6366f1', // indigo
    '#10b981', // emerald
    '#f59e0b', // amber
    '#ef4444', // red
    '#8b5cf6', // violet
    '#06b6d4', // cyan
    '#ec4899', // pink
    '#84cc16', // lime
];

// ─── Initial state ─────────────────────────────────────────────────────────────

const initialState: ScopeState = {
    scopes: [],
    activeScopeId: null,
};

// ─── Slice ─────────────────────────────────────────────────────────────────────

const scopeSlice = createSlice({
    name: 'scope',
    initialState,
    reducers: {
        /** Create a brand-new scope with a generated id and a random color. */
        createScope: (state, action: PayloadAction<{ name: string }>) => {
            const colorIndex = state.scopes.length % SCOPE_COLORS.length;
            const scope: Scope = {
                id: generateId(),
                name: action.payload.name,
                color: SCOPE_COLORS[colorIndex],
                allow: [],
                deny: [],
            };
            state.scopes.push(scope);
        },

        /** Delete a scope by id. If it was active, clear the active scope. */
        deleteScope: (state, action: PayloadAction<string>) => {
            state.scopes = state.scopes.filter((s) => s.id !== action.payload);
            if (state.activeScopeId === action.payload) {
                state.activeScopeId = null;
            }
        },

        /** Rename a scope. */
        renameScope: (state, action: PayloadAction<{ id: string; name: string }>) => {
            const scope = state.scopes.find((s) => s.id === action.payload.id);
            if (scope) scope.name = action.payload.name;
        },

        /** Change a scope's color. */
        setScopeColor: (state, action: PayloadAction<{ id: string; color: string }>) => {
            const scope = state.scopes.find((s) => s.id === action.payload.id);
            if (scope) scope.color = action.payload.color;
        },

        /** Set (or clear) the active scope. Pass null to deactivate all scopes. */
        setActiveScope: (state, action: PayloadAction<string | null>) => {
            state.activeScopeId = action.payload;
        },

        /** Add an allow or deny rule to a scope. */
        addRule: (
            state,
            action: PayloadAction<{ scopeId: string; list: 'allow' | 'deny'; pattern: string }>
        ) => {
            const scope = state.scopes.find((s) => s.id === action.payload.scopeId);
            if (!scope) return;
            const rule: ScopeRule = { id: generateId(), pattern: action.payload.pattern.trim() };
            scope[action.payload.list].push(rule);
        },

        /** Remove a rule by its id from either list. */
        removeRule: (
            state,
            action: PayloadAction<{ scopeId: string; list: 'allow' | 'deny'; ruleId: string }>
        ) => {
            const scope = state.scopes.find((s) => s.id === action.payload.scopeId);
            if (!scope) return;
            scope[action.payload.list] = scope[action.payload.list].filter(
                (r) => r.id !== action.payload.ruleId
            );
        },

        /** Update a rule's pattern in-place. */
        updateRule: (
            state,
            action: PayloadAction<{
                scopeId: string;
                list: 'allow' | 'deny';
                ruleId: string;
                pattern: string;
            }>
        ) => {
            const scope = state.scopes.find((s) => s.id === action.payload.scopeId);
            if (!scope) return;
            const rule = scope[action.payload.list].find((r) => r.id === action.payload.ruleId);
            if (rule) rule.pattern = action.payload.pattern.trim();
        },
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
} = scopeSlice.actions;

// ─── Selectors ─────────────────────────────────────────────────────────────────

export const selectActiveScope = (state: RootState): Scope | null =>
    state.scope.scopes.find((s) => s.id === state.scope.activeScopeId) ?? null;

export const selectAllScopes = (state: RootState): Scope[] => state.scope.scopes;

export const selectActiveScopeId = (state: RootState): string | null => state.scope.activeScopeId;

export default scopeSlice.reducer;
