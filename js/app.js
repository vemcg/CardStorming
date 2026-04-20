// CardStorming application - Refactored with ES6 modules
console.log('CardStorming initialized (ES6 modules)');

// Import all modules
import { debugLog } from './utils/DebugLog.js';
import { CoordinateSystem } from './core/CoordinateSystem.js';
import { ViewportManager } from './core/ViewportManager.js';
import { AppState } from './core/AppState.js';
import { ConstellationManager } from './core/ConstellationManager.js';
import { Card } from './elements/Card.js';
import { Wormhole } from './elements/Wormhole.js';
import { ZoomSearchTool } from './elements/ZoomSearchTool.js';
import { Auth } from './core/Auth.js';
import { showRegistrationDialog, showIdentityDialog, showReadOnlyBanner, hideReadOnlyBanner, showWormholeNamingDialog } from './utils/DialogUtils.js';

// ============================================================================
// GLOBAL STATE
// ============================================================================

const appState = new AppState();
const auth = new Auth();
let viewportManager = null;
let constellationManager = null;
let socket = null;
let currentProjectId = null;
let isProjectOpen = false;
let currentUserInitials = '';
let wormholeZoomAnimationFrame = null; // Track wormhole drag zoom animation

// Export to window for debugging and dialog access
window.appState = appState;
window.auth = auth;
window.debugLog = debugLog;
window.viewportManager = null; // Will be set after init
window.constellationManager = null; // Will be set after init
window.wormholeZoomAnimationFrame = null; // Export for dialog access

// ============================================================================
// PROJECT MANAGEMENT UTILITIES
// ============================================================================

const adjectives = ['Galloping', 'Remorseful', 'Bouncing', 'Thoughtful', 'Dancing', 'Mighty', 'Gentle', 'Swift', 'Brave', 'Clever'];
const nouns = ['Giraffe', 'Rhinoceros', 'Elephant', 'Penguin', 'Dolphin', 'Tiger', 'Panda', 'Eagle', 'Otter', 'Fox'];

function generateProjectName() {
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${adj} ${noun}`;
}

function generateProjectId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function getProjectIdFromURL() {
    const hash = window.location.hash.substring(1);
    // Return null if hash is empty, "null", or "undefined"
    if (!hash || hash === 'null' || hash === 'undefined') {
        return null;
    }
    return hash;
}

function setProjectIdInURL(projectId) {
    if (!projectId || projectId === 'null' || projectId === 'undefined') {
        debugLog.warn('Attempted to set invalid project ID in URL', { projectId });
        window.location.hash = '';
        return;
    }
    debugLog.info('Setting project ID in URL', { projectId, currentHash: window.location.hash });
    window.location.hash = projectId;
    debugLog.info('URL hash after setting', { hash: window.location.hash });
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// ============================================================================
// LOCAL STORAGE HELPERS
// ============================================================================

function getKnownProjects() {
    const stored = localStorage.getItem('knownProjects');
    return stored ? JSON.parse(stored) : {};
}

function saveKnownProject(projectId, projectName) {
    const known = getKnownProjects();
    known[projectId] = projectName;
    localStorage.setItem('knownProjects', JSON.stringify(known));
}

function removeKnownProject(projectId) {
    const known = getKnownProjects();
    delete known[projectId];
    localStorage.setItem('knownProjects', JSON.stringify(known));
}

async function cleanupInvalidProjects() {
    const known = getKnownProjects();
    let cleaned = false;

    // Remove ONLY the invalid project IDs (null, undefined, empty string)
    ['null', 'undefined', ''].forEach(invalidId => {
        if (invalidId in known) {
            delete known[invalidId];
            cleaned = true;
            debugLog.info('Removed invalid project from localStorage', { invalidId });
        }
    });

    // Also clean up user identities for invalid project IDs
    ['null', 'undefined', ''].forEach(invalidId => {
        const key = `userIdentity_${invalidId}`;
        if (localStorage.getItem(key)) {
            localStorage.removeItem(key);
            cleaned = true;
            debugLog.info('Removed invalid user identity from localStorage', { key });
        }
    });

    if (cleaned) {
        localStorage.setItem('knownProjects', JSON.stringify(known));
        debugLog.info('Cleaned up invalid projects from localStorage');
    }

    // Restore project list from server
    try {
        const response = await fetch('/api/projects');
        const data = await response.json();

        if (data.success && data.projects) {
            const known = getKnownProjects();
            let restored = 0;

            data.projects.forEach(project => {
                // Skip invalid IDs
                if (!project.id || project.id === 'null' || project.id === 'undefined' || project.id === '') {
                    return;
                }

                // Only restore if not already in localStorage
                if (!known[project.id]) {
                    known[project.id] = project.name;
                    restored++;
                }
            });

            if (restored > 0) {
                localStorage.setItem('knownProjects', JSON.stringify(known));
                debugLog.info(`Restored ${restored} projects from server`, { total: data.projects.length });
            }
        }
    } catch (err) {
        debugLog.error('Failed to restore projects from server', err);
    }
}

// ============================================================================
// DATA MIGRATION
// ============================================================================

/**
 * Migrate old project format to new format (fallback for client-side)
 * Server should handle most migration, but this provides fallback
 * Old: { viewportCards: [{left, top, ...}] }
 * New: { cards: [{x, y, ...}] }
 */
function migrateProjectData(serverState) {
    // Log version info
    const version = serverState.version || 1;
    debugLog.info('Received project data', { version });

    // Fallback migration (server should have done this already)
    if (serverState.viewportCards && !serverState.cards) {
        debugLog.warn('Client-side migration detected (server should have migrated)', {
            hasViewportCards: !!serverState.viewportCards,
            hasCards: !!serverState.cards
        });
        serverState.cards = serverState.viewportCards.map(oldCard => ({
            id: oldCard.id,
            header: oldCard.header,
            body: oldCard.body,
            color: oldCard.color,
            x: typeof oldCard.left === 'string' ? parseFloat(oldCard.left) : oldCard.left,
            y: typeof oldCard.top === 'string' ? parseFloat(oldCard.top) : oldCard.top,
            zIndex: oldCard.zIndex,
            authorInitials: oldCard.authorInitials
        }));
        delete serverState.viewportCards;
        debugLog.info('Client-side migration complete', { cardCount: serverState.cards.length });
    }

    // Ensure arrays exist
    serverState.cards = serverState.cards || [];
    serverState.wormholes = serverState.wormholes || [];
    serverState.paletteCards = serverState.paletteCards || [];

    return serverState;
}

// ============================================================================
// PROJECT OPEN/CLOSE
// ============================================================================

async function openProject(projectId, skipIdentityCheck = false) {
    if (!projectId || projectId === 'null' || projectId === 'undefined') {
        debugLog.error('Attempted to open project with invalid ID', { projectId });
        closeProject();
        return;
    }

    debugLog.info('Opening project', { projectId, currentProjectId, isAlreadyOpen: currentProjectId === projectId, skipIdentityCheck });

    // Check if this project is already open (from initial socket connection)
    const isAlreadyOpen = currentProjectId === projectId && isProjectOpen;

    // Set project as open FIRST, before any await calls
    // This ensures that state:init from server won't be ignored
    currentProjectId = projectId;
    isProjectOpen = true;

    // Remember this as the last opened project for auto-restore on next load
    localStorage.setItem('lastProjectId', projectId);

    // Record project access time for sorting in File > Open menu
    const projectAccessTimes = JSON.parse(localStorage.getItem('projectAccessTimes') || '{}');
    projectAccessTimes[projectId] = Date.now();
    localStorage.setItem('projectAccessTimes', JSON.stringify(projectAccessTimes));

    // Check authentication and handle project joining
    if (!auth.isAuthenticated()) {
        // User not authenticated - open in read-only mode
        auth.setReadOnly(true);
        debugLog.info('Opening project in read-only mode (not authenticated)');
    } else if (skipIdentityCheck) {
        // Identity already set (e.g., from File > New), skip server check
        // Just ensure we're not in read-only mode
        if (auth.getCurrentIdentity()) {
            auth.setReadOnly(false);
            currentUserInitials = auth.getCurrentIdentity().initials;
            debugLog.info('Using pre-set identity, skipping server check', {
                identity: auth.getCurrentIdentity()
            });
        }
    } else {
        // Check if user is member of this project
        const projectIdentities = await auth.getProjectIdentities(projectId);

        debugLog.info('Project identities loaded', {
            count: projectIdentities.length,
            identities: projectIdentities,
            currentIdentity: auth.getCurrentIdentity()
        });

        if (projectIdentities.length === 0) {
            // Not a member - read-only mode
            auth.setReadOnly(true);
            debugLog.info('Opening project in read-only mode (not a member)');
        } else {
            // Is a member - use the identity that was set by openProjectWithIdentitySelection
            // or set the first one if coming from URL
            if (!auth.getCurrentIdentity() && projectIdentities.length > 0) {
                auth.setCurrentIdentity(projectIdentities[0].name, projectIdentities[0].initials);
                currentUserInitials = projectIdentities[0].initials;
                debugLog.info('Set identity from project identities', {
                    name: projectIdentities[0].name,
                    initials: projectIdentities[0].initials
                });
            }
            auth.setReadOnly(false);
            debugLog.info('Set read-only to false (user is member)', {
                hasWriteAccess: auth.hasWriteAccess(),
                isReadOnly: auth.isReadOnly
            });
        }
    }
    setProjectIdInURL(projectId);
    appState.projectId = projectId;

    // Only clear state if opening a different project
    // If the project is already open from initial socket connection, keep the state
    if (!isAlreadyOpen) {
        appState.clearAll();
        debugLog.info('Cleared state for new project');
    } else {
        debugLog.info('Project already open, keeping existing state');
    }

    // Set project name from localStorage if available
    const knownProjects = getKnownProjects();
    const projectNameEl = document.getElementById('project-name');
    if (knownProjects[projectId] && projectNameEl) {
        // Handle both string and object formats
        const projectData = knownProjects[projectId];
        const projectName = typeof projectData === 'string' ? projectData : projectData.name;

        projectNameEl.value = projectName;
        appState.projectName = projectName;
        debugLog.info('Set project name from localStorage', { name: projectName });
    }

    // Tell server to join this project room
    if (socket && socket.connected) {
        debugLog.info('Emitting project:join', { projectId, socketConnected: socket.connected });
        socket.emit('project:join', { projectId });
    } else {
        debugLog.warn('Cannot emit project:join - socket not connected', {
            hasSocket: !!socket,
            connected: socket ? socket.connected : false
        });
    }

    // Register user with socket.io if authenticated
    if (auth.isAuthenticated() && auth.hasWriteAccess()) {
        const identity = auth.getCurrentIdentity();
        if (identity && socket && socket.connected) {
            const registerData = {
                initials: identity.initials,
                name: identity.name,
                projectId: projectId,
                userHash: auth.userHash  // Include userHash for proper user file updates
            };
            debugLog.info('Emitting user:register', {
                ...registerData,
                hasUserHash: !!auth.userHash
            });
            socket.emit('user:register', registerData, (response) => {
                if (response.success) {
                    debugLog.info('Registered with socket.io', { initials: identity.initials });
                } else {
                    debugLog.error('Socket.io registration failed', response);
                }
            });
        }
    }

    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) shareBtn.style.display = 'inline-block';

    // Update UI based on auth state (will enable/disable based on write access)
    updateUIForAuthState();

    debugLog.info('Project opened', { projectId });
}

function closeProject() {
    debugLog.info('Closing project');

    isProjectOpen = false;
    currentProjectId = null;
    window.location.hash = '';
    appState.clearAll();
    appState.projectId = null;

    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) shareBtn.style.display = 'none';

    const projectNameEl = document.getElementById('project-name');
    if (projectNameEl) projectNameEl.value = '';

    // Clear palette UI
    renderPaletteCards();

    // Reset scan and selection state
    if (window._resetScan) window._resetScan();
    if (window._resetSelection) window._resetSelection();

    // Disable toolbar buttons
    disableToolbarButtons();

    debugLog.info('Project closed');
}

function enableToolbarButtons() {
    const buttons = [
        'add-card-btn',
        'add-wormhole-btn',
        'zoom-search-btn',
        'zoom-in-btn',
        'zoom-out-btn',
        'center-btn',
        'scan-start-btn'
    ];

    buttons.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
        }
    });
}

function disableToolbarButtons() {
    // Only disable write operations, keep zoom/nav buttons enabled always
    const writeButtons = [
        'add-card-btn',
        'add-wormhole-btn',
    ];

    writeButtons.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.disabled = true;
            btn.style.opacity = '0.3';
            btn.style.cursor = 'not-allowed';
        }
    });

    // Zoom and nav buttons always stay enabled
    const zoomButtons = ['zoom-in-btn', 'zoom-out-btn', 'center-btn', 'zoom-search-btn'];
    zoomButtons.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
        }
    });
}

function updateUIForAuthState() {
    const authenticated = auth.isAuthenticated();
    const hasProject = isProjectOpen;
    const hasWriteAccess = auth.hasWriteAccess();

    debugLog.info('updateUIForAuthState', {
        authenticated,
        hasProject,
        hasWriteAccess,
        isReadOnly: auth.isReadOnly,
        currentIdentity: auth.getCurrentIdentity()
    });

    // Update welcome text with user info
    const welcomeText = document.getElementById('welcome-text');
    if (welcomeText) {
        // Only show identity if user has write access to the current project
        if (hasProject && hasWriteAccess && auth.getCurrentIdentity()) {
            const identity = auth.getCurrentIdentity();
            welcomeText.textContent = `Welcome to your collaborative workspace, ${identity.name} (${identity.initials})`;
        } else {
            welcomeText.textContent = 'Welcome to your collaborative workspace';
        }
    }

    // Show/hide read-only banner
    if (hasProject && !hasWriteAccess) {
        showReadOnlyBanner(async () => {
            // When user clicks the banner, trigger registration
            const hasAccess = await requireWriteAccess();
            if (hasAccess) {
                // Refresh UI after successful registration
                updateUIForAuthState();
            }
        });
    } else {
        hideReadOnlyBanner();
    }

    // Disable palette cards in read-only mode
    const paletteCards = document.querySelectorAll('.palette-card');
    paletteCards.forEach(card => {
        card.draggable = hasWriteAccess;
        card.style.opacity = hasWriteAccess ? '1' : '0.5';
        card.style.cursor = hasWriteAccess ? 'grab' : 'not-allowed';
    });

    // Disable viewport cards in read-only mode
    const viewportCards = document.querySelectorAll('.viewport-card');
    viewportCards.forEach(card => {
        card.style.cursor = hasWriteAccess ? 'grab' : 'default';
        if (!hasWriteAccess) {
            card.classList.add('read-only');
        } else {
            card.classList.remove('read-only');
        }
    });

    // Toolbar buttons - use existing enable/disable functions
    if (hasProject && hasWriteAccess) {
        enableToolbarButtons();
    } else {
        disableToolbarButtons();
    }

    // Menu items
    const newMenuItem = document.getElementById('menu-new');
    const openMenuItem = document.getElementById('menu-open');

    if (!authenticated) {
        // No user - only New is enabled (will trigger registration)
        if (newMenuItem) {
            newMenuItem.style.opacity = '1';
            newMenuItem.style.pointerEvents = 'auto';
        }
        if (openMenuItem) {
            openMenuItem.style.opacity = '0.5';
            openMenuItem.style.pointerEvents = 'none';
        }
    } else {
        // Authenticated - both enabled
        if (newMenuItem) {
            newMenuItem.style.opacity = '1';
            newMenuItem.style.pointerEvents = 'auto';
        }
        if (openMenuItem) {
            openMenuItem.style.opacity = '1';
            openMenuItem.style.pointerEvents = 'auto';
        }
    }

    debugLog.info('UI updated for auth state', { authenticated, hasProject, hasWriteAccess });
}

// ============================================================================
// WRITE ACCESS CONTROL
// ============================================================================

async function requireWriteAccess() {
    if (auth.hasWriteAccess()) {
        return true; // Already has access
    }

    // User needs to authenticate
    try {
        if (!auth.isAuthenticated()) {
            // Register first
            const result = await showRegistrationDialog('To edit this project, please register:');
            await auth.register(result.email, result.name, result.initials);
        }

        // Select identity
        const identities = await auth.getIdentities();
        const identity = await showIdentityDialog(
            identities,
            'Select Identity',
            'Choose which identity to use for this project:',
            async (name, initials) => {
                const result = await auth.checkIdentityConflict(currentProjectId, name, initials);
                if (result.conflict) {
                    return {
                        conflict: true,
                        message: `Initials "${initials}" already used by ${result.existingName}`
                    };
                }
                return { conflict: false };
            }
        );

        // Join project
        await auth.joinProject(currentProjectId, identity.name, identity.initials);
        auth.setCurrentIdentity(identity.name, identity.initials);
        auth.setReadOnly(false);
        currentUserInitials = identity.initials;

        // Update UI
        updateUIForAuthState();

        return true;
    } catch (err) {
        if (err.message !== 'Registration cancelled' && err.message !== 'Identity selection cancelled') {
            console.error('Error getting write access:', err);
        }
        return false;
    }
}

// ============================================================================
// MENU HANDLERS
// ============================================================================

async function openProjectWithIdentitySelection(projectId) {
    try {
        // Check if user has identities in this project
        const projectIdentities = await auth.getProjectIdentities(projectId);

        if (projectIdentities.length > 0) {
            // User is already a member - select identity
            const identity = await showIdentityDialog(
                projectIdentities.map(id => ({
                    name: id.name,
                    initials: id.initials,
                    isDefault: false
                })),
                'Select Identity',
                'You are a member of this project as:',
                async (name, initials) => {
                    // Check conflicts in this project
                    const result = await auth.checkIdentityConflict(projectId, name, initials);
                    if (result.conflict) {
                        return {
                            conflict: true,
                            message: `Initials "${initials}" already used by ${result.existingName}`
                        };
                    }
                    return { conflict: false };
                }
            );

            auth.setCurrentIdentity(identity.name, identity.initials);
            currentUserInitials = identity.initials;

            if (identity.isNew) {
                // Adding new identity to existing project membership
                await auth.joinProject(projectId, identity.name, identity.initials);
            }

            // Even for existing identities, we need to ensure server has the userHash
            // This handles migration cases where old project entries lack userHash
            if (socket && socket.connected) {
                socket.emit('user:register', {
                    initials: identity.initials,
                    name: identity.name,
                    projectId: projectId,
                    userHash: auth.userHash
                }, (response) => {
                    if (response.success) {
                        debugLog.info('Re-registered existing identity with server', { initials: identity.initials });
                    }
                });
            }
        } else {
            // Not a member yet - let them register with a new identity for this project
            const identities = await auth.getIdentities();
            const identity = await showIdentityDialog(
                identities,
                'Register for Project',
                'You are not a member of this project. Choose an identity to join:',
                async (name, initials) => {
                    const result = await auth.checkIdentityConflict(projectId, name, initials);
                    if (result.conflict) {
                        return {
                            conflict: true,
                            message: `Initials "${initials}" already used by ${result.existingName}`
                        };
                    }
                    return { conflict: false };
                }
            );

            // Join project with selected identity
            await auth.joinProject(projectId, identity.name, identity.initials);
            auth.setCurrentIdentity(identity.name, identity.initials);
            currentUserInitials = identity.initials;
        }

        // Open project
        openProject(projectId);

    } catch (err) {
        if (err.message !== 'Identity selection cancelled') {
            console.error('Error opening project:', err);
            alert('Failed to open project: ' + err.message);
        }
    }
}

async function populateOpenSubmenu() {
    const openSubmenu = document.getElementById('open-submenu');
    if (!openSubmenu) return;

    openSubmenu.innerHTML = '<div class="submenu-loading">Loading...</div>';

    try {
        let userProjects = [];
        let myProjects = [];
        let unclaimedProjects = [];

        if (auth.isAuthenticated()) {
            // Get user's projects from server
            userProjects = await auth.getProjects();
        }

        // Get list of all projects with user counts and names from server
        const response = await fetch('/api/projects/list');
        const { projects } = await response.json();

        // Create a map for easy lookup
        const projectMap = new Map(projects.map(p => [p.id, p]));

        // Separate into user's projects and unclaimed
        const userProjectSet = new Set(userProjects);

        // Get last access times from localStorage
        const projectAccessTimes = JSON.parse(localStorage.getItem('projectAccessTimes') || '{}');

        projects.forEach(project => {
            // Add last access time to project data
            project.lastAccessed = projectAccessTimes[project.id] || 0;

            if (userProjectSet.has(project.id)) {
                // User's project
                myProjects.push(project);
            } else if (project.userCount === 0) {
                // Unclaimed project
                unclaimedProjects.push(project);
            }
            // Projects with users that aren't this user are not shown
        });

        // Sort by most recently accessed (most recent first)
        myProjects.sort((a, b) => b.lastAccessed - a.lastAccessed);
        unclaimedProjects.sort((a, b) => b.lastAccessed - a.lastAccessed);

        // Build submenu
        openSubmenu.innerHTML = '';

        // Section 1: User's Projects
        if (myProjects.length > 0) {
            const userHeader = document.createElement('div');
            userHeader.className = 'submenu-header';
            userHeader.textContent = 'My Projects';
            openSubmenu.appendChild(userHeader);

            myProjects.forEach(project => {
                const link = document.createElement('a');
                link.href = '#';
                link.textContent = project.name;
                link.addEventListener('click', async (e) => {
                    e.preventDefault();
                    await openProjectWithIdentitySelection(project.id);
                });
                openSubmenu.appendChild(link);
            });
        }

        // Section 2: Unclaimed Projects
        if (unclaimedProjects.length > 0) {
            const unclaimedHeader = document.createElement('div');
            unclaimedHeader.className = 'submenu-header';
            unclaimedHeader.textContent = 'Unclaimed Projects';
            openSubmenu.appendChild(unclaimedHeader);

            unclaimedProjects.forEach(project => {
                const link = document.createElement('a');
                link.href = '#';
                link.textContent = project.name;
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    // Open unclaimed project (will open read-only, then prompt to join)
                    openProject(project.id);
                });
                openSubmenu.appendChild(link);
            });
        }

        // No projects at all
        if (myProjects.length === 0 && unclaimedProjects.length === 0) {
            openSubmenu.innerHTML = '<a href="#" class="disabled-item">No projects available</a>';
        }

    } catch (err) {
        console.error('Error populating projects:', err);
        openSubmenu.innerHTML = '<a href="#" class="disabled-item">Error loading projects</a>';
    }
}

function generateReport() {
    const projectName = appState.projectName || 'CardStorming Report';
    const allCards = Array.from(appState.cards.values());
    const MAX_COORD = 500000;

    // Build sorted item list (same reading-order logic as scan)
    const items = [];
    const visited = new Set();
    const ROW_HEIGHT = 150;

    if (window.constellationManager) {
        for (const [constId, cardIdSet] of window.constellationManager.constellations) {
            if (cardIdSet.size < 2) continue;
            const cards = Array.from(cardIdSet)
                .map(id => appState.cards.get(id))
                .filter(c => c && Math.abs(c.x) <= MAX_COORD && Math.abs(c.y) <= MAX_COORD);
            if (cards.length < 2) continue;
            const minX = Math.min(...cards.map(c => c.x));
            const minY = Math.min(...cards.map(c => c.y));
            // Sort cards within constellation top-to-bottom, left-to-right
            cards.sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);
            items.push({ type: 'constellation', cards, minX, minY });
            cards.forEach(c => visited.add(c.id));
        }
    }

    for (const card of allCards) {
        if (visited.has(card.id)) continue;
        if (!isFinite(card.x) || !isFinite(card.y)) continue;
        if (Math.abs(card.x) > MAX_COORD || Math.abs(card.y) > MAX_COORD) continue;
        items.push({ type: 'card', cards: [card], minX: card.x, minY: card.y });
    }

    items.sort((a, b) => a.minY !== b.minY ? a.minY - b.minY : a.minX - b.minX);

    // Returns shared initials if all cards in the array share the same non-empty authorInitials, else null
    function sectionAuthor(cards) {
        const inits = (cards[0].authorInitials || '').trim();
        if (!inits) return null;
        return cards.every(c => (c.authorInitials || '').trim() === inits) ? inits : null;
    }

    // Returns array of paragraph strings; appends [initials] to last para unless skipInitials is true
    function cardParas(card, skipInitials = false) {
        const body = (card.body || '').trim();
        const initials = skipInitials ? '' : (card.authorInitials || '').trim();
        const paras = body ? body.split(/\n\n+/).map(p => p.trim()).filter(Boolean) : [];
        if (initials) {
            if (paras.length > 0) paras[paras.length - 1] += ` [${initials}]`;
            else paras.push(`[${initials}]`);
        }
        return paras;
    }

    // Build markdown
    const mdLines = [`# ${projectName}`, ''];
    for (const item of items) {
        if (item.type === 'constellation') {
            const sectAuth = sectionAuthor(item.cards);
            const first = item.cards[0];
            const h2 = (first.header || '') + (sectAuth ? ` [${sectAuth}]` : '');
            if (h2) mdLines.push(`## ${h2}`);
            cardParas(first, sectAuth !== null).forEach(p => mdLines.push('', p));
            mdLines.push('');
            for (const card of item.cards.slice(1)) {
                if (card.header) mdLines.push(`### ${card.header}`);
                cardParas(card, sectAuth !== null).forEach(p => mdLines.push('', p));
                mdLines.push('');
            }
        } else {
            const card = item.cards[0];
            const cardAuth = (card.authorInitials || '').trim();
            const h3 = (card.header || '') + (cardAuth && card.header ? ` [${cardAuth}]` : '');
            if (h3) mdLines.push(`### ${h3}`);
            cardParas(card, cardAuth !== '' && card.header !== '').forEach(p => mdLines.push('', p));
            mdLines.push('');
        }
    }
    const markdown = mdLines.join('\n');

    // Build HTML body content
    function cardHtml(card, skipInitials = false) {
        return cardParas(card, skipInitials).map(p => `<p>${escHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
    }

    let bodyHtml = '';
    for (const item of items) {
        if (item.type === 'constellation') {
            const sectAuth = sectionAuthor(item.cards);
            const first = item.cards[0];
            const h2text = (first.header || '') + (sectAuth ? ` [${sectAuth}]` : '');
            bodyHtml += `<h2>${escHtml(h2text)}</h2>`;
            bodyHtml += cardHtml(first, sectAuth !== null);
            for (const card of item.cards.slice(1)) {
                if (card.header) bodyHtml += `<h3>${escHtml(card.header)}</h3>`;
                bodyHtml += cardHtml(card, sectAuth !== null);
            }
            bodyHtml += `<hr>`;
        } else {
            const card = item.cards[0];
            const cardAuth = (card.authorInitials || '').trim();
            const h3text = (card.header || '') + (cardAuth && card.header ? ` [${cardAuth}]` : '');
            if (h3text) bodyHtml += `<h3>${escHtml(h3text)}</h3>`;
            bodyHtml += cardHtml(card, cardAuth !== '' && !!card.header);
        }
    }

    const mdEscaped = markdown.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    const filename = (projectName.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'report') + '.md';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(projectName)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; max-width: 720px; margin: 0 auto; padding: 20px 24px 80px; color: #1a1a1a; background: #fff; line-height: 1.7; }
  .toolbar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #e0e0e0; padding: 10px 0; margin-bottom: 36px; display: flex; gap: 10px; z-index: 10; }
  .btn { background: #1976D2; color: #fff; border: none; padding: 7px 16px; border-radius: 4px; cursor: pointer; font-family: sans-serif; font-size: 13px; }
  .btn:hover { background: #1565C0; }
  .btn-outline { background: #fff; color: #1976D2; border: 1.5px solid #1976D2; }
  .btn-outline:hover { background: #E3F2FD; }
  h1 { font-size: 2em; font-weight: bold; border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; margin-bottom: 32px; }
  h2 { font-size: 1.4em; font-weight: bold; margin: 2.2em 0 0.4em; }
  h3 { font-size: 1.1em; font-weight: bold; margin: 1.6em 0 0.3em; }
  p { margin: 0 0 0.8em; }
  hr { border: none; border-top: 1px solid #ddd; margin: 2.5em 0; }
  @media print { .toolbar { display: none; } body { padding-top: 0; } }
</style>
</head>
<body>
<div class="toolbar">
  <button class="btn" onclick="dlMarkdown()">&#8595; Download Markdown</button>
  <button class="btn btn-outline" onclick="window.print()">Print / Save PDF</button>
</div>
<h1>${escHtml(projectName)}</h1>
${bodyHtml}
<script>
const md = \`${mdEscaped}\`;
function dlMarkdown() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([md], {type:'text/markdown'}));
  a.download = '${filename}';
  a.click();
}
<\/script>
</body>
</html>`;

    const tab = window.open('', '_blank');
    if (!tab) { alert('Pop-up blocked — please allow pop-ups for this site.'); return; }
    tab.document.write(html);
    tab.document.close();
}

function escHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setupTooltips() {
    const tip = document.getElementById('cs-tooltip');
    if (!tip) return;

    let showTimer = null;

    function show(text, x, y) {
        tip.textContent = text;
        tip.style.display = 'block';
        position(x, y);
    }

    function position(x, y) {
        const GAP_ABOVE = 14;
        const GAP_BELOW = 28; // extra clearance so the cursor arrow doesn't overlap
        tip.style.left = '0';
        tip.style.top = '0';
        tip.style.display = 'block';
        const tw = tip.offsetWidth;
        const th = tip.offsetHeight;
        let left = x - tw / 2;
        let top  = y - th - GAP_ABOVE;
        // Keep within viewport
        if (left < 6) left = 6;
        if (left + tw > window.innerWidth - 6) left = window.innerWidth - 6 - tw;
        if (top < 6) top = y + GAP_BELOW; // flip below if near top
        tip.style.left = left + 'px';
        tip.style.top  = top  + 'px';
    }

    function hide() {
        clearTimeout(showTimer);
        tip.style.display = 'none';
    }

    document.addEventListener('mousemove', (e) => {
        if (tip.style.display === 'block') {
            position(e.clientX, e.clientY);
        }
    });

    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest('[data-tooltip]');
        if (!target) return;
        const text = target.dataset.tooltip;
        if (!text) return;
        clearTimeout(showTimer);
        showTimer = setTimeout(() => show(text, e.clientX, e.clientY), 500);
    });

    document.addEventListener('mouseout', (e) => {
        const target = e.target.closest('[data-tooltip]');
        if (!target) return;
        const related = e.relatedTarget;
        if (related && target.contains(related)) return;
        hide();
    });

    // Hide on any click or scroll
    document.addEventListener('mousedown', hide);
    document.addEventListener('wheel', hide, { passive: true });
}

function setupMenuHandlers() {
    const projectNameEl = document.getElementById('project-name');
    const newMenuItem = document.getElementById('menu-new');
    const openMenuItem = document.getElementById('menu-open');
    const closeMenuItem = document.getElementById('menu-close');
    const deleteCardsMenuItem = document.getElementById('menu-delete-cards');
    const deletePaletteMenuItem = document.getElementById('menu-delete-palette');
    const deleteProjectMenuItem = document.getElementById('menu-delete-project');
    const showLogMenuItem = document.getElementById('menu-show-log');
    const logModal = document.getElementById('log-modal');
    const logCloseBtn = document.getElementById('log-close');
    const logClearBtn = document.getElementById('log-clear');

    // Populate the Open submenu on hover
    if (openMenuItem) {
        openMenuItem.addEventListener('mouseenter', () => {
            populateOpenSubmenu();
        });
    }

    if (newMenuItem) {
        newMenuItem.addEventListener('click', async (e) => {
            e.preventDefault();

            try {
                // Check if user is authenticated
                if (!auth.isAuthenticated()) {
                    // Show registration dialog
                    const result = await showRegistrationDialog('To create a project, please register:');
                    await auth.register(result.email, result.name, result.initials);
                }

                // Show identity selection
                const identities = await auth.getIdentities();
                const identity = await showIdentityDialog(
                    identities,
                    'Select Identity for New Project',
                    'Choose which identity to use:',
                    async (name, initials) => {
                        // Conflict checker - for new project, no conflicts possible
                        return { conflict: false };
                    }
                );

                // Create project
                const projectId = generateProjectId();

                // Set current identity FIRST
                auth.setCurrentIdentity(identity.name, identity.initials);
                currentUserInitials = identity.initials;

                // Open project with skipIdentityCheck=true since we just set it
                // This will trigger socket connection which creates the project on server
                await openProject(projectId, true);

                // Join the project (register user in project after it's been created)
                await auth.joinProject(projectId, identity.name, identity.initials);

            } catch (err) {
                if (err.message !== 'Registration cancelled' && err.message !== 'Identity selection cancelled') {
                    console.error('Error creating project:', err);
                    alert('Failed to create project: ' + err.message);
                }
            }
        });
    }

    if (closeMenuItem) {
        closeMenuItem.addEventListener('click', (e) => {
            e.preventDefault();
            if (isProjectOpen && confirm('Close the current project?')) {
                localStorage.removeItem('lastProjectId');
                closeProject();
            }
        });
    }

    const exportReportMenuItem = document.getElementById('menu-export-report');
    if (exportReportMenuItem) {
        exportReportMenuItem.addEventListener('click', (e) => {
            e.preventDefault();
            if (!isProjectOpen) { alert('No project is open.'); return; }
            generateReport();
        });
    }

    const leaveProjectMenuItem = document.getElementById('menu-leave-project');
    if (leaveProjectMenuItem) {
        leaveProjectMenuItem.addEventListener('click', async (e) => {
            e.preventDefault();
            if (!isProjectOpen) {
                alert('No project is open');
                return;
            }
            if (!auth.isAuthenticated()) {
                alert('You must be authenticated to leave a project');
                return;
            }

            const identity = auth.getCurrentIdentity();
            const identityText = identity ? `${identity.name} (${identity.initials})` : 'your identity';

            if (confirm(`Leave this project as ${identityText}? You can rejoin later with a different identity.`)) {
                try {
                    // Call server API to remove user from project
                    const response = await fetch(`/api/project/${currentProjectId}/user/${auth.userHash}/leave`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });

                    if (!response.ok) {
                        throw new Error('Failed to leave project');
                    }

                    // Close the project locally
                    localStorage.removeItem('lastProjectId');
                    closeProject();

                    debugLog.info('Left project', { projectId: currentProjectId });
                    alert('You have left this project. You can rejoin with a different identity if needed.');

                } catch (err) {
                    console.error('Error leaving project:', err);
                    alert('Failed to leave project: ' + err.message);
                }
            }
        });
    }

    if (deleteCardsMenuItem) {
        deleteCardsMenuItem.addEventListener('click', (e) => {
            e.preventDefault();
            if (!isProjectOpen) {
                alert('No project is open');
                return;
            }
            if (confirm('Delete all cards in this project? This cannot be undone.')) {
                // Delete all cards from local state
                const cardIds = Array.from(appState.cards.keys());
                cardIds.forEach(cardId => {
                    const card = appState.getCard(cardId);
                    if (card && card.element) {
                        card.element.remove();
                    }
                    appState.cards.delete(cardId);
                });

                // Emit to server to delete all cards
                if (socket) {
                    socket.emit('cards:delete-all', { projectId: currentProjectId });
                }

                debugLog.info('Deleted all cards', { count: cardIds.length });
            }
        });
    }

    if (deletePaletteMenuItem) {
        deletePaletteMenuItem.addEventListener('click', (e) => {
            e.preventDefault();
            if (!isProjectOpen) {
                alert('No project is open');
                return;
            }
            if (confirm('Delete all palette cards? This cannot be undone.')) {
                // Clear local palette
                appState.paletteCards = [];
                renderPaletteCards();

                // Emit to server
                if (socket) {
                    socket.emit('palette:delete-all', { projectId: currentProjectId });
                }

                debugLog.info('Deleted all palette cards');
            }
        });
    }

    if (deleteProjectMenuItem) {
        deleteProjectMenuItem.addEventListener('click', (e) => {
            e.preventDefault();
            if (confirm('Delete this entire project? This cannot be undone.')) {
                socket.emit('project:delete', { projectId: currentProjectId });
                setTimeout(() => closeProject(), 100);
            }
        });
    }

    if (projectNameEl) {
        projectNameEl.addEventListener('change', () => {
            const newName = projectNameEl.value.trim();
            if (newName && socket) {
                socket.emit('project:rename', { projectId: currentProjectId, name: newName });
                appState.projectName = newName;
            }
        });

        projectNameEl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                projectNameEl.blur();
            }
        });
    }

    if (showLogMenuItem) {
        showLogMenuItem.addEventListener('click', (e) => {
            e.preventDefault();
            if (logModal) {
                logModal.style.display = 'block';
                debugLog.updateDisplay();
            }
        });
    }

    if (logCloseBtn) {
        logCloseBtn.addEventListener('click', () => {
            if (logModal) logModal.style.display = 'none';
        });
    }

    if (logClearBtn) {
        logClearBtn.addEventListener('click', () => {
            debugLog.clear();
        });
    }
}

// ============================================================================
// ZOOM CONTROLS
// ============================================================================

function zoomToFit() {
    const MAX_COORD = 500000;
    const cards = Array.from(appState.cards.values()).filter(
        c => isFinite(c.x) && isFinite(c.y) && Math.abs(c.x) <= MAX_COORD && Math.abs(c.y) <= MAX_COORD
    );
    const wormholes = Array.from(appState.wormholes.values()).filter(
        w => isFinite(w.x) && isFinite(w.y) && Math.abs(w.x) <= MAX_COORD && Math.abs(w.y) <= MAX_COORD
    );
    const CARD_W = 150, CARD_H = 120, WORM_W = 160, WORM_H = 100, PADDING = 100;

    if (cards.length === 0 && wormholes.length === 0) {
        viewportManager.currentZoom = 1.0;
        viewportManager.panTo(0, 0);
        viewportManager.saveManualZoom();
        return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const card of cards) {
        minX = Math.min(minX, card.x - PADDING);
        minY = Math.min(minY, card.y - PADDING);
        maxX = Math.max(maxX, card.x + CARD_W + PADDING);
        maxY = Math.max(maxY, card.y + CARD_H + PADDING);
    }
    for (const w of wormholes) {
        minX = Math.min(minX, w.x - PADDING);
        minY = Math.min(minY, w.y - PADDING);
        maxX = Math.max(maxX, w.x + WORM_W + PADDING);
        maxY = Math.max(maxY, w.y + WORM_H + PADDING);
    }

    const boundsW = maxX - minX;
    const boundsH = maxY - minY;
    const rect = viewportManager.viewport.getBoundingClientRect();
    const style = window.getComputedStyle(viewportManager.viewport);
    const pad = parseFloat(style.paddingLeft);
    const viewW = rect.width - pad * 2;
    const viewH = rect.height - pad * 2;

    const targetZoom = Math.min(viewW / boundsW, viewH / boundsH, viewportManager.MAX_ZOOM);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    // Never zoom out so far that cards become invisible (min 5%)
    viewportManager.currentZoom = Math.max(0.05, targetZoom);
    viewportManager.panTo(centerX, centerY);
    viewportManager.saveManualZoom();
}

function setupZoomControls() {
    const zoomOutBtn = document.getElementById('zoom-out-btn');
    const zoomInBtn = document.getElementById('zoom-in-btn');
    const centerBtn = document.getElementById('center-btn');

    let zoomInterval = null;

    // Helper to stop zooming
    const stopZooming = () => {
        if (zoomInterval) {
            clearInterval(zoomInterval);
            zoomInterval = null;
            viewportManager.saveManualZoom();
        }
    };

    // Global mouseup to stop zooming if user releases outside button
    document.addEventListener('mouseup', stopZooming);

    if (zoomOutBtn) {
        // Start continuous zoom out on mousedown
        zoomOutBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();

            // Initial zoom
            viewportManager.zoomOut();

            // Start continuous zooming
            zoomInterval = setInterval(() => {
                viewportManager.zoomOut();
            }, 100); // Zoom every 100ms
        });

        // Stop zooming on mouseup or mouseleave
        zoomOutBtn.addEventListener('mouseup', stopZooming);
        zoomOutBtn.addEventListener('mouseleave', stopZooming);
    }

    if (zoomInBtn) {
        // Start continuous zoom in on mousedown
        zoomInBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();

            // Initial zoom
            viewportManager.zoomIn();

            // Start continuous zooming
            zoomInterval = setInterval(() => {
                viewportManager.zoomIn();
            }, 100); // Zoom every 100ms
        });

        // Stop zooming on mouseup or mouseleave
        zoomInBtn.addEventListener('mouseup', stopZooming);
        zoomInBtn.addEventListener('mouseleave', stopZooming);
    }

    if (centerBtn) {
        centerBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Single click: pan to workspace origin at current zoom
            // Double-click (detected via dblclick) resets zoom to 1 as well
            viewportManager.panTo(0, 0);
        });

        centerBtn.addEventListener('dblclick', (e) => {
            e.preventDefault();
            viewportManager.currentZoom = 1.0;
            viewportManager.panTo(0, 0);
            viewportManager.saveManualZoom();
        });
    }
}

// ============================================================================
// TOOLBAR BUTTONS (ZOOM-SEARCH, WORMHOLE)
// ============================================================================

function setupToolbarButtons() {
    const zoomSearchBtn = document.getElementById('zoom-search-btn');
    const wormholeBtn = document.getElementById('wormhole-btn');

    // Zoom-to-fit: zoom and pan to show all cards
    if (zoomSearchBtn) {
        zoomSearchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            zoomToFit();
        });
    }

    // Wormhole palette item (draggable)
    const wormholePaletteItem = document.getElementById('wormhole-palette-item');
    const wormholeElement = wormholePaletteItem || wormholeBtn; // Support both old toolbar and new palette

    if (wormholeElement) {
        wormholeElement.addEventListener('mousedown', (e) => {
            e.preventDefault();

            const viewportContent = document.querySelector('.viewport-content');

            // Create ghost element with galaxy image
            const ghost = document.createElement('div');
            ghost.style.position = 'fixed';
            ghost.style.pointerEvents = 'none';
            ghost.style.zIndex = '10000';
            ghost.style.width = '160px';
            ghost.style.height = '100px';
            ghost.style.opacity = '0.8';
            ghost.style.borderRadius = '8px';
            ghost.style.overflow = 'hidden';
            ghost.style.boxShadow = '0 4px 20px rgba(0, 206, 209, 0.5)';
            ghost.innerHTML = '<img src="/images/wormhole-galaxy.svg" style="width:100%;height:100%;object-fit:cover;">';
            ghost.style.left = (e.clientX - 80) + 'px';
            ghost.style.top = (e.clientY - 50) + 'px';
            document.body.appendChild(ghost);

            let dragStartTime = Date.now();

            // Start auto-zoom animation
            const zoomLoop = () => {
                const now = Date.now();
                if (now - dragStartTime >= 1500) {
                    viewportManager.zoomOutGradual();
                }
                wormholeZoomAnimationFrame = requestAnimationFrame(zoomLoop);
                window.wormholeZoomAnimationFrame = wormholeZoomAnimationFrame;
            };
            wormholeZoomAnimationFrame = requestAnimationFrame(zoomLoop);
            window.wormholeZoomAnimationFrame = wormholeZoomAnimationFrame;

            const onMouseMove = (moveEvent) => {
                ghost.style.left = (moveEvent.clientX - 80) + 'px';
                ghost.style.top = (moveEvent.clientY - 50) + 'px';
                viewportManager.autoPan(moveEvent.clientX, moveEvent.clientY);
            };

            const onMouseUp = async (upEvent) => {
                cancelAnimationFrame(wormholeZoomAnimationFrame);
                wormholeZoomAnimationFrame = null;
                window.wormholeZoomAnimationFrame = null;
                ghost.remove();
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);

                // Check if dropped on viewport
                if (viewportManager.isInViewport(upEvent.clientX, upEvent.clientY)) {
                    const dropPos = CoordinateSystem.screenToWorkspaceNoPan(
                        upEvent.clientX,
                        upEvent.clientY,
                        viewportManager.viewport,
                        viewportManager.currentZoom
                    );

                    // Restore manual zoom level
                    viewportManager.restoreManualZoom();

                    try {
                        // Show naming dialog
                        const names = await showWormholeNamingDialog();

                        // Create wormhole pair - server will assign z-index
                        const wormhole1Id = 'wormhole-' + Date.now() + '-1';
                        const wormhole2Id = 'wormhole-' + Date.now() + '-2';

                        const wormhole1 = new Wormhole(dropPos.x, dropPos.y, wormhole1Id, wormhole2Id, names.end1);
                        const wormhole2 = new Wormhole(dropPos.x + 5, dropPos.y + 5, wormhole2Id, wormhole1Id, names.end2);

                        // Render both
                        viewportContent.appendChild(wormhole1.render(viewportManager));
                        viewportContent.appendChild(wormhole2.render(viewportManager));

                        // Add to state
                        appState.addWormhole(wormhole1);
                        appState.addWormhole(wormhole2);

                        // Setup drag handlers
                        setupWormholeDragHandlers(wormhole1);
                        setupWormholeDragHandlers(wormhole2);

                        // Emit to server
                        socket.emit('wormhole:add', wormhole1.serialize());
                        socket.emit('wormhole:add', wormhole2.serialize());

                        debugLog.info('Wormhole pair created', { wormhole1Id, wormhole2Id, names });
                    } catch (err) {
                        if (err.message !== 'Wormhole naming cancelled') {
                            debugLog.error('Error creating wormhole', err);
                        } else {
                            debugLog.info('Wormhole creation cancelled');
                        }
                    }
                }
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    // Add Card button - opens modal to create palette card
    const addCardBtn = document.getElementById('add-card-btn');
    if (addCardBtn) {
        addCardBtn.addEventListener('click', (e) => {
            e.preventDefault();

            if (!isProjectOpen) {
                alert('Please open or create a project first');
                return;
            }

            // Show the card creation modal
            const modal = document.getElementById('card-modal');
            const cardTypeInput = document.getElementById('card-type');

            if (modal && cardTypeInput) {
                cardTypeInput.value = '';
                modal.style.display = 'flex';
                cardTypeInput.focus();
            }
        });
    }
}

// ============================================================================
// WORKSPACE SCAN / NAVIGATE
// ============================================================================

function setupScanControls() {
    let scanList = [];
    let scanIndex = -1;

    const startBtn  = document.getElementById('scan-start-btn');
    const prevBtn   = document.getElementById('scan-prev-btn');
    const nextBtn   = document.getElementById('scan-next-btn');
    const counter   = document.getElementById('scan-counter');

    function cardBounds(cards, padding = 60) {
        const CARD_W = 150, CARD_H = 120;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const c of cards) {
            minX = Math.min(minX, c.x - padding);
            minY = Math.min(minY, c.y - padding);
            maxX = Math.max(maxX, c.x + CARD_W + padding);
            maxY = Math.max(maxY, c.y + CARD_H + padding);
        }
        return { minX, minY, maxX, maxY };
    }

    function buildList() {
        const allCards = Array.from(appState.cards.values());
        if (allCards.length === 0) return [];

        const items = [];
        const visited = new Set();

        // Constellation groups (2+ cards)
        if (window.constellationManager) {
            for (const [constId, cardIdSet] of window.constellationManager.constellations) {
                if (cardIdSet.size < 2) continue;
                const cards = Array.from(cardIdSet).map(id => appState.cards.get(id)).filter(Boolean);
                if (cards.length < 2) continue;
                items.push({ type: 'constellation', cards, bounds: cardBounds(cards) });
                cards.forEach(c => visited.add(c.id));
            }
        }

        // Standalone cards — skip any with invalid or wildly out-of-range coordinates
        const MAX_COORD = 500000;
        for (const card of allCards) {
            if (!visited.has(card.id)) {
                if (!isFinite(card.x) || !isFinite(card.y)) continue;
                if (Math.abs(card.x) > MAX_COORD || Math.abs(card.y) > MAX_COORD) continue;
                items.push({ type: 'card', cards: [card], bounds: cardBounds([card], 0) });
            }
        }

        // Sort reading order: rows (150px buckets) top-to-bottom, then left-to-right within row
        const ROW_HEIGHT = 150;
        items.sort((a, b) => {
            const aRow = Math.floor(a.bounds.minY / ROW_HEIGHT);
            const bRow = Math.floor(b.bounds.minY / ROW_HEIGHT);
            if (aRow !== bRow) return aRow - bRow;
            return a.bounds.minX - b.bounds.minX;
        });

        return items;
    }

    function navigateTo(item) {
        const { minX, minY, maxX, maxY } = item.bounds;
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;

        if (item.type === 'card') {
            // Single card: use a comfortable zoom (at least 0.8, respect manual zoom up to 1.5)
            const zoom = Math.max(0.8, Math.min(1.5, viewportManager.manualZoom));
            viewportManager.currentZoom = zoom;
        } else {
            // Constellation: zoom to fit bounding box
            const boundsW = maxX - minX;
            const boundsH = maxY - minY;
            const rect = viewportManager.viewport.getBoundingClientRect();
            const style = window.getComputedStyle(viewportManager.viewport);
            const pad = parseFloat(style.paddingLeft);
            const viewW = rect.width - pad * 2;
            const viewH = rect.height - pad * 2;
            const fit = Math.min(viewW / boundsW, viewH / boundsH, viewportManager.MAX_ZOOM);
            viewportManager.currentZoom = Math.max(viewportManager.MIN_ZOOM, fit);
        }

        viewportManager.panTo(cx, cy);
        viewportManager.saveManualZoom();
        updateUI();
    }

    function updateUI() {
        if (prevBtn) prevBtn.disabled = scanList.length === 0 || scanIndex <= 0;
        if (nextBtn) nextBtn.disabled = scanList.length === 0 || scanIndex >= scanList.length - 1;
        if (counter) {
            counter.textContent = scanList.length > 0 ? `${scanIndex + 1}/${scanList.length}` : '';
        }
    }

    // Exposed so project open/close can reset state
    window._resetScan = () => {
        scanList = [];
        scanIndex = -1;
        updateUI();
    };

    if (startBtn) {
        startBtn.addEventListener('click', () => {
            scanList = buildList();
            if (scanList.length === 0) return;
            scanIndex = 0;
            navigateTo(scanList[scanIndex]);
        });
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (scanIndex > 0) {
                scanIndex--;
                navigateTo(scanList[scanIndex]);
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (scanIndex < scanList.length - 1) {
                scanIndex++;
                navigateTo(scanList[scanIndex]);
            }
        });
    }

    updateUI();
}

// ============================================================================
// VIEWPORT DRAG (PANNING)
// ============================================================================

function setupViewportDrag() {
    const viewport = viewportManager.viewport;
    const viewportContent = viewportManager.viewportContent;
    let isPanning = false;
    let panStartX, panStartY, panOffsetX, panOffsetY;

    viewport.addEventListener('mousedown', (e) => {
        // Don't pan if clicking on a wormhole or card
        if (e.target.closest('.wormhole-portal') || e.target.closest('.viewport-card')) {
            return;
        }

        if (e.target === viewport || e.target === viewportContent) {
            isPanning = true;
            panStartX = e.clientX;
            panStartY = e.clientY;
            panOffsetX = viewportManager.currentPan.x;
            panOffsetY = viewportManager.currentPan.y;
            viewport.style.cursor = 'grabbing';
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (!isPanning) return;

        const dx = e.clientX - panStartX;
        const dy = e.clientY - panStartY;

        viewportManager.currentPan.x = panOffsetX + dx;
        viewportManager.currentPan.y = panOffsetY + dy;
        viewportManager.applyTransform();
    });

    document.addEventListener('mouseup', () => {
        if (isPanning) {
            isPanning = false;
            viewport.style.cursor = '';

            // Update focal point to match the new pan position
            // This ensures the viewport position persists after reload
            viewportManager.focalPoint.x = -viewportManager.currentPan.x / viewportManager.currentZoom;
            viewportManager.focalPoint.y = -viewportManager.currentPan.y / viewportManager.currentZoom;

            // Save as manual state
            viewportManager.saveManualZoom();

            // Save viewport position to localStorage
            if (appState.projectId) {
                const viewportState = {
                    focalPoint: { ...viewportManager.focalPoint },
                    zoom: viewportManager.currentZoom
                };
                localStorage.setItem(`viewport_${appState.projectId}`, JSON.stringify(viewportState));
                debugLog.info('Viewport position saved to localStorage', viewportState);
            }

            debugLog.info('Viewport panned, focal point updated', {
                focalPoint: { ...viewportManager.focalPoint },
                pan: { ...viewportManager.currentPan }
            });
        }
    });

    // Scroll wheel zoom
    viewport.addEventListener('wheel', (e) => {
        e.preventDefault();

        // Set focal point to mouse position
        viewportManager.setFocalPointFromEvent(e);

        // Zoom in/out based on scroll direction
        const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1; // Scroll down = zoom out, scroll up = zoom in
        viewportManager.zoomTo(viewportManager.currentZoom * zoomDelta);

        // Save as manual zoom (user's preferred zoom level)
        viewportManager.saveManualZoom();

        debugLog.info('Scroll wheel zoom', {
            zoom: viewportManager.currentZoom,
            focalPoint: viewportManager.focalPoint
        });
    }, { passive: false }); // passive: false allows preventDefault
}

// ============================================================================
// EDIT MODAL
// ============================================================================

/**
 * Extract text from contenteditable element, preserving line breaks
 */
function getContentEditableText(element) {
    // Clone the element to avoid modifying the original
    const clone = element.cloneNode(true);

    // Replace <div> and <br> with newlines
    clone.querySelectorAll('div').forEach(div => {
        div.insertAdjacentText('beforebegin', '\n');
    });
    clone.querySelectorAll('br').forEach(br => {
        br.replaceWith('\n');
    });

    return clone.textContent || '';
}

/**
 * Set text in contenteditable element, converting newlines to proper HTML
 */
function setContentEditableText(element, text) {
    // Convert newlines to <br> tags for display
    element.innerHTML = '';
    const lines = text.split('\n');
    lines.forEach((line, index) => {
        element.appendChild(document.createTextNode(line));
        if (index < lines.length - 1) {
            element.appendChild(document.createElement('br'));
        }
    });
}

function setupEditModal() {
    const editModal = document.getElementById('edit-modal');
    const editCardHeader = document.getElementById('edit-card-header');
    const editCardBody = document.getElementById('edit-card-body');
    const editCardVisual = document.getElementById('edit-card-visual');
    const editSave = document.getElementById('edit-save');
    const editClose = document.getElementById('edit-close');
    const editDelete = document.getElementById('edit-delete');

    // Move edit modal into viewport-content so it inherits transforms
    const viewportContent = document.querySelector('.viewport-content');
    if (viewportContent && editModal && !viewportContent.contains(editModal)) {
        viewportContent.appendChild(editModal);
        debugLog.info('Moved edit modal into viewport-content');
    }

    // Prevent Enter key in header from creating newline - move to body instead
    if (editCardHeader) {
        editCardHeader.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                editCardBody.focus();
                // Move cursor to start of body
                const range = document.createRange();
                const sel = window.getSelection();
                range.setStart(editCardBody, 0);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        });
    }

    // Listen for custom card:edit event
    document.addEventListener('card:edit', (e) => {
        const card = e.detail.card;
        const mouseEvent = e.detail.mouseEvent;

        editCardHeader.textContent = card.header;
        setContentEditableText(editCardBody, card.body);
        editModal.dataset.editingCardId = card.id;

        // Set the card color on the visual preview
        if (editCardVisual) {
            editCardVisual.style.backgroundColor = card.color;

            // Calculate and set text color based on background brightness
            const textColor = card.getTextColor();
            editCardHeader.style.color = textColor;
            editCardBody.style.color = textColor;
        }

        // Position and size modal exactly to match the card
        if (card.element) {
            // Convert workspace coordinates to CSS coordinates (same as cards use)
            const cssPos = CoordinateSystem.workspaceToCSS(card.x, card.y, viewportManager.viewport);

            // Position modal in CSS coordinates (so it follows viewport transforms)
            editModal.style.display = 'block';
            editModal.style.position = 'absolute';
            editModal.style.left = cssPos.x + 'px';
            editModal.style.top = cssPos.y + 'px';
            editModal.style.transform = 'none';

            // Get current zoom for sizing
            const zoom = viewportManager.zoom;

            // Match the card's natural size scaled by zoom
            const cardWidth = 150;
            const cardHeight = 120;

            editCardVisual.style.width = cardWidth + 'px';
            editCardVisual.style.height = cardHeight + 'px';
            editCardVisual.style.minHeight = 'unset';
            editCardVisual.style.maxHeight = 'unset';

            // Font sizes already match the card's base sizes (no zoom scaling needed)
            editCardHeader.style.fontSize = '11px';
            editCardBody.style.fontSize = '9px';

            // Scale spacing
            editCardHeader.style.marginBottom = '4px';
        } else if (mouseEvent) {
            // Fallback to mouse position if card element not available
            const modalWidth = 150;
            const modalHeight = 100;

            let left = mouseEvent.clientX - modalWidth / 2;
            let top = mouseEvent.clientY - modalHeight / 2;

            editModal.style.display = 'block';
            editModal.style.position = 'fixed';
            editModal.style.left = left + 'px';
            editModal.style.top = top + 'px';
            editModal.style.transform = 'none';
        } else {
            // Fallback to centered if no mouse event
            editModal.style.display = 'flex';
            editModal.style.position = 'fixed';
            editModal.style.left = '50%';
            editModal.style.top = '50%';
            editModal.style.transform = 'translate(-50%, -50%)';
        }

        editCardHeader.focus();
    });

    if (editSave) {
        editSave.addEventListener('click', () => {
            const cardId = editModal.dataset.editingCardId;
            const card = appState.getCard(cardId);

            if (card) {
                const newHeader = editCardHeader.textContent.trim();
                const newBody = getContentEditableText(editCardBody).trim();

                card.updateContent(newHeader, newBody);

                // If this is a new unsaved card, broadcast it as a new card
                if (card.isUnsaved) {
                    delete card.isUnsaved;
                    socket.emit('viewport:add', card.serialize());
                } else {
                    // Existing card - just update
                    socket.emit('viewport:update', {
                        id: cardId,
                        header: newHeader,
                        body: newBody
                    });
                }

                // Make the elevated z-index permanent on save (green check)
                if (card._preSelectZIndex !== undefined) {
                    const newZ = (appState.maxZIndex || 1000) + 1;
                    card.zIndex = newZ;
                    appState.maxZIndex = newZ;
                    card.element.style.zIndex = String(newZ);
                    delete card._preSelectZIndex;
                    socket.emit('viewport:move', { id: cardId, x: card.x, y: card.y, zIndex: newZ });
                }

                editModal.style.display = 'none';
                editModal.dataset.editingCardId = '';
            }
        });
    }

    if (editClose) {
        editClose.addEventListener('click', () => {
            const cardId = editModal.dataset.editingCardId;
            const card = appState.getCard(cardId);

            // Revert z-index on red X (cancel)
            if (card && card._preSelectZIndex !== undefined) {
                card.element.style.zIndex = String(card._preSelectZIndex);
                delete card._preSelectZIndex;
            }

            if (card && card.isUnsaved) {
                // This is an unsaved card - Close (×) means cancel/delete it
                if (card.element) {
                    card.element.remove();
                }
                appState.cards.delete(cardId);
                debugLog.info('Cancelled unsaved card', { id: cardId });
            } else if (card) {
                // Existing card - Close (×) means save and close
                const newHeader = editCardHeader.textContent.trim();
                const newBody = getContentEditableText(editCardBody).trim();

                card.updateContent(newHeader, newBody);

                socket.emit('viewport:update', {
                    id: cardId,
                    header: newHeader,
                    body: newBody
                });
            }

            editModal.style.display = 'none';
            editModal.dataset.editingCardId = '';
        });
    }

    // Delete button
    if (editDelete) {
        editDelete.addEventListener('click', () => {
            const cardId = editModal.dataset.editingCardId;
            const card = appState.getCard(cardId);

            if (card) {
                // Remove from DOM
                if (card.element) {
                    card.element.remove();
                }

                // Remove from state
                appState.cards.delete(cardId);

                // Emit to server
                socket.emit('card:delete', { id: cardId });

                // Close modal
                editModal.style.display = 'none';
                editModal.dataset.editingCardId = '';

                debugLog.info('Card deleted', { id: cardId });
            }
        });
    }

    // Click outside modal to cancel unsaved cards or save existing cards
    editModal.addEventListener('click', (e) => {
        // Only close if clicking the modal background (not the content)
        if (e.target === editModal) {
            const cardId = editModal.dataset.editingCardId;
            const card = appState.getCard(cardId);

            if (card && card.isUnsaved) {
                // This is an unsaved card - clicking outside cancels/deletes it
                if (card.element) {
                    card.element.remove();
                }
                appState.cards.delete(cardId);
                debugLog.info('Cancelled unsaved card (clicked outside)', { id: cardId });
            } else if (card) {
                // Existing card - clicking outside saves and closes
                const newHeader = editCardHeader.textContent.trim();
                const newBody = getContentEditableText(editCardBody).trim();

                card.updateContent(newHeader, newBody);

                socket.emit('viewport:update', {
                    id: cardId,
                    header: newHeader,
                    body: newBody
                });
            }

            editModal.style.display = 'none';
            editModal.dataset.editingCardId = '';
        }
    });
}

// ============================================================================
// CARD CREATION MODAL
// ============================================================================

function setupCardCreationModal() {
    const modal = document.getElementById('card-modal');
    const cardTypeInput = document.getElementById('card-type');
    const colorWheel = document.getElementById('color-wheel');
    const colorPreview = document.getElementById('color-preview');
    const modalOk = document.getElementById('modal-ok');
    const modalCancel = document.getElementById('modal-cancel');

    let selectedColor = '#ff6b6b'; // Default red

    // Draw color wheel
    if (colorWheel) {
        const ctx = colorWheel.getContext('2d');
        const centerX = colorWheel.width / 2;
        const centerY = colorWheel.height / 2;
        const radius = centerX - 10;

        // Draw rainbow circle
        for (let angle = 0; angle < 360; angle++) {
            const startAngle = (angle - 90) * Math.PI / 180;
            const endAngle = (angle - 89) * Math.PI / 180;

            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, startAngle, endAngle);
            ctx.closePath();
            ctx.fillStyle = `hsl(${angle}, 100%, 50%)`;
            ctx.fill();
        }

        // Add click handler to select color
        colorWheel.addEventListener('click', (e) => {
            const rect = colorWheel.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const dx = x - centerX;
            const dy = y - centerY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance <= radius) {
                const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
                selectedColor = `hsl(${angle}, 100%, 50%)`;

                // Convert HSL to hex for storage
                const tempDiv = document.createElement('div');
                tempDiv.style.color = selectedColor;
                document.body.appendChild(tempDiv);
                const computedColor = getComputedStyle(tempDiv).color;
                document.body.removeChild(tempDiv);

                // Parse rgb(r, g, b) to hex
                const rgb = computedColor.match(/\d+/g);
                if (rgb) {
                    selectedColor = '#' + rgb.map(x => {
                        const hex = parseInt(x).toString(16);
                        return hex.length === 1 ? '0' + hex : hex;
                    }).join('');
                }

                if (colorPreview) {
                    colorPreview.style.backgroundColor = selectedColor;
                }
            }
        });

        // Set initial preview color
        if (colorPreview) {
            colorPreview.style.backgroundColor = selectedColor;
        }
    }

    // OK button - create palette card
    if (modalOk) {
        modalOk.addEventListener('click', () => {
            const cardType = cardTypeInput.value.trim();

            if (!cardType) {
                alert('Please enter a card type name');
                return;
            }

            // Create palette card
            const paletteCard = {
                type: cardType,
                color: selectedColor
            };

            // Add to server state
            if (socket) {
                socket.emit('palette:add', paletteCard);
            }

            // Add to local state and render
            appState.paletteCards = appState.paletteCards || [];
            appState.paletteCards.push(paletteCard);
            renderPaletteCards();

            // Close modal
            modal.style.display = 'none';
            cardTypeInput.value = '';

            debugLog.info('Palette card created', paletteCard);
        });
    }

    // Cancel button
    if (modalCancel) {
        modalCancel.addEventListener('click', () => {
            modal.style.display = 'none';
            cardTypeInput.value = '';
        });
    }

    // Close on outside click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
            cardTypeInput.value = '';
        }
    });

    // Enter key to submit
    if (cardTypeInput) {
        cardTypeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                modalOk.click();
            }
        });
    }
}

// ============================================================================
// PALETTE RENDERING
// ============================================================================

function renderPaletteCards() {
    const cardList = document.getElementById('card-list');
    if (!cardList) return;

    // Clear existing palette cards
    cardList.innerHTML = '';

    // Get current palette scale
    const palette = cardList.closest('.palette');
    const currentScale = parseFloat(palette?.dataset.scale) || 1.0;
    const baseMargin = 30; // margin-bottom on card-stack

    // Render each palette card
    const paletteCards = appState.paletteCards || [];
    paletteCards.forEach(paletteCard => {
        // Create stack container
        const stackEl = document.createElement('div');
        stackEl.className = 'card-stack';
        stackEl.style.backgroundColor = paletteCard.color;

        // Apply current scale to stack margin
        stackEl.style.marginBottom = `${baseMargin * currentScale}px`;

        // Create the actual card
        const cardEl = document.createElement('div');
        cardEl.className = 'palette-card';
        cardEl.draggable = true;
        cardEl.dataset.cardType = paletteCard.type;
        cardEl.dataset.cardColor = paletteCard.color;
        cardEl.dataset.tooltip = `${paletteCard.type} — drag onto the workspace to place a new card of this type`;
        cardEl.style.backgroundColor = paletteCard.color;

        // Calculate text color based on background brightness
        const hex = paletteCard.color.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        cardEl.style.color = luminance > 0.5 ? '#000000' : '#FFFFFF';

        cardEl.textContent = paletteCard.type;

        stackEl.appendChild(cardEl);
        cardList.appendChild(stackEl);
    });

    debugLog.info('Rendered palette cards', { count: paletteCards.length, scale: currentScale });
}

// ============================================================================
// SOCKET.IO HANDLERS
// ============================================================================

function setupSocketHandlers() {
    let lastStateInitTime = 0;
    const STATE_INIT_DEBOUNCE_MS = 1000; // Ignore duplicate state:init within 1 second

    socket.on('state:init', (serverState) => {
        debugLog.info('Received state:init from server', serverState);

        // Migrate old format if needed
        serverState = migrateProjectData(serverState);

        // If we don't have a currentProjectId, ignore the state from server
        // The user must explicitly open/create a project
        if (!currentProjectId || !isProjectOpen) {
            debugLog.info('Ignoring state:init - no project is open');
            return;
        }

        // Ignore duplicate state:init events within the debounce window
        const now = Date.now();
        if (now - lastStateInitTime < STATE_INIT_DEBOUNCE_MS) {
            debugLog.info('Ignoring duplicate state:init (debounced)', {
                timeSinceLastInit: now - lastStateInitTime
            });
            return;
        }
        lastStateInitTime = now;

        // Clear existing state
        appState.clearAll();

        const projectNameEl = document.getElementById('project-name');
        const viewportContent = document.querySelector('.viewport-content');

        // Set project name - handle both string and object formats
        if (serverState.projectName) {
            // Handle both string and object formats
            let projectName;
            if (typeof serverState.projectName === 'string') {
                projectName = serverState.projectName;
            } else if (serverState.projectName && serverState.projectName.name) {
                projectName = serverState.projectName.name;
            } else {
                projectName = generateProjectName();
            }

            debugLog.info('Using server project name', { name: projectName, raw: serverState.projectName });
            projectNameEl.value = projectName;
            appState.projectName = projectName;
            saveKnownProject(currentProjectId, projectName);
        } else {
            const knownProjects = getKnownProjects();
            debugLog.info('Server has no project name, checking localStorage', {
                knownProjects,
                currentProjectId,
                hasStoredName: !!knownProjects[currentProjectId]
            });
            const name = knownProjects[currentProjectId] || generateProjectName();
            debugLog.info('Project name determined', { name, wasGenerated: !knownProjects[currentProjectId] });
            projectNameEl.value = name;
            appState.projectName = name;
            saveKnownProject(currentProjectId, name);  // Save to localStorage immediately
            socket.emit('project:rename', { projectId: currentProjectId, name });
        }

        // Load cards
        if (serverState.cards) {
            serverState.cards.forEach(cardData => {
                const card = new Card(
                    cardData.x,
                    cardData.y,
                    cardData.id,
                    cardData.header,
                    cardData.body,
                    cardData.color,
                    cardData.authorInitials,
                    cardData.zIndex
                );

                viewportContent.appendChild(card.render(viewportManager));
                appState.addCard(card);
                setupCardDragHandlers(card);
            });
        }

        // Load wormholes
        if (serverState.wormholes) {
            serverState.wormholes.forEach(wormholeData => {
                const wormhole = new Wormhole(
                    wormholeData.x,
                    wormholeData.y,
                    wormholeData.id,
                    wormholeData.partnerId,
                    wormholeData.name,
                    wormholeData.zIndex || 1
                );

                viewportContent.appendChild(wormhole.render(viewportManager));
                appState.addWormhole(wormhole);
                setupWormholeDragHandlers(wormhole);
            });
        }

        // Load maxZIndex from server
        appState.maxZIndex = serverState.maxZIndex || 1;
        debugLog.info('Loaded maxZIndex from server', { maxZIndex: appState.maxZIndex });

        // Load palette cards
        if (serverState.paletteCards) {
            appState.paletteCards = serverState.paletteCards;
            renderPaletteCards();
        }

        // Restore saved viewport position or center on cards
        const savedViewportState = localStorage.getItem(`viewport_${currentProjectId}`);

        if (savedViewportState) {
            try {
                const viewportState = JSON.parse(savedViewportState);
                debugLog.info('Restoring saved viewport position', viewportState);
                viewportManager.panTo(viewportState.focalPoint.x, viewportState.focalPoint.y);
                if (viewportState.zoom) {
                    viewportManager.zoomTo(viewportState.zoom, viewportState.focalPoint.x, viewportState.focalPoint.y);
                }
            } catch (err) {
                debugLog.error('Error restoring viewport position', err);
            }
        } else if (appState.cards.size > 0) {
            // No saved position, center viewport on cards
            debugLog.info('No saved viewport position, centering on cards', { cardCount: appState.cards.size });

            const cards = Array.from(appState.cards.values());
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

            cards.forEach(card => {
                minX = Math.min(minX, card.x);
                minY = Math.min(minY, card.y);
                maxX = Math.max(maxX, card.x + 300); // Card width ~300px
                maxY = Math.max(maxY, card.y + 400); // Card height ~400px
            });

            // Calculate center of all cards
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;

            // Pan viewport to center the cards
            viewportManager.panTo(centerX, centerY);

            debugLog.info('Centered viewport on cards', { centerX, centerY, cardCount: cards.length, minX, minY, maxX, maxY });
        } else {
            debugLog.warn('No cards to center viewport on', { cardCount: appState.cards.size });
        }

        debugLog.info('State loaded', {
            cards: appState.cards.size,
            wormholes: appState.wormholes.size,
            paletteCards: serverState.paletteCards ? serverState.paletteCards.length : 0
        });

        // Initial constellation detection after state load
        if (constellationManager && appState.cards.size > 0) {
            const cards = Array.from(appState.cards.values());
            constellationManager.updateConstellations(cards);
        }
    });

    // Card added by another user
    socket.on('viewport:add', (cardData) => {
        // Check if card already exists (avoid duplicates from our own emits)
        if (appState.getCard(cardData.id)) {
            debugLog.info('Card already exists, skipping duplicate', { id: cardData.id });
            return;
        }

        const viewportContent = document.querySelector('.viewport-content');
        const card = new Card(
            cardData.x,
            cardData.y,
            cardData.id,
            cardData.header,
            cardData.body,
            cardData.color,
            cardData.authorInitials,
            cardData.zIndex
        );

        viewportContent.appendChild(card.render(viewportManager));
        appState.addCard(card);
        setupCardDragHandlers(card);

        // Update constellations when card is added
        if (constellationManager) {
            const cards = Array.from(appState.cards.values());
            constellationManager.updateConstellationsDebounced(cards);
        }
    });

    // Wormhole added (either by us or another user)
    socket.on('wormhole:add', (wormholeData) => {
        // Check if wormhole already exists
        const existingWormhole = appState.getWormhole(wormholeData.id);
        if (existingWormhole) {
            // Update z-index from server (server is authoritative)
            if (wormholeData.zIndex !== undefined) {
                existingWormhole.zIndex = wormholeData.zIndex;
                if (existingWormhole.element) {
                    existingWormhole.element.style.zIndex = String(wormholeData.zIndex);
                }
                // Update local maxZIndex if needed
                if (wormholeData.zIndex > appState.maxZIndex) {
                    appState.maxZIndex = wormholeData.zIndex;
                }
                debugLog.info('Updated existing wormhole z-index from server', {
                    id: wormholeData.id,
                    zIndex: wormholeData.zIndex
                });
            }
            return;
        }

        const viewportContent = document.querySelector('.viewport-content');
        const wormhole = new Wormhole(
            wormholeData.x,
            wormholeData.y,
            wormholeData.id,
            wormholeData.partnerId,
            wormholeData.name,
            wormholeData.zIndex || 1
        );

        // Update local maxZIndex if needed
        if (wormholeData.zIndex && wormholeData.zIndex > appState.maxZIndex) {
            appState.maxZIndex = wormholeData.zIndex;
        }

        viewportContent.appendChild(wormhole.render(viewportManager));
        appState.addWormhole(wormhole);
        setupWormholeDragHandlers(wormhole);
    });

    // Wormhole moved by another user
    socket.on('wormhole:move', (data) => {
        const wormhole = appState.getWormhole(data.id);
        if (wormhole) {
            wormhole.x = data.x;
            wormhole.y = data.y;

            // Update z-index if provided
            if (data.zIndex !== undefined) {
                wormhole.zIndex = data.zIndex;
                if (wormhole.element) {
                    wormhole.element.style.zIndex = String(data.zIndex);
                }

                // Update local maxZIndex if needed
                if (data.zIndex > appState.maxZIndex) {
                    appState.maxZIndex = data.zIndex;
                }
            }

            wormhole.updatePosition(viewportManager);
        }
    });

    // Wormhole renamed (either by us or another user)
    socket.on('wormhole:rename', (data) => {
        const wormhole = appState.getWormhole(data.id);
        if (wormhole) {
            wormhole.name = data.name;

            // Update the label in the DOM (similar logic to Wormhole.onClick)
            if (wormhole.element) {
                const innerContainer = wormhole.element.querySelector('div');
                let label = innerContainer ? innerContainer.querySelector('div:last-child') : null;

                // Check if last child is actually a label
                if (label) {
                    const isLabel = label.textContent !== undefined && label.style.fontSize === '12px';
                    if (isLabel) {
                        label.textContent = data.name;
                    } else {
                        label = null;
                    }
                }

                // Create label if it doesn't exist
                if (!label && data.name && innerContainer) {
                    label = document.createElement('div');
                    label.style.fontSize = '12px';
                    label.style.fontWeight = 'bold';
                    label.style.color = '#333';
                    label.style.marginTop = '5px';
                    label.style.textAlign = 'center';
                    label.style.maxWidth = '110px';
                    label.style.overflow = 'hidden';
                    label.style.textOverflow = 'ellipsis';
                    label.style.whiteSpace = 'nowrap';
                    label.textContent = data.name;
                    innerContainer.appendChild(label);
                }
            }

            debugLog.info('Wormhole renamed from server', {
                id: data.id,
                name: data.name
            });
        }
    });

    // Wormhole deleted by another user (or us)
    socket.on('wormhole:delete', (data) => {
        const { id1, id2 } = data;

        // Remove both wormhole ends
        [id1, id2].forEach(id => {
            const wormhole = appState.getWormhole(id);
            if (wormhole) {
                if (wormhole.element) {
                    wormhole.element.remove();
                }
                appState.removeWormhole(id);
                debugLog.info('Wormhole deleted from server', { id });
            }
        });
    });

    // Card deleted by another user (or us)
    socket.on('card:delete', (data) => {
        const card = appState.getCard(data.id);
        if (card) {
            if (card.element) {
                card.element.remove();
            }
            appState.cards.delete(data.id);
            debugLog.info('Card deleted by remote user', { id: data.id });

            // Update constellations when card is deleted
            if (constellationManager) {
                const cards = Array.from(appState.cards.values());
                constellationManager.updateConstellationsDebounced(cards);
            }
        }
    });

    // Card moved by another user
    socket.on('viewport:move', (data) => {
        const card = appState.getCard(data.id);
        if (card) {
            card.x = data.x;
            card.y = data.y;
            card.zIndex = data.zIndex;
            card.element.style.zIndex = data.zIndex;
            card.updatePosition(viewportManager);

            // Update constellations when card is moved by another user
            if (constellationManager) {
                const cards = Array.from(appState.cards.values());
                constellationManager.updateConstellationsDebounced(cards);
            }
        }
    });

    // Card updated by another user
    socket.on('viewport:update', (data) => {
        const card = appState.getCard(data.id);
        if (card) {
            card.updateContent(data.header, data.body);
            if (data.zIndex !== undefined) {
                card.zIndex = data.zIndex;
                card.element.style.zIndex = data.zIndex;
            }
        }
    });

    // Palette card added by another user
    socket.on('palette:add', (paletteCard) => {
        appState.paletteCards = appState.paletteCards || [];

        // Check if palette card already exists
        const exists = appState.paletteCards.some(pc =>
            pc.type === paletteCard.type && pc.color === paletteCard.color
        );

        if (!exists) {
            appState.paletteCards.push(paletteCard);
            renderPaletteCards();
            debugLog.info('Palette card added from another user', paletteCard);
        }
    });

    // All cards deleted
    socket.on('cards:delete-all', () => {
        // Remove all cards from DOM
        appState.cards.forEach(card => {
            if (card.element) {
                card.element.remove();
            }
        });

        // Clear cards map
        appState.cards.clear();

        debugLog.info('All cards deleted by another user');
    });

    // All palette cards deleted
    socket.on('palette:delete-all', () => {
        appState.paletteCards = [];
        renderPaletteCards();
        debugLog.info('All palette cards deleted by another user');
    });
}

// ============================================================================
// DRAG HANDLERS FOR CARDS AND WORMHOLES
// ============================================================================

function setupCardDragHandlers(card) {
    let onMouseMove = null;
    let onMouseUp = null;

    card.element.addEventListener('mousedown', async (e) => {
        // Check write access before allowing drag
        if (!auth.hasWriteAccess()) {
            const hasAccess = await requireWriteAccess();
            if (!hasAccess) {
                e.preventDefault();
                return;
            }
        }

        card.startDrag(e, viewportManager, appState);
        appState.currentDrag = card;

        onMouseMove = (moveEvent) => {
            card.drag(moveEvent, viewportManager, appState);
        };

        onMouseUp = (upEvent) => {
            card.endDrag(upEvent, viewportManager, appState);
            appState.currentDrag = null;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

function setupWormholeDragHandlers(wormhole) {
    let onMouseMove = null;
    let onMouseUp = null;

    if (!wormhole.element) {
        debugLog.error('setupWormholeDragHandlers: wormhole.element is null', { id: wormhole.id });
        return;
    }

    debugLog.info('Setting up drag handlers for wormhole', {
        id: wormhole.id,
        className: wormhole.element.className,
        hasElement: !!wormhole.element
    });

    wormhole.element.addEventListener('mousedown', async (e) => {
        debugLog.info('Wormhole mousedown handler triggered', { id: wormhole.id, target: e.target });
        e.preventDefault();
        e.stopPropagation();

        // Check write access before allowing drag
        if (!auth.hasWriteAccess()) {
            const hasAccess = await requireWriteAccess();
            if (!hasAccess) {
                debugLog.info('No write access, aborting wormhole drag');
                return;
            }
        }

        debugLog.info('Starting wormhole drag', { id: wormhole.id });
        wormhole.startDrag(e, viewportManager, appState);
        appState.currentDrag = wormhole;

        onMouseMove = (moveEvent) => {
            wormhole.drag(moveEvent, viewportManager, appState);
        };

        onMouseUp = (upEvent) => {
            wormhole.endDrag(upEvent, viewportManager, appState);
            appState.currentDrag = null;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    // Handle double-click to teleport to partner wormhole
    wormhole.element.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();

        wormhole.onDoubleClick(e, viewportManager, appState);
    });
}

// ============================================================================
// PALETTE CARD HANDLERS
// ============================================================================

function setupPaletteCards() {
    const cardList = document.getElementById('card-list');
    if (!cardList) {
        debugLog.warn('card-list element not found');
        return;
    }

    // Use event delegation on the card-list container
    cardList.addEventListener('dragstart', async (e) => {
        const paletteCard = e.target.closest('.palette-card');
        if (!paletteCard) return;

        // Check write access before allowing drag
        if (!auth.hasWriteAccess()) {
            e.preventDefault();
            const hasAccess = await requireWriteAccess();
            if (!hasAccess) {
                return;
            }
            // If we got access, we need to restart the drag manually
            // For now, just prevent and let user try again
            return;
        }

        e.dataTransfer.effectAllowed = 'copy';
        const data = {
            type: paletteCard.dataset.cardType,
            color: paletteCard.dataset.cardColor
        };
        e.dataTransfer.setData('application/json', JSON.stringify(data));
        paletteCard.classList.add('dragging');

        // Save current zoom level before drag starts (in case auto-zoom kicks in)
        viewportManager.saveManualZoom();

        debugLog.info('Palette card drag started', data);
    });

    cardList.addEventListener('dragend', (e) => {
        const paletteCard = e.target.closest('.palette-card');
        if (!paletteCard) return;

        paletteCard.classList.remove('dragging');
        debugLog.info('Palette card drag ended');
    });

    // Scroll wheel zoom for palette width
    const palette = cardList.closest('.palette');
    const addCardBtn = document.getElementById('add-card-btn');

    // Store scale on the palette as a data attribute
    let currentScale = parseFloat(palette.dataset.scale) || 1.0;

    // Get base width from CSS (default 200px)
    const baseWidth = 200; // Default palette width in pixels
    const basePadding = 16; // 1rem = 16px
    const baseMargin = 30; // margin-bottom on card-stack
    const baseButtonHeight = 80; // min-height on add-card-button
    const baseStackOffset = 5; // px offset for stacked cards effect

    // Create or get the dynamic style element for card stack scaling
    let stackStyleEl = document.getElementById('palette-stack-scale-style');
    if (!stackStyleEl) {
        stackStyleEl = document.createElement('style');
        stackStyleEl.id = 'palette-stack-scale-style';
        document.head.appendChild(stackStyleEl);
    }

    if (palette) {
        palette.addEventListener('wheel', (e) => {
            e.preventDefault();

            // Zoom in/out based on scroll direction
            const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1; // Scroll down = zoom out, scroll up = zoom in
            currentScale = Math.max(0.5, Math.min(2.0, currentScale * zoomDelta)); // Limit between 0.5x and 2x

            // Save scale to data attribute
            palette.dataset.scale = currentScale;

            // Scale the palette width (height stays 100%)
            const newWidth = baseWidth * currentScale;
            palette.style.width = `${newWidth}px`;

            // Scale padding to maintain proportions
            palette.style.padding = `${basePadding * currentScale}px`;

            // Scale add-card button margin to match padding
            if (addCardBtn) {
                addCardBtn.style.marginBottom = `${basePadding * currentScale}px`;
            }

            // Scale spacing between palette cards
            const cardStacks = cardList.querySelectorAll('.card-stack');
            cardStacks.forEach(stack => {
                stack.style.marginBottom = `${baseMargin * currentScale}px`;
            });

            // Scale the card stack offset for ::before and ::after pseudo-elements
            const scaledOffset = baseStackOffset * currentScale;
            stackStyleEl.textContent = `
                .card-stack::before {
                    top: ${scaledOffset}px !important;
                    right: -${scaledOffset}px !important;
                }
                .card-stack::after {
                    top: ${scaledOffset * 2}px !important;
                    right: -${scaledOffset * 2}px !important;
                }
            `;

            debugLog.info('Palette zoom', { scale: currentScale, width: newWidth });
        }, { passive: false }); // passive: false allows preventDefault
    }
}

function setupPaletteDropZone() {
    const viewport = document.querySelector('.viewport');
    const viewportContent = document.querySelector('.viewport-content');

    if (!viewport || !viewportContent) {
        debugLog.error('Viewport elements not found for drop zone setup');
        return;
    }

    // Handle dragover on both viewport and viewport-content
    const handleDragOver = (e) => {
        // Check if we're dragging from palette
        if (e.dataTransfer.types.includes('application/json')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            debugLog.info('Drag over viewport', { x: e.clientX, y: e.clientY });
        }
    };

    viewport.addEventListener('dragover', handleDragOver);
    viewportContent.addEventListener('dragover', handleDragOver);

    // Handle drop
    const handleDrop = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        debugLog.info('Drop event on viewport', {
            clientX: e.clientX,
            clientY: e.clientY,
            dataTypes: Array.from(e.dataTransfer.types)
        });

        // Check write access before allowing drop
        const hasAccess = await requireWriteAccess();
        if (!hasAccess) {
            return; // User cancelled auth
        }

        try {
            const jsonData = e.dataTransfer.getData('application/json');
            debugLog.info('Drop data retrieved', { jsonData });

            if (!jsonData) {
                debugLog.warn('No JSON data in drop event');
                return;
            }

            const data = JSON.parse(jsonData);
            if (!data.type || !data.color) {
                debugLog.warn('Invalid palette card data', data);
                return;
            }

            // Restore manual zoom FIRST (before coordinate conversion)
            viewportManager.restoreManualZoom();

            // Get workspace coordinates from drop position (using restored zoom)
            const workspacePos = CoordinateSystem.screenToWorkspace(
                e.clientX,
                e.clientY,
                viewportManager.viewport,
                viewportManager.currentZoom,
                viewportManager.currentPan
            );

            debugLog.info('Creating card from palette', {
                type: data.type,
                color: data.color,
                workspacePos
            });

            // Create new card with blank header (not palette type)
            const cardId = 'card-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            const card = new Card(
                workspacePos.x,
                workspacePos.y,
                cardId,
                '', // Start with blank header
                '',
                data.color,
                currentUserInitials,
                1
            );

            viewportContent.appendChild(card.render(viewportManager));
            appState.addCard(card);
            setupCardDragHandlers(card);

            // Mark card as unsaved (will be broadcast when user saves in edit modal)
            card.isUnsaved = true;

            // Update constellations after adding new card
            if (constellationManager) {
                const cards = Array.from(appState.cards.values());
                constellationManager.updateConstellations(cards);
            }

            debugLog.info('Card created from palette (not yet broadcast)', { id: cardId, type: data.type, color: data.color });

            // Auto-open edit modal at drop position
            const editEvent = new CustomEvent('card:edit', {
                detail: {
                    card: card,
                    mouseEvent: e
                }
            });
            document.dispatchEvent(editEvent);
        } catch (err) {
            debugLog.error('Failed to create card from palette', err);
        }
    };

    viewport.addEventListener('drop', handleDrop);
    viewportContent.addEventListener('drop', handleDrop);

    debugLog.info('Palette drop zone setup complete', {
        viewport: !!viewport,
        viewportContent: !!viewportContent
    });
}

// ============================================================================
// SELECTION, COPY, PASTE, DELETE
// ============================================================================

function setupSelectionAndKeyboard() {
    const viewportEl = document.querySelector('.viewport');
    const viewportContentEl = document.querySelector('.viewport-content');

    // Selection state
    const sel = { cardIds: new Set(), constId: null };
    let clipboard = []; // [{ header, body, color, authorInitials, dx, dy }]

    function clearSelection() {
        sel.cardIds.forEach(id => {
            const card = appState.cards.get(id);
            if (card && card.element) {
                card.element.classList.remove('card-selected');
                // Revert z-index unless it was permanently promoted via save
                if (card._preSelectZIndex !== undefined) {
                    card.element.style.zIndex = String(card._preSelectZIndex);
                    delete card._preSelectZIndex;
                }
            }
        });
        document.querySelectorAll('.constellation-shadow.constellation-selected')
            .forEach(el => el.classList.remove('constellation-selected'));
        sel.cardIds.clear();
        sel.constId = null;
    }

    function selectCard(card, addToSelection = false) {
        if (!addToSelection) clearSelection();
        sel.cardIds.add(card.id);
        sel.constId = null;
        if (card.element) {
            card.element.classList.add('card-selected');
            // Pop to top, remembering the previous z-index for potential revert
            if (card._preSelectZIndex === undefined) {
                card._preSelectZIndex = card.zIndex;
            }
            const topZ = (appState.maxZIndex || 1000) + 1;
            card.element.style.zIndex = String(topZ);
        }
    }

    function selectConstellation(constId, addToSelection = false) {
        if (!addToSelection) clearSelection();
        sel.constId = constId;
        const cardIdSet = window.constellationManager?.constellations.get(constId);
        if (cardIdSet) {
            cardIdSet.forEach(id => {
                sel.cardIds.add(id);
                const card = appState.cards.get(id);
                if (card && card.element) card.element.classList.add('card-selected');
            });
        }
        document.querySelectorAll(`.constellation-shadow[data-constellation-id="${constId}"]`)
            .forEach(el => el.classList.add('constellation-selected'));
    }

    function selectionCenter() {
        const cards = Array.from(sel.cardIds).map(id => appState.cards.get(id)).filter(Boolean);
        if (!cards.length) return { x: 0, y: 0 };
        return {
            x: cards.reduce((s, c) => s + c.x, 0) / cards.length,
            y: cards.reduce((s, c) => s + c.y, 0) / cards.length
        };
    }

    function deleteSelected() {
        if (!sel.cardIds.size) return;
        const toDelete = Array.from(sel.cardIds);
        clearSelection();
        toDelete.forEach(id => {
            const card = appState.cards.get(id);
            if (!card) return;
            if (card.element) card.element.remove();
            appState.cards.delete(id);
            socket.emit('card:delete', { id });
        });
        if (window.constellationManager) {
            window.constellationManager.updateConstellationsDebounced(Array.from(appState.cards.values()));
        }
    }

    function copySelected() {
        if (!sel.cardIds.size) return;
        const center = selectionCenter();
        clipboard = Array.from(sel.cardIds).map(id => {
            const card = appState.cards.get(id);
            if (!card) return null;
            return {
                header: card.header,
                body: card.body,
                color: card.color,
                authorInitials: card.authorInitials,
                dx: card.x - center.x,
                dy: card.y - center.y
            };
        }).filter(Boolean);
    }

    function pasteCards() {
        if (!clipboard.length || !currentProjectId) return;
        const { x: cx, y: cy } = viewportManager.focalPoint;
        const OFFSET = 20; // slight offset so paste isn't exactly on top of source
        const newCards = [];

        clipboard.forEach(data => {
            const newId = 'card-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            const newX = cx + data.dx + OFFSET;
            const newY = cy + data.dy + OFFSET;
            const card = new Card(newX, newY, newId, data.header, data.body, data.color, data.authorInitials, 1);
            const viewportContentEl2 = document.querySelector('.viewport-content');
            viewportContentEl2.appendChild(card.render(viewportManager));
            appState.addCard(card);
            setupCardDragHandlers(card);
            socket.emit('viewport:add', card.serialize());
            newCards.push(card);
        });

        // Select the pasted cards
        clearSelection();
        newCards.forEach(card => selectCard(card, true));

        if (window.constellationManager) {
            window.constellationManager.updateConstellationsDebounced(Array.from(appState.cards.values()));
        }
    }

    // Expose reset for project open/close
    window._resetSelection = clearSelection;

    // card:select event (from Card.onClick single-click)
    document.addEventListener('card:select', (e) => {
        selectCard(e.detail.card, e.detail.addToSelection);
    });

    // constellation:select event (from ConstellationManager shadow click)
    document.addEventListener('constellation:select', (e) => {
        selectConstellation(e.detail.constId, e.detail.addToSelection);
    });

    // Click on viewport background → clear selection
    viewportEl.addEventListener('mousedown', (e) => {
        if (e.target === viewportEl || e.target === viewportContentEl) {
            clearSelection();
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (!currentProjectId) return;
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

        if (e.key === 'Escape') {
            clearSelection();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            deleteSelected();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
            e.preventDefault();
            copySelected();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
            e.preventDefault();
            pasteCards();
        }
    });
}

// ============================================================================
// MAIN INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', async function() {
    debugLog.info('DOM loaded, initializing CardStorming');

    // Initialize authentication
    await auth.init();
    debugLog.info('Auth initialized', {
        authenticated: auth.isAuthenticated(),
        userHash: auth.userHash
    });

    // Clean up any invalid project IDs and restore from server
    await cleanupInvalidProjects();

    // Initialize viewport manager
    const viewport = document.querySelector('.viewport');
    const viewportContent = document.querySelector('.viewport-content');
    viewportManager = new ViewportManager(viewport, viewportContent);
    window.viewportManager = viewportManager; // For debugging

    // Initialize constellation manager
    constellationManager = new ConstellationManager(viewport, viewportManager);
    window.constellationManager = constellationManager; // For debugging

    // Initialize socket.io with project ID from URL if available
    const initialProjectId = getProjectIdFromURL();

    // If there's an initial project ID, set it as the current project BEFORE connecting
    // This ensures the state:init from server won't be ignored
    if (initialProjectId) {
        currentProjectId = initialProjectId;
        isProjectOpen = true;
        debugLog.info('Pre-opening project from URL', { projectId: initialProjectId });
    }

    const socketOptions = initialProjectId ? { query: { projectId: initialProjectId } } : {};
    socket = io(socketOptions);
    appState.socket = socket;

    // Setup all event listeners first (before connecting)
    setupTooltips();
    setupMenuHandlers();
    setupZoomControls();
    setupToolbarButtons();
    setupScanControls();
    setupSelectionAndKeyboard();
    setupPaletteCards();
    setupPaletteDropZone();
    setupViewportDrag();
    setupEditModal();
    setupCardCreationModal();
    setupSocketHandlers();

    // Wait for socket to connect before opening project
    // This only runs on initial connection - reconnections are handled separately
    let hasInitiallyConnected = false;
    socket.on('connect', () => {
        debugLog.info('Socket connected', { socketId: socket.id });

        // Only handle initial connection here - don't interfere with open projects on reconnect
        if (!hasInitiallyConnected) {
            hasInitiallyConnected = true;

            // Get project ID from URL, or fall back to last opened project
            const projectIdFromURL = getProjectIdFromURL();
            const lastProjectId = localStorage.getItem('lastProjectId');

            if (projectIdFromURL) {
                openProject(projectIdFromURL);
            } else if (lastProjectId) {
                openProject(lastProjectId);
            } else {
                closeProject();
                // Update UI for initial state (no project, maybe no auth)
                updateUIForAuthState();
            }
        } else {
            debugLog.info('Socket reconnected (initial connect already handled)');
        }
    });

    // Handle reconnection
    socket.on('reconnect', () => {
        debugLog.info('Socket reconnected', { socketId: socket.id });

        // Re-register user if project is open and authenticated
        if (isProjectOpen && currentProjectId && auth.isAuthenticated() && auth.hasWriteAccess()) {
            const identity = auth.getCurrentIdentity();
            if (identity) {
                socket.emit('user:register', {
                    initials: identity.initials,
                    name: identity.name,
                    projectId: currentProjectId
                }, (response) => {
                    if (!response.success) {
                        debugLog.error('Failed to re-register on reconnect', response);
                    } else {
                        debugLog.info('Re-registered on reconnect', { initials: identity.initials });
                    }
                });
            }
        }
    });

    // Hash change listener
    window.addEventListener('hashchange', () => {
        const newProjectId = getProjectIdFromURL();
        if (newProjectId && newProjectId !== currentProjectId) {
            openProject(newProjectId);
        } else if (!newProjectId && isProjectOpen) {
            closeProject();
        }
    });

    debugLog.info('CardStorming initialization complete');
});
