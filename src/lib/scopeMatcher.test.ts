import { describe, it, expect } from 'bun:test';
import {
    urlMatchesPattern,
    isInScope,
    isUrlInScope,
    parseHostname,
    parseTarget,
} from './scopeMatcher';
import type { Scope } from '@/store/slices/scopeSlice';

describe('scopeMatcher', () => {
    describe('urlMatchesPattern', () => {
        // Glob matching
        it('matches glob patterns correctly', () => {
            expect(urlMatchesPattern('*.example.com', 'sub.example.com', '/')).toBe(true);
            expect(urlMatchesPattern('*.example.com', 'example.com', '/')).toBe(false);
            expect(urlMatchesPattern('example.com', 'example.com', '/')).toBe(true);
            expect(urlMatchesPattern('*.example.com', 'api.sub.example.com', '/test')).toBe(true);
            expect(urlMatchesPattern('*.example.com', 'other.com', '/')).toBe(false);

            expect(urlMatchesPattern('example.com/api/*', 'example.com', '/api/v1/users')).toBe(true);
            expect(urlMatchesPattern('example.com/api/*', 'example.com', '/admin')).toBe(false);
        });

        // Regex matching
        it('matches regex patterns correctly', () => {
            expect(urlMatchesPattern('^.*\\.example\\.com$', 'app.example.com', '/')).toBe(true);
            expect(urlMatchesPattern('^(?:.*\\.)?example\\.com$', 'example.com', '/')).toBe(true);
            expect(urlMatchesPattern('^(?:.*\\.)?example\\.com$', 'app.example.com', '/')).toBe(true);
            expect(urlMatchesPattern('^.*\\.example\\.com$', 'badexample.com', '/')).toBe(false);

            expect(urlMatchesPattern('^.*\\.example\\.com/api/.*$', 'sub.example.com', '/api/v1/data')).toBe(true);
            expect(urlMatchesPattern('^.*\\.example\\.com/api/.*$', 'sub.example.com', '/login')).toBe(false);

            expect(urlMatchesPattern('^api-(v1|v2)\\.target\\.com$', 'api-v1.target.com', '/')).toBe(true);
            expect(urlMatchesPattern('^api-(v1|v2)\\.target\\.com$', 'api-v2.target.com', '/')).toBe(true);
            expect(urlMatchesPattern('^api-(v1|v2)\\.target\\.com$', 'api-v3.target.com', '/')).toBe(false);

            expect(urlMatchesPattern('^/api/v[0-9]+/.*$', 'target.com', '/api/v2/items')).toBe(true);
            expect(urlMatchesPattern('^/api/v[0-9]+/.*$', 'target.com', '/api/vX/items')).toBe(false);
        });

        // Prefix URL matching
        it('matches simple prefix URLs', () => {
            expect(urlMatchesPattern('https://example.com/api', 'example.com', '/api/users')).toBe(true);
            expect(urlMatchesPattern('https://example.com/api', 'example.com', '/other')).toBe(false);
        });
    });

    describe('isInScope', () => {
        const scope: Scope = {
            id: 'scope-1',
            name: 'Test Target Scope',
            color: '#10b981',
            allow: [
                { id: '1', pattern: '*.target.com' },
                { id: '2', pattern: '^api-(v1|v2)\\.service\\.net/.*$' },
            ],
            deny: [
                { id: '3', pattern: 'internal.target.com' },
                { id: '4', pattern: '^api-v1\\.service\\.net/internal/.*$' },
            ],
        };

        it('returns true when scope is null (all traffic in scope)', () => {
            expect(isInScope(null, 'anywhere.com', '/')).toBe(true);
        });

        it('evaluates allow rules correctly', () => {
            expect(isInScope(scope, 'sub.target.com', '/dashboard')).toBe(true);
            expect(isInScope(scope, 'api-v1.service.net', '/public/data')).toBe(true);
            expect(isInScope(scope, 'api-v2.service.net', '/public/data')).toBe(true);
        });

        it('denies traffic matching deny rules even if allow matches', () => {
            expect(isInScope(scope, 'internal.target.com', '/dashboard')).toBe(false);
            expect(isInScope(scope, 'api-v1.service.net', '/internal/admin')).toBe(false);
        });

        it('returns false for traffic matching neither', () => {
            expect(isInScope(scope, 'google.com', '/')).toBe(false);
            expect(isInScope(scope, 'api-v3.service.net', '/')).toBe(false);
        });
    });

    describe('isUrlInScope', () => {
        const scope: Scope = {
            id: 'scope-2',
            name: 'URL Test Scope',
            color: '#3b82f6',
            allow: [
                { id: '1', pattern: '^.*\\.example\\.com/api/.*$' },
            ],
            deny: [
                { id: '2', pattern: 'secret.example.com' },
            ],
        };

        it('tests raw full URLs', () => {
            expect(isUrlInScope(scope, 'https://app.example.com/api/v1/auth')).toBe(true);
            expect(isUrlInScope(scope, 'https://secret.example.com/api/v1/auth')).toBe(false);
            expect(isUrlInScope(scope, 'https://app.example.com/home')).toBe(false);
        });
    });

    describe('parseTarget and parseHostname', () => {
        it('parses target URL strings correctly', () => {
            expect(parseTarget('https://example.com:8080/api/test')).toEqual({
                host: 'example.com:8080',
                path: '/api/test',
            });
            expect(parseTarget('example.com')).toEqual({
                host: 'example.com',
                path: '/',
            });
        });

        it('parses hostname from host:port', () => {
            expect(parseHostname('example.com:443')).toBe('example.com');
            expect(parseHostname('[::1]:8080')).toBe('[::1]');
            expect(parseHostname('example.com')).toBe('example.com');
        });
    });
});
