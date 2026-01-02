// CardStorming application - Refactored with ES6 modules
console.log('CardStorming initialized (ES6 modules)');

// Import all modules
import { debugLog } from './utils/DebugLog.js';
import { CoordinateSystem } from './core/CoordinateSystem.js';
import { ViewportManager } from './core/ViewportManager.js';
import { AppState } from './core/AppState.js';
import { Card } from './elements/Card.js';
import { Wormhole } from './elements/Wormhole.js';
import { ZoomSearchTool } from './elements/ZoomSearchTool.js';

// ============================================================================
// GLOBAL STATE
// ============================================================================

const appState = new AppState();
let viewportManager = null;
let socket = null;
let currentProjectId = null;
let isProjectOpen = false;
let currentUserInitials = '';

// Export to window for debugging
window.appState = appState;
window.debugLog = debugLog;
window.viewportManager = null; // Will be set after init

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

function getUserIdentity(projectId) {
    const key = `project_${projectId}_user`;
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : null;
}

function saveUserIdentity(projectId, initials, name) {
    const key = `project_${projectId}_user`;
    localStorage.setItem(key, JSON.stringify({ initials, name }));
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
            x: oldCard.left,
            y: oldCard.top,
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

function openProject(projectId) {
    if (!projectId || projectId === 'null' || projectId === 'undefined') {
        debugLog.error('Attempted to open project with invalid ID', { projectId });
        closeProject();
        return;
    }

    debugLog.info('Opening project', { projectId });

    currentProjectId = projectId;
    isProjectOpen = true;
    setProjectIdInURL(projectId);
    appState.projectId = projectId;
    appState.clearAll();

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

    const userIdentity = getUserIdentity(projectId);
    if (userIdentity) {
        currentUserInitials = userIdentity.initials;

        // Try to register with stored credentials
        const attemptRegistration = (retryCount = 0) => {
            socket.emit('user:register', {
                initials: userIdentity.initials,
                name: userIdentity.name,
                projectId: projectId
            }, (response) => {
                if (!response.success) {
                    // If initials are taken and we haven't retried, wait and retry once
                    if (retryCount === 0 && response.message.includes('already taken')) {
                        debugLog.warn('Registration failed, retrying in 500ms', response);
                        setTimeout(() => attemptRegistration(1), 500);
                    } else {
                        // After retry or other error, show identity modal
                        debugLog.error('Failed to register returning user', response);
                        showIdentityModal(projectId);
                    }
                } else {
                    debugLog.info('Successfully registered returning user', { initials: userIdentity.initials });
                }
            });
        };

        attemptRegistration();
    } else {
        showIdentityModal(projectId);
    }

    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) shareBtn.style.display = 'inline-block';

    // Enable toolbar buttons
    enableToolbarButtons();

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
        'zoom-center-btn'
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
    const buttons = [
        'add-card-btn',
        'add-wormhole-btn',
        'zoom-search-btn',
        'zoom-in-btn',
        'zoom-out-btn',
        'zoom-center-btn'
    ];

    buttons.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.disabled = true;
            btn.style.opacity = '0.3';
            btn.style.cursor = 'not-allowed';
        }
    });
}

function showIdentityModal(projectId) {
    // Simple prompt-based identity collection (TODO: Add proper modal UI)
    const name = prompt('Enter your name:');
    if (!name) {
        // User cancelled - close project
        closeProject();
        return;
    }

    const initials = prompt('Enter your initials (2-3 characters):');
    if (!initials) {
        // User cancelled - close project
        closeProject();
        return;
    }

    const normalizedInitials = initials.trim().toUpperCase();
    const normalizedName = name.trim();

    if (normalizedInitials && normalizedName) {
        currentUserInitials = normalizedInitials;
        saveUserIdentity(projectId, normalizedInitials, normalizedName);
        socket.emit('user:register', {
            initials: normalizedInitials,
            name: normalizedName,
            projectId: projectId
        }, (response) => {
            if (!response.success) {
                alert('Failed to register: ' + response.message);
                closeProject();
            }
        });
    } else {
        closeProject();
    }
}

// ============================================================================
// MENU HANDLERS
// ============================================================================

function populateOpenSubmenu() {
    const openSubmenu = document.getElementById('open-submenu');
    if (!openSubmenu) return;

    const knownProjects = getKnownProjects();
    const projectIds = Object.keys(knownProjects);

    if (projectIds.length === 0) {
        openSubmenu.innerHTML = '<a href="#" class="disabled-item">No projects</a>';
        return;
    }

    openSubmenu.innerHTML = '';
    projectIds.forEach(projectId => {
        const projectData = knownProjects[projectId];
        // Handle both string and object formats
        const projectName = typeof projectData === 'string' ? projectData : projectData.name;

        const link = document.createElement('a');
        link.href = '#';
        link.textContent = projectName;
        link.addEventListener('click', (e) => {
            e.preventDefault();
            openProject(projectId);
        });
        openSubmenu.appendChild(link);
    });
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
        newMenuItem.addEventListener('click', (e) => {
            e.preventDefault();
            openProject(generateProjectId());
        });
    }

    if (closeMenuItem) {
        closeMenuItem.addEventListener('click', (e) => {
            e.preventDefault();
            if (isProjectOpen && confirm('Close the current project?')) {
                closeProject();
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

function setupZoomControls() {
    const zoomOutBtn = document.getElementById('zoom-out-btn');
    const zoomInBtn = document.getElementById('zoom-in-btn');
    const centerBtn = document.getElementById('center-btn');

    if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            viewportManager.zoomOut();
            // Save manual zoom level
            viewportManager.saveManualZoom();
        });
    }

    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', (e) => {
            e.preventDefault();
            viewportManager.zoomIn();
            // Save manual zoom level
            viewportManager.saveManualZoom();
        });
    }

    if (centerBtn) {
        centerBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Reset to default zoom (1.0) and center view
            viewportManager.zoomTo(1.0);
            viewportManager.centerView();
            // Save this as the manual zoom
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

    // Zoom-search tool
    if (zoomSearchBtn) {
        zoomSearchBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();

            const tool = new ZoomSearchTool(0, 0);
            appState.currentDrag = tool;
            tool.startDrag(e, viewportManager);

            const onMouseMove = (moveEvent) => {
                tool.drag(moveEvent, viewportManager, appState);
            };

            const onMouseUp = (upEvent) => {
                tool.endDrag(upEvent, viewportManager, appState);
                appState.currentDrag = null;
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);

            debugLog.info('Zoom-search tool activated');
        });
    }

    // Wormhole button
    if (wormholeBtn) {
        wormholeBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();

            const viewportContent = document.querySelector('.viewport-content');

            // Create ghost element
            const ghost = document.createElement('div');
            ghost.style.position = 'fixed';
            ghost.style.pointerEvents = 'none';
            ghost.style.zIndex = '10000';
            ghost.style.width = '120px';
            ghost.style.height = '120px';
            ghost.style.opacity = '0.7';
            ghost.style.borderRadius = '50%';
            ghost.style.backgroundColor = 'rgba(255,255,255,0.9)';
            ghost.style.border = '3px solid #666';
            ghost.style.display = 'flex';
            ghost.style.alignItems = 'center';
            ghost.style.justifyContent = 'center';
            ghost.innerHTML = wormholeBtn.innerHTML;
            const svg = ghost.querySelector('svg');
            if (svg) {
                svg.style.width = '96px';
                svg.style.height = '96px';
            }
            ghost.style.left = (e.clientX - 60) + 'px';
            ghost.style.top = (e.clientY - 60) + 'px';
            document.body.appendChild(ghost);

            let dragStartTime = Date.now();
            let zoomAnimationFrame = null;

            // Start auto-zoom animation
            const zoomLoop = () => {
                const now = Date.now();
                if (now - dragStartTime >= 1500) {
                    viewportManager.zoomOutGradual();
                }
                zoomAnimationFrame = requestAnimationFrame(zoomLoop);
            };
            zoomAnimationFrame = requestAnimationFrame(zoomLoop);

            const onMouseMove = (moveEvent) => {
                ghost.style.left = (moveEvent.clientX - 60) + 'px';
                ghost.style.top = (moveEvent.clientY - 60) + 'px';
                viewportManager.autoPan(moveEvent);
            };

            const onMouseUp = (upEvent) => {
                cancelAnimationFrame(zoomAnimationFrame);
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

                    // Zoom back to 1.0
                    viewportManager.zoomTo(1.0, dropPos.x, dropPos.y);

                    // Create wormhole pair
                    const wormhole1Id = 'wormhole-' + Date.now() + '-1';
                    const wormhole2Id = 'wormhole-' + Date.now() + '-2';

                    const wormhole1 = new Wormhole(dropPos.x, dropPos.y, wormhole1Id, wormhole2Id);
                    const wormhole2 = new Wormhole(dropPos.x + 5, dropPos.y + 5, wormhole2Id, wormhole1Id);

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

                    debugLog.info('Wormhole pair created', { wormhole1Id, wormhole2Id });
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
        }
    });
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
            const cardRect = card.element.getBoundingClientRect();

            editModal.style.display = 'block';
            editModal.style.position = 'fixed';
            editModal.style.left = cardRect.left + 'px';
            editModal.style.top = cardRect.top + 'px';
            editModal.style.transform = 'none';

            // Match the card's actual size (including zoom)
            editCardVisual.style.width = cardRect.width + 'px';
            editCardVisual.style.height = cardRect.height + 'px';
            editCardVisual.style.minHeight = 'unset';
            editCardVisual.style.maxHeight = 'unset';

            // Calculate zoom scale from card width (natural width is 150px)
            const zoomScale = cardRect.width / 150;

            // Scale font sizes to match zoom
            editCardHeader.style.fontSize = (11 * zoomScale) + 'px';
            editCardBody.style.fontSize = (9 * zoomScale) + 'px';

            // Scale spacing
            editCardHeader.style.marginBottom = (4 * zoomScale) + 'px';
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

                socket.emit('viewport:update', {
                    id: cardId,
                    header: newHeader,
                    body: newBody
                });

                editModal.style.display = 'none';
                editModal.dataset.editingCardId = '';
            }
        });
    }

    if (editClose) {
        editClose.addEventListener('click', () => {
            // Save before closing
            const cardId = editModal.dataset.editingCardId;
            const card = appState.getCard(cardId);

            if (card) {
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

            if (card && confirm('Delete this card?')) {
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

    // Click outside modal to save and close
    editModal.addEventListener('click', (e) => {
        // Only close if clicking the modal background (not the content)
        if (e.target === editModal) {
            const cardId = editModal.dataset.editingCardId;
            const card = appState.getCard(cardId);

            if (card) {
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

    // Render each palette card
    const paletteCards = appState.paletteCards || [];
    paletteCards.forEach(paletteCard => {
        // Create stack container
        const stackEl = document.createElement('div');
        stackEl.className = 'card-stack';
        stackEl.style.backgroundColor = paletteCard.color;

        // Create the actual card
        const cardEl = document.createElement('div');
        cardEl.className = 'palette-card';
        cardEl.draggable = true;
        cardEl.dataset.cardType = paletteCard.type;
        cardEl.dataset.cardColor = paletteCard.color;
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

    debugLog.info('Rendered palette cards', { count: paletteCards.length });
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
                    wormholeData.partnerId
                );

                viewportContent.appendChild(wormhole.render(viewportManager));
                appState.addWormhole(wormhole);
                setupWormholeDragHandlers(wormhole);
            });
        }

        // Load palette cards
        if (serverState.paletteCards) {
            appState.paletteCards = serverState.paletteCards;
            renderPaletteCards();
        }

        debugLog.info('State loaded', {
            cards: appState.cards.size,
            wormholes: appState.wormholes.size,
            paletteCards: serverState.paletteCards ? serverState.paletteCards.length : 0
        });
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
    });

    // Wormhole added by another user
    socket.on('wormhole:add', (wormholeData) => {
        // Check if wormhole already exists (avoid duplicates from our own emits)
        if (appState.getWormhole(wormholeData.id)) {
            debugLog.info('Wormhole already exists, skipping duplicate', { id: wormholeData.id });
            return;
        }

        const viewportContent = document.querySelector('.viewport-content');
        const wormhole = new Wormhole(
            wormholeData.x,
            wormholeData.y,
            wormholeData.id,
            wormholeData.partnerId
        );

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
            wormhole.updatePosition(viewportManager);
        }
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
        }
    });

    // Card updated by another user
    socket.on('card:update', (data) => {
        const card = appState.getCard(data.id);
        if (card) {
            card.updateContent(data.header, data.body);
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

    card.element.addEventListener('mousedown', (e) => {
        card.startDrag(e, viewportManager);
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

    wormhole.element.addEventListener('mousedown', (e) => {
        wormhole.startDrag(e, viewportManager);
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
    cardList.addEventListener('dragstart', (e) => {
        const paletteCard = e.target.closest('.palette-card');
        if (!paletteCard) return;

        e.dataTransfer.effectAllowed = 'copy';
        const data = {
            type: paletteCard.dataset.cardType,
            color: paletteCard.dataset.cardColor
        };
        e.dataTransfer.setData('application/json', JSON.stringify(data));
        paletteCard.classList.add('dragging');

        debugLog.info('Palette card drag started', data);
    });

    cardList.addEventListener('dragend', (e) => {
        const paletteCard = e.target.closest('.palette-card');
        if (!paletteCard) return;

        paletteCard.classList.remove('dragging');
        debugLog.info('Palette card drag ended');
    });
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
    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();

        debugLog.info('Drop event on viewport', {
            clientX: e.clientX,
            clientY: e.clientY,
            dataTypes: Array.from(e.dataTransfer.types)
        });

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

            // Emit to server
            if (socket) {
                socket.emit('viewport:add', card.serialize());
            }

            debugLog.info('Card created from palette', { id: cardId, type: data.type, color: data.color });

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
// MAIN INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', async function() {
    debugLog.info('DOM loaded, initializing CardStorming');

    // Clean up any invalid project IDs and restore from server
    await cleanupInvalidProjects();

    // Initialize viewport manager
    const viewport = document.querySelector('.viewport');
    const viewportContent = document.querySelector('.viewport-content');
    viewportManager = new ViewportManager(viewport, viewportContent);
    window.viewportManager = viewportManager; // For debugging

    // Initialize socket.io with project ID from URL if available
    const initialProjectId = getProjectIdFromURL();
    const socketOptions = initialProjectId ? { query: { projectId: initialProjectId } } : {};
    socket = io(socketOptions);
    appState.socket = socket;

    // Setup all event listeners first (before connecting)
    setupMenuHandlers();
    setupZoomControls();
    setupToolbarButtons();
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

            // Get project ID from URL
            const projectIdFromURL = getProjectIdFromURL();

            if (projectIdFromURL) {
                openProject(projectIdFromURL);
            } else {
                closeProject();
            }
        } else {
            debugLog.info('Socket reconnected (initial connect already handled)');
        }
    });

    // Handle reconnection
    socket.on('reconnect', () => {
        debugLog.info('Socket reconnected', { socketId: socket.id });

        // Re-register user if project is open
        if (isProjectOpen && currentProjectId) {
            const userIdentity = getUserIdentity(currentProjectId);
            if (userIdentity) {
                currentUserInitials = userIdentity.initials;
                socket.emit('user:register', {
                    initials: userIdentity.initials,
                    name: userIdentity.name,
                    projectId: currentProjectId
                }, (response) => {
                    if (!response.success) {
                        debugLog.error('Failed to re-register on reconnect', response);
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
