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
    return window.location.hash.substring(1) || null;
}

function setProjectIdInURL(projectId) {
    window.location.hash = projectId;
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
 * Migrate old project format to new format
 * Old: { viewportCards: [{left, top, ...}] }
 * New: { cards: [{x, y, ...}] }
 */
function migrateProjectData(serverState) {
    if (serverState.viewportCards && !serverState.cards) {
        debugLog.info('Migrating old project format to new format');
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
        debugLog.info('Migration complete', { cardCount: serverState.cards.length });
    }

    serverState.cards = serverState.cards || [];
    serverState.wormholes = serverState.wormholes || [];
    serverState.paletteCards = serverState.paletteCards || [];

    return serverState;
}

// ============================================================================
// PROJECT OPEN/CLOSE
// ============================================================================

function openProject(projectId) {
    debugLog.info('Opening project', { projectId });

    currentProjectId = projectId;
    isProjectOpen = true;
    setProjectIdInURL(projectId);
    appState.projectId = projectId;
    appState.clearAll();

    const userIdentity = getUserIdentity(projectId);
    if (userIdentity) {
        currentUserInitials = userIdentity.initials;
        socket.emit('register', {
            initials: userIdentity.initials,
            name: userIdentity.name,
            projectId: projectId
        });
    } else {
        showIdentityModal(projectId);
    }

    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) shareBtn.style.display = 'inline-block';

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

    debugLog.info('Project closed');
}

function showIdentityModal(projectId) {
    const modal = document.getElementById('identity-modal');
    const initialsInput = document.getElementById('identity-initials');
    const nameInput = document.getElementById('identity-name');
    const joinBtn = document.getElementById('identity-join');

    modal.style.display = 'block';
    initialsInput.value = '';
    nameInput.value = '';
    initialsInput.focus();

    joinBtn.onclick = function() {
        const initials = initialsInput.value.trim().toUpperCase();
        const name = nameInput.value.trim();

        if (initials && name) {
            currentUserInitials = initials;
            saveUserIdentity(projectId, initials, name);
            socket.emit('register', { initials, name, projectId });
            modal.style.display = 'none';
        }
    };
}

// ============================================================================
// MENU HANDLERS
// ============================================================================

function setupMenuHandlers() {
    const projectNameEl = document.getElementById('project-name');
    const newMenuItem = document.getElementById('menu-new');
    const closeMenuItem = document.getElementById('menu-close');
    const deleteProjectMenuItem = document.getElementById('menu-delete-project');
    const showLogMenuItem = document.getElementById('menu-show-log');
    const logModal = document.getElementById('log-modal');
    const logCloseBtn = document.getElementById('log-close');
    const logClearBtn = document.getElementById('log-clear');

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
        });
    }

    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', (e) => {
            e.preventDefault();
            viewportManager.zoomIn();
        });
    }

    if (centerBtn) {
        centerBtn.addEventListener('click', (e) => {
            e.preventDefault();
            viewportManager.centerView();
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

function setupEditModal() {
    const editModal = document.getElementById('edit-modal');
    const editCardHeader = document.getElementById('edit-card-header');
    const editCardBody = document.getElementById('edit-card-body');
    const editSave = document.getElementById('edit-save');
    const editCancel = document.getElementById('edit-cancel');

    // Listen for custom card:edit event
    document.addEventListener('card:edit', (e) => {
        const card = e.detail.card;

        editCardHeader.textContent = card.header;
        editCardBody.textContent = card.body;
        editModal.dataset.editingCardId = card.id;
        editModal.style.display = 'block';
        editCardHeader.focus();
    });

    if (editSave) {
        editSave.addEventListener('click', () => {
            const cardId = editModal.dataset.editingCardId;
            const card = appState.getCard(cardId);

            if (card) {
                const newHeader = editCardHeader.textContent.trim();
                const newBody = editCardBody.textContent.trim();

                card.updateContent(newHeader, newBody);

                socket.emit('card:update', {
                    id: cardId,
                    header: newHeader,
                    body: newBody
                });

                editModal.style.display = 'none';
                editModal.dataset.editingCardId = '';
            }
        });
    }

    if (editCancel) {
        editCancel.addEventListener('click', () => {
            editModal.style.display = 'none';
            editModal.dataset.editingCardId = '';
        });
    }
}

// ============================================================================
// SOCKET.IO HANDLERS
// ============================================================================

function setupSocketHandlers() {
    socket.on('state:init', (serverState) => {
        debugLog.info('Received state:init from server', serverState);

        // Migrate old format if needed
        serverState = migrateProjectData(serverState);

        // Clear existing state
        appState.clearAll();

        const projectNameEl = document.getElementById('project-name');
        const viewportContent = document.querySelector('.viewport-content');

        // Set project name
        if (serverState.projectName) {
            projectNameEl.value = serverState.projectName;
            appState.projectName = serverState.projectName;
            saveKnownProject(currentProjectId, serverState.projectName);
        } else {
            const knownProjects = getKnownProjects();
            const name = knownProjects[currentProjectId] || generateProjectName();
            projectNameEl.value = name;
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

        debugLog.info('State loaded', {
            cards: appState.cards.size,
            wormholes: appState.wormholes.size
        });
    });

    // Card added by another user
    socket.on('viewport:add', (cardData) => {
        const viewportContent = document.querySelector('.viewport-content');
        const card = new Card(
            cardData.left,  // Server still uses 'left'
            cardData.top,   // Server still uses 'top'
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

    // Card moved by another user
    socket.on('viewport:move', (data) => {
        const card = appState.getCard(data.id);
        if (card) {
            card.x = data.left;
            card.y = data.top;
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
// MAIN INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', function() {
    debugLog.info('DOM loaded, initializing CardStorming');

    // Initialize viewport manager
    const viewport = document.querySelector('.viewport');
    const viewportContent = document.querySelector('.viewport-content');
    viewportManager = new ViewportManager(viewport, viewportContent);
    window.viewportManager = viewportManager; // For debugging

    // Initialize socket.io
    socket = io();
    appState.socket = socket;

    // Get project ID from URL
    currentProjectId = getProjectIdFromURL();

    if (currentProjectId) {
        openProject(currentProjectId);
    } else {
        closeProject();
    }

    // Setup all event listeners
    setupMenuHandlers();
    setupZoomControls();
    setupToolbarButtons();
    setupViewportDrag();
    setupEditModal();
    setupSocketHandlers();

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
