// Authentication and user management

import { debugLog } from '../utils/DebugLog.js';

export class Auth {
    constructor() {
        this.userHash = null;
        this.userData = null;
        this.currentIdentity = null; // { name, initials }
        this.isReadOnly = true;
        this.COOKIE_NAME = 'cardstorming_user';
        this.STORAGE_KEY = 'cardstorming_user_data';
    }

    /**
     * Initialize auth — check localStorage first, then cookie + server
     */
    async init() {
        // Try localStorage first (works offline, survives server restarts)
        const stored = localStorage.getItem(this.STORAGE_KEY);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (parsed.userHash && parsed.userData) {
                    this.userHash = parsed.userHash;
                    this.userData = parsed.userData;
                    // Restore last-used identity if saved
                    if (parsed.currentIdentity) {
                        this.currentIdentity = parsed.currentIdentity;
                        this.isReadOnly = false;
                    }
                    debugLog.info('User loaded from localStorage', {
                        userHash: this.userHash,
                        defaultName: this.userData.defaultName
                    });
                    return true;
                }
            } catch (err) {
                localStorage.removeItem(this.STORAGE_KEY);
            }
        }

        // Fall back to cookie + server fetch
        this.userHash = this.getCookie(this.COOKIE_NAME);
        if (this.userHash) {
            try {
                const response = await fetch(`/api/user/${this.userHash}`);
                if (response.ok) {
                    this.userData = await response.json();
                    this._saveToStorage();
                    debugLog.info('User loaded from server', {
                        userHash: this.userHash,
                        defaultName: this.userData.defaultName
                    });
                    return true;
                } else {
                    this.clearCookie(this.COOKIE_NAME);
                    this.userHash = null;
                }
            } catch (err) {
                // Server unreachable — clear stale cookie but don't block
                this.clearCookie(this.COOKIE_NAME);
                this.userHash = null;
            }
        }

        debugLog.info('No valid user session found');
        return false;
    }

    _saveToStorage() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
                userHash: this.userHash,
                userData: this.userData,
                currentIdentity: this.currentIdentity
            }));
        } catch (err) {
            // localStorage might be full or unavailable (private browsing edge case)
        }
    }

    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        return this.userHash !== null && this.userData !== null;
    }

    /**
     * Check if user has write access to current project
     */
    hasWriteAccess() {
        return this.isAuthenticated() && !this.isReadOnly;
    }

    /**
     * Register new user
     */
    async register(email, name, initials) {
        try {
            const response = await fetch('/api/user/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, name, initials })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Registration failed');
            }

            const result = await response.json();
            this.userHash = result.userHash;
            this.userData = result.user;

            this.setCookie(this.COOKIE_NAME, this.userHash, 365);
            this._saveToStorage();

            debugLog.info('User registered', { userHash: this.userHash, isNew: result.isNew });
            return result;
        } catch (err) {
            console.error('Registration error:', err);
            throw err;
        }
    }

    /**
     * Get all available identities for current user — built from in-memory userData
     */
    getIdentities() {
        if (!this.isAuthenticated()) return [];

        const identities = [{
            name: this.userData.defaultName,
            initials: this.userData.defaultInitials,
            isDefault: true
        }];

        const seen = new Set([`${this.userData.defaultName}|${this.userData.defaultInitials}`]);
        for (const identity of Object.values(this.userData.identities || {})) {
            const key = `${identity.name}|${identity.initials}`;
            if (!seen.has(key)) {
                identities.push({ name: identity.name, initials: identity.initials, isDefault: false });
                seen.add(key);
            }
        }

        return identities;
    }

    /**
     * Get user's projects (from in-memory userData)
     */
    getProjects() {
        if (!this.isAuthenticated()) return [];
        return this.userData.projects || [];
    }

    /**
     * Check if identity conflicts in a project
     */
    async checkIdentityConflict(projectHash, name, initials) {
        try {
            const response = await fetch(`/api/project/${projectHash}/check-identity`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, initials, userHash: this.userHash })
            });

            if (!response.ok) throw new Error('Failed to check identity');
            return await response.json();
        } catch (err) {
            console.error('Error checking identity:', err);
            return { conflict: false };
        }
    }

    /**
     * Join project with specific identity
     */
    async joinProject(projectHash, name, initials) {
        if (!this.isAuthenticated()) throw new Error('User not authenticated');

        try {
            const response = await fetch(`/api/project/${projectHash}/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userHash: this.userHash, name, initials })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to join project');
            }

            const result = await response.json();

            if (result.success) {
                this.currentIdentity = { name, initials };
                this.isReadOnly = false;

                // Update local userData with the new project identity
                if (this.userData) {
                    if (!this.userData.projects) this.userData.projects = [];
                    if (!this.userData.projects.includes(projectHash)) {
                        this.userData.projects.push(projectHash);
                    }
                    if (!this.userData.identities) this.userData.identities = {};
                    this.userData.identities[projectHash] = { name, initials };
                    this._saveToStorage();
                }

                debugLog.info('Joined project', { projectHash, identity: this.currentIdentity });
            }

            return result;
        } catch (err) {
            console.error('Error joining project:', err);
            throw err;
        }
    }

    /**
     * Get user's identities in a specific project — checks local userData first
     */
    async getProjectIdentities(projectHash) {
        if (!this.isAuthenticated()) return [];

        // Check local userData first
        const localIdentity = this.userData.identities && this.userData.identities[projectHash];
        if (localIdentity) {
            return [{ name: localIdentity.name, initials: localIdentity.initials }];
        }

        // Fall back to server (handles migration cases)
        try {
            const response = await fetch(`/api/project/${projectHash}/user/${this.userHash}/identities`);
            if (!response.ok) return [];
            const result = await response.json();

            // Cache any found identities locally
            if (result.identities && result.identities.length > 0) {
                if (!this.userData.identities) this.userData.identities = {};
                result.identities.forEach(id => {
                    this.userData.identities[projectHash] = { name: id.name, initials: id.initials };
                });
                this._saveToStorage();
            }

            return result.identities || [];
        } catch (err) {
            console.error('Error loading project identities:', err);
            return [];
        }
    }

    /**
     * Set current identity for a project
     */
    setCurrentIdentity(name, initials) {
        this.currentIdentity = { name, initials };
        this.isReadOnly = false;
        this._saveToStorage();
        debugLog.info('Set current identity', { identity: this.currentIdentity });
    }

    /**
     * Set read-only mode
     */
    setReadOnly(readOnly) {
        this.isReadOnly = readOnly;
        if (readOnly) this.currentIdentity = null;
        debugLog.info('Read-only mode', { readOnly });
    }

    /**
     * Get current identity
     */
    getCurrentIdentity() {
        return this.currentIdentity;
    }

    /**
     * Logout (clear session)
     */
    logout() {
        this.clearCookie(this.COOKIE_NAME);
        localStorage.removeItem(this.STORAGE_KEY);
        this.userHash = null;
        this.userData = null;
        this.currentIdentity = null;
        this.isReadOnly = true;
        debugLog.info('User logged out');
    }

    // ========================================================================
    // Cookie Management
    // ========================================================================

    setCookie(name, value, days) {
        let expires = '';
        if (days) {
            const date = new Date();
            date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
            expires = '; expires=' + date.toUTCString();
        }
        document.cookie = name + '=' + (value || '') + expires + '; path=/; SameSite=Strict';
    }

    getCookie(name) {
        const nameEQ = name + '=';
        const ca = document.cookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) === ' ') c = c.substring(1, c.length);
            if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
        }
        return null;
    }

    clearCookie(name) {
        document.cookie = name + '=; Max-Age=-99999999; path=/';
    }
}
