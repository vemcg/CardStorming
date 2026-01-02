// Authentication and user management

import { debugLog } from '../utils/DebugLog.js';

export class Auth {
    constructor() {
        this.userHash = null;
        this.userData = null;
        this.currentIdentity = null; // { name, initials }
        this.isReadOnly = true;
        this.COOKIE_NAME = 'cardstorming_user';
    }

    /**
     * Initialize auth - check for existing cookie
     */
    async init() {
        this.userHash = this.getCookie(this.COOKIE_NAME);

        if (this.userHash) {
            try {
                // Load user profile from server
                const response = await fetch(`/api/user/${this.userHash}`);
                if (response.ok) {
                    this.userData = await response.json();
                    debugLog.info('User loaded from cookie', {
                        userHash: this.userHash,
                        defaultName: this.userData.defaultName
                    });
                    return true;
                } else {
                    // Cookie is invalid, clear it
                    this.clearCookie(this.COOKIE_NAME);
                    this.userHash = null;
                }
            } catch (err) {
                console.error('Error loading user:', err);
                this.clearCookie(this.COOKIE_NAME);
                this.userHash = null;
            }
        }

        debugLog.info('No valid user session found');
        return false;
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

            // Set cookie
            this.setCookie(this.COOKIE_NAME, this.userHash, 365);

            debugLog.info('User registered', {
                userHash: this.userHash,
                isNew: result.isNew
            });

            return result;
        } catch (err) {
            console.error('Registration error:', err);
            throw err;
        }
    }

    /**
     * Get all available identities for current user
     */
    async getIdentities() {
        if (!this.isAuthenticated()) {
            return [];
        }

        try {
            const response = await fetch(`/api/user/${this.userHash}/identities`);
            if (!response.ok) {
                throw new Error('Failed to load identities');
            }

            const result = await response.json();
            return result.identities;
        } catch (err) {
            console.error('Error loading identities:', err);
            return [];
        }
    }

    /**
     * Get user's projects
     */
    async getProjects() {
        if (!this.isAuthenticated()) {
            return [];
        }

        try {
            const response = await fetch(`/api/user/${this.userHash}/projects`);
            if (!response.ok) {
                throw new Error('Failed to load projects');
            }

            const result = await response.json();
            return result.projects;
        } catch (err) {
            console.error('Error loading projects:', err);
            return [];
        }
    }

    /**
     * Check if identity conflicts in a project
     */
    async checkIdentityConflict(projectHash, name, initials) {
        try {
            const response = await fetch(`/api/project/${projectHash}/check-identity`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    initials,
                    userHash: this.userHash
                })
            });

            if (!response.ok) {
                throw new Error('Failed to check identity');
            }

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
        if (!this.isAuthenticated()) {
            throw new Error('User not authenticated');
        }

        try {
            const response = await fetch(`/api/project/${projectHash}/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userHash: this.userHash,
                    name,
                    initials
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to join project');
            }

            const result = await response.json();

            if (result.success) {
                this.currentIdentity = { name, initials };
                this.isReadOnly = false;

                debugLog.info('Joined project', {
                    projectHash,
                    identity: this.currentIdentity
                });
            }

            return result;
        } catch (err) {
            console.error('Error joining project:', err);
            throw err;
        }
    }

    /**
     * Get user's identities in a specific project
     */
    async getProjectIdentities(projectHash) {
        if (!this.isAuthenticated()) {
            return [];
        }

        try {
            const response = await fetch(`/api/project/${projectHash}/user/${this.userHash}/identities`);
            if (!response.ok) {
                throw new Error('Failed to load project identities');
            }

            const result = await response.json();
            return result.identities;
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

        debugLog.info('Set current identity', { identity: this.currentIdentity });
    }

    /**
     * Set read-only mode
     */
    setReadOnly(readOnly) {
        this.isReadOnly = readOnly;
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
        this.userHash = null;
        this.userData = null;
        this.currentIdentity = null;
        this.isReadOnly = true;

        debugLog.info('User logged out');
    }

    // ========================================================================
    // Cookie Management
    // ========================================================================

    /**
     * Set a cookie
     */
    setCookie(name, value, days) {
        let expires = '';
        if (days) {
            const date = new Date();
            date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
            expires = '; expires=' + date.toUTCString();
        }
        document.cookie = name + '=' + (value || '') + expires + '; path=/; SameSite=Strict';
    }

    /**
     * Get a cookie
     */
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

    /**
     * Clear a cookie
     */
    clearCookie(name) {
        document.cookie = name + '=; Max-Age=-99999999; path=/';
    }
}
