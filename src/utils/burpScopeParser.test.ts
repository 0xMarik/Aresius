import { describe, it, expect } from 'bun:test';
import {
    parseBurpScope,
    exportToBurpScope,
    isRegexPattern,
    burpAdvancedRuleToPattern,
    burpSimpleRuleToPattern,
    burpSimpleRuleToPatterns,
    patternToBurpAdvancedRule,
} from './burpScopeParser';
import type { Scope } from '@/store/slices/scopeSlice';

describe('burpScopeParser', () => {
    describe('isRegexPattern', () => {
        it('identifies regex patterns correctly', () => {
            expect(isRegexPattern('^.*\\.example\\.com$')).toBe(true);
            expect(isRegexPattern('^api-(v1|v2)\\.test\\.com$')).toBe(true);
            expect(isRegexPattern('regex:https://example\\.com/.*')).toBe(true);
            expect(isRegexPattern('(?i)^test\\.com$')).toBe(true);
            expect(isRegexPattern('/^test\\/.*$/i')).toBe(true);
            expect(isRegexPattern('^/api/v[0-9]+/.*')).toBe(true);
        });

        it('identifies plain globs and strings as non-regex', () => {
            expect(isRegexPattern('*.example.com')).toBe(false);
            expect(isRegexPattern('example.com')).toBe(false);
            expect(isRegexPattern('example.com/api/*')).toBe(false);
            expect(isRegexPattern('https://example.com/api/')).toBe(false);
            expect(isRegexPattern('')).toBe(false);
        });
    });

    describe('helper conversion functions', () => {
        it('burpAdvancedRuleToPattern converts advanced rules to patterns', () => {
            expect(burpAdvancedRuleToPattern({ host: '^.*\\.test\\.com$', protocol: 'any' })).toBe('^.*\\.test\\.com$');
            expect(burpAdvancedRuleToPattern({ host: '^target\\.com$', file: '^/api/v1/.*$', protocol: 'https' })).toBe('^target\\.com/api/v1/.*$');
            expect(burpAdvancedRuleToPattern({ host: '', file: '' })).toBe('.*');
        });

        it('burpSimpleRuleToPatterns converts simple rules to patterns with include_subdomains', () => {
            expect(burpSimpleRuleToPatterns({ prefix: 'https://google.com', include_subdomains: true })).toEqual(['*.google.com', 'google.com']);
            expect(burpSimpleRuleToPatterns({ prefix: 'facebook.com', include_subdomains: false })).toEqual(['facebook.com']);
            expect(burpSimpleRuleToPatterns({ prefix: '' })).toEqual(['.*']);
        });

        it('burpSimpleRuleToPattern converts simple rules to patterns with include_subdomains', () => {
            expect(burpSimpleRuleToPattern({ prefix: 'https://google.com', include_subdomains: true })).toBe('*.google.com');
            expect(burpSimpleRuleToPattern({ prefix: 'facebook.com', include_subdomains: false })).toBe('facebook.com');
            expect(burpSimpleRuleToPattern({ prefix: '' })).toBe('.*');
        });

        it('patternToBurpAdvancedRule converts wildcard pattern to Burp regex', () => {
            const rule1 = patternToBurpAdvancedRule('*.example.com');
            expect(rule1.host).toBe('^.*\\.example\\.com$');
            expect(rule1.file).toBe('^/.*$');

            const rule2 = patternToBurpAdvancedRule('^.*\\.api\\.com/v1/.*$');
            expect(rule2.host).toBe('^.*\\.api\\.com$');
            expect(rule2.file).toBe('^/v1/.*$');

            const rule3 = patternToBurpAdvancedRule('facebook.com');
            expect(rule3.host).toBe('^facebook\\.com$');
            expect(rule3.file).toBe('^/.*$');
        });
    });

    describe('parseBurpScope - Advanced Mode', () => {
        it('parses standard Burp target scope JSON with advanced mode', () => {
            const burpJson = JSON.stringify({
                target: {
                    scope: {
                        advanced_mode: true,
                        include: [
                            {
                                enabled: true,
                                protocol: 'https',
                                host: '^.*\\.example\\.com$',
                                port: '^443$',
                                file: '^/api/.*$',
                            },
                            {
                                enabled: true,
                                protocol: 'any',
                                host: '^target\\.com$',
                                port: '.*',
                                file: '^/.*$',
                            },
                        ],
                        exclude: [
                            {
                                enabled: true,
                                protocol: 'https',
                                host: '^secret\\.example\\.com$',
                                port: '^443$',
                                file: '^/.*$',
                            },
                        ],
                    },
                },
            });

            const result = parseBurpScope(burpJson);
            expect(result.success).toBe(true);
            expect(result.advancedMode).toBe(true);
            expect(result.include.length).toBe(2);
            expect(result.exclude.length).toBe(1);
            expect(result.totalRulesCount).toBe(3);
            expect(result.enabledRulesCount).toBe(3);

            expect(result.include[0].pattern).toBe('^.*\\.example\\.com/api/.*$');
            expect(result.include[1].pattern).toBe('^target\\.com$');
            expect(result.exclude[0].pattern).toBe('^secret\\.example\\.com$');
        });

        it('parses top-level { scope: ... } format', () => {
            const scopeJson = JSON.stringify({
                scope: {
                    advanced_mode: true,
                    include: [
                        { enabled: true, host: '^api\\.company\\.com$', protocol: 'any' },
                    ],
                    exclude: [],
                },
            });

            const result = parseBurpScope(scopeJson);
            expect(result.success).toBe(true);
            expect(result.include.length).toBe(1);
            expect(result.include[0].pattern).toBe('^api\\.company\\.com$');
        });

        it('handles missing optional fields gracefully', () => {
            const jsonWithMissingFields = JSON.stringify({
                target: {
                    scope: {
                        advanced_mode: true,
                        include: [
                            { host: '^minimal\\.com$' },
                            { file: '^/custom/path/.*$' },
                        ],
                        exclude: [],
                    },
                },
            });

            const result = parseBurpScope(jsonWithMissingFields);
            expect(result.success).toBe(true);
            expect(result.include.length).toBe(2);
            expect(result.include[0].pattern).toBe('^minimal\\.com$');
            expect(result.include[1].pattern).toBe('^/custom/path/.*$');
        });

        it('tracks disabled rules properly', () => {
            const jsonWithDisabled = JSON.stringify({
                target: {
                    scope: {
                        advanced_mode: true,
                        include: [
                            { enabled: true, host: '^active\\.com$' },
                            { enabled: false, host: '^disabled\\.com$' },
                        ],
                        exclude: [],
                    },
                },
            });

            const result = parseBurpScope(jsonWithDisabled);
            expect(result.success).toBe(true);
            expect(result.totalRulesCount).toBe(2);
            expect(result.enabledRulesCount).toBe(1);
            expect(result.include[0].enabled).toBe(true);
            expect(result.include[1].enabled).toBe(false);
        });
    });

    describe('parseBurpScope - Simple Mode', () => {
        it('parses standard Burp simple mode with prefixes', () => {
            const simpleJson = JSON.stringify({
                target: {
                    scope: {
                        advanced_mode: false,
                        include: [
                            { enabled: true, prefix: 'https://example.com/api/' },
                            { enabled: true, prefix: 'https://target.com/' },
                        ],
                        exclude: [
                            { enabled: true, prefix: 'https://example.com/api/logout' },
                        ],
                    },
                },
            });

            const result = parseBurpScope(simpleJson);
            expect(result.success).toBe(true);
            expect(result.advancedMode).toBe(false);
            expect(result.include.length).toBe(2);
            expect(result.exclude.length).toBe(1);
            expect(result.include[0].pattern).toBe('example.com/api/');
            expect(result.exclude[0].pattern).toBe('example.com/api/logout');
        });

        it('handles include_subdomains correctly when importing simple mode', () => {
            const userExampleJson = JSON.stringify({
                target: {
                    scope: {
                        advanced_mode: false,
                        exclude: [],
                        include: [
                            {
                                enabled: true,
                                include_subdomains: true,
                                prefix: "google.com",
                            },
                            {
                                enabled: true,
                                include_subdomains: false,
                                prefix: "facebook.com",
                            },
                        ],
                    },
                },
            });

            const result = parseBurpScope(userExampleJson);
            expect(result.success).toBe(true);
            // google.com with include_subdomains: true produces 2 rules (*.google.com and google.com)
            // facebook.com with include_subdomains: false produces 1 rule (facebook.com)
            // Total = 3 rules
            expect(result.include.length).toBe(3);
            expect(result.include[0].pattern).toBe('*.google.com');
            expect(result.include[1].pattern).toBe('google.com');
            expect(result.include[2].pattern).toBe('facebook.com');
        });
    });

    describe('parseBurpScope - Error Handling', () => {
        it('returns error for empty input', () => {
            const result = parseBurpScope('');
            expect(result.success).toBe(false);
            expect(result.error).toContain('Empty JSON');
        });

        it('returns error for malformed JSON syntax', () => {
            const result = parseBurpScope('{ target: { scope: invalid } }');
            expect(result.success).toBe(false);
            expect(result.error).toContain('syntax error');
        });

        it('returns error for non-matching JSON object', () => {
            const result = parseBurpScope(JSON.stringify({ someOtherConfig: true }));
            expect(result.success).toBe(false);
            expect(result.error).toContain('Could not detect');
        });
    });

    describe('exportToBurpScope', () => {
        const sampleScope: Scope = {
            id: 'scope-1',
            name: 'Test Scope',
            color: '#6366f1',
            allow: [
                { id: '1', pattern: '*.example.com' },
                { id: '2', pattern: '^.*\\.target\\.com/api/.*$' },
                { id: '3', pattern: 'facebook.com' },
            ],
            deny: [
                { id: '4', pattern: 'secret.example.com' },
            ],
        };

        it('always exports in Advanced Mode (Regex) converting wildcards to regexes', () => {
            const burpExport = exportToBurpScope(sampleScope);
            expect(burpExport.target.scope.advanced_mode).toBe(true);
            expect(burpExport.target.scope.include.length).toBe(3);
            expect(burpExport.target.scope.exclude.length).toBe(1);

            // *.example.com wildcard -> ^.*\.example\.com$
            const advInclude1 = burpExport.target.scope.include[0];
            expect(advInclude1.host).toBe('^.*\\.example\\.com$');
            expect(advInclude1.file).toBe('^/.*$');
            expect(advInclude1.protocol).toBe('any');

            // Regex ^.*\.target\.com/api/.*$
            const advInclude2 = burpExport.target.scope.include[1];
            expect(advInclude2.host).toBe('^.*\\.target\\.com$');
            expect(advInclude2.file).toBe('^/api/.*$');

            // Plain facebook.com -> ^facebook\.com$
            const advInclude3 = burpExport.target.scope.include[2];
            expect(advInclude3.host).toBe('^facebook\\.com$');
            expect(advInclude3.file).toBe('^/.*$');

            // Deny secret.example.com -> ^secret\.example\.com$
            const advExclude1 = burpExport.target.scope.exclude[0];
            expect(advExclude1.host).toBe('^secret\\.example\\.com$');
        });
    });
});
