// CardStorming application
console.log('CardStorming initialized');

// Debug logging system
const debugLog = {
    entries: [],
    maxEntries: 500,

    log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const entry = { timestamp, level, message, data };
        this.entries.push(entry);

        // Keep only last maxEntries
        if (this.entries.length > this.maxEntries) {
            this.entries.shift();
        }

        // Also log to console
        const consoleMsg = `[${level.toUpperCase()}] ${message}`;
        if (data) {
            console.log(consoleMsg, data);
        } else {
            console.log(consoleMsg);
        }

        // Update log display if visible
        this.updateDisplay();
    },

    info(message, data) { this.log('info', message, data); },
    warn(message, data) { this.log('warn', message, data); },
    error(message, data) { this.log('error', message, data); },

    clear() {
        this.entries = [];
        this.updateDisplay();
    },

    updateDisplay() {
        const logContent = document.getElementById('log-content');
        if (!logContent) return;

        const logModal = document.getElementById('log-modal');
        if (logModal.style.display !== 'block') return;

        logContent.innerHTML = this.entries.map(entry => {
            const dataStr = entry.data ? '\n' + JSON.stringify(entry.data, null, 2) : '';
            return `<div class="log-entry">
                <span class="log-timestamp">${entry.timestamp}</span>
                <span class="log-level-${entry.level}"> [${entry.level.toUpperCase()}]</span> ${entry.message}${dataStr}
            </div>`;
        }).join('');

        // Auto-scroll to bottom
        logContent.scrollTop = logContent.scrollHeight;
    }
};

// Project management
const adjectives = ['Galloping', 'Remorseful', 'Bouncing', 'Thoughtful', 'Dancing', 'Mighty', 'Gentle', 'Swift', 'Brave', 'Clever', 'Happy', 'Curious', 'Playful', 'Wise', 'Bold'];
const nouns = ['Giraffe', 'Rhinoceros', 'Elephant', 'Penguin', 'Dolphin', 'Tiger', 'Panda', 'Eagle', 'Otter', 'Fox', 'Koala', 'Falcon', 'Walrus', 'Leopard', 'Turtle'];

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
    return hash || null;
}

function setProjectIdInURL(projectId) {
    window.location.hash = projectId;
}

// Generate unique IDs for cards
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Zoom controls with focal point tracking
let currentZoom = 1.0;
const ZOOM_STEP = 0.05;  // Very slow, smooth zoom (5%)
const MIN_ZOOM = 0.1;  // Very zoomed out - see lots of workspace
const MAX_ZOOM = 3.0;   // 3x for accessibility
let focalPoint = { x: 0.5, y: 0.5 }; // Normalized coordinates (0-1), default center

// Grid snapping
const GRID_SIZE = 25; // pixels

// Snap coordinate to grid
function snapToGrid(value) {
    return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function setZoom(zoomLevel) {
    const viewportContent = document.querySelector('.viewport-content');
    if (!viewportContent) return;

    const oldZoom = currentZoom;
    currentZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomLevel));

    // Calculate transform origin based on focal point (percentage coordinates)
    const originX = focalPoint.x * 100;
    const originY = focalPoint.y * 100;

    // Get current pan offset from the panning system
    // We need to access these variables which are defined in setupSocketListeners scope
    // For now, parse it from the current transform if it exists
    let panX = 0, panY = 0;
    const currentTransform = viewportContent.style.transform;
    if (currentTransform && currentTransform.includes('translate')) {
        const match = currentTransform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
        if (match) {
            panX = parseFloat(match[1]);
            panY = parseFloat(match[2]);
        }
    }

    viewportContent.style.transform = `translate(${panX}px, ${panY}px) scale(${currentZoom})`;
    viewportContent.style.transformOrigin = `${originX}% ${originY}%`;

    debugLog.info('setZoom', {
        oldZoom,
        newZoom: currentZoom,
        focalPoint: { ...focalPoint },
        originPercent: { x: originX, y: originY },
        pan: { x: panX, y: panY }
    });
}

function zoomIn() {
    setZoom(currentZoom + ZOOM_STEP);
}

function zoomOut() {
    setZoom(currentZoom - ZOOM_STEP);
}

function centerView() {
    const viewportContent = document.querySelector('.viewport-content');
    if (!viewportContent) return;

    // Reset focal point to center of workspace
    focalPoint = { x: 0.5, y: 0.5 };

    // Reset zoom to 100%
    setZoom(1.0);
}

function setFocalPointFromEvent(event, card = null) {
    const viewport = document.querySelector('.viewport');
    const viewportContent = document.querySelector('.viewport-content');
    if (!viewport || !viewportContent) return;

    const rect = viewport.getBoundingClientRect();
    const contentRect = viewportContent.getBoundingClientRect();

    let clientX, clientY;

    // If a card is provided, use its center
    if (card) {
        const cardRect = card.getBoundingClientRect();
        clientX = cardRect.left + cardRect.width / 2;
        clientY = cardRect.top + cardRect.height / 2;
    } else {
        // Otherwise use the event position
        clientX = event.clientX;
        clientY = event.clientY;
    }

    // Calculate position relative to the SCALED viewport-content
    const contentX = clientX - contentRect.left;
    const contentY = clientY - contentRect.top;

    // Normalize to 0-1 within the scaled content area
    focalPoint.x = contentX / contentRect.width;
    focalPoint.y = contentY / contentRect.height;

    // Clamp to valid range
    focalPoint.x = Math.max(0, Math.min(1, focalPoint.x));
    focalPoint.y = Math.max(0, Math.min(1, focalPoint.y));

    debugLog.info('setFocalPointFromEvent', {
        viewportSize: { width: rect.width, height: rect.height },
        contentSize: { width: contentRect.width, height: contentRect.height },
        screenPos: { x: clientX, y: clientY },
        contentPos: { x: contentX, y: contentY },
        focalPoint: { ...focalPoint }
    });
}

// Calculate luminance and determine text color for readability
function getTextColorForBackground(bgColor) {
    // Convert hex to RGB
    let r, g, b;

    if (bgColor.startsWith('#')) {
        const hex = bgColor.substring(1);
        r = parseInt(hex.substr(0, 2), 16);
        g = parseInt(hex.substr(2, 2), 16);
        b = parseInt(hex.substr(4, 2), 16);
    } else if (bgColor.startsWith('rgb')) {
        const match = bgColor.match(/\d+/g);
        r = parseInt(match[0]);
        g = parseInt(match[1]);
        b = parseInt(match[2]);
    } else {
        return '#000000'; // Default to black
    }

    // Calculate relative luminance using standard formula
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    // Return white text for dark backgrounds, black for light
    return luminance > 0.5 ? '#000000' : '#ffffff';
}

// Project state management
let currentProjectId = getProjectIdFromURL();
let isProjectOpen = false;
let socket = null;

// User state management
let currentUserInitials = null;
let currentUserName = null;
let isUserAuthenticated = false;

// Project tracking in localStorage
function saveKnownProject(projectId, projectName) {
    const knownProjects = JSON.parse(localStorage.getItem('knownProjects') || '{}');
    knownProjects[projectId] = {
        name: projectName,
        lastAccessed: new Date().toISOString()
    };
    localStorage.setItem('knownProjects', JSON.stringify(knownProjects));
}

function getKnownProjects() {
    return JSON.parse(localStorage.getItem('knownProjects') || '{}');
}

// User tracking in localStorage (per project)
function saveProjectUser(projectId, initials, name) {
    const projectUsers = JSON.parse(localStorage.getItem('projectUsers') || '{}');
    if (!projectUsers[projectId]) {
        projectUsers[projectId] = [];
    }

    // Remove existing entry for these initials
    projectUsers[projectId] = projectUsers[projectId].filter(u => u.initials !== initials);

    // Add to front (most recent)
    projectUsers[projectId].unshift({ initials, name });

    // Keep only last 10 users per project
    projectUsers[projectId] = projectUsers[projectId].slice(0, 10);

    localStorage.setItem('projectUsers', JSON.stringify(projectUsers));
}

function getProjectUsers(projectId) {
    const projectUsers = JSON.parse(localStorage.getItem('projectUsers') || '{}');
    return projectUsers[projectId] || [];
}

// Save current session user (per tab)
function saveSessionUser(initials, name) {
    sessionStorage.setItem('currentUser', JSON.stringify({ initials, name }));
}

function getSessionUser() {
    const user = sessionStorage.getItem('currentUser');
    return user ? JSON.parse(user) : null;
}

// Function to disable/enable UI controls
function setControlsEnabled(enabled) {
    // Get or create the workspace overlay
    let overlay = document.getElementById('workspace-overlay');

    if (!enabled) {
        // Create overlay if it doesn't exist
        if (!overlay) {
            // Calculate the top position: heading height + menu bar height
            const heading = document.querySelector('.heading');
            const menuBar = document.querySelector('.menu-bar');
            const topOffset = (heading?.offsetHeight || 0) + (menuBar?.offsetHeight || 0);

            overlay = document.createElement('div');
            overlay.id = 'workspace-overlay';
            overlay.style.cssText = `
                position: fixed;
                top: ${topOffset}px;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: rgba(0, 0, 0, 0.3);
                backdrop-filter: blur(2px);
                z-index: 9998;
                pointer-events: auto;
            `;

            // Create user identity panel on the overlay
            const identityPanel = document.createElement('div');
            identityPanel.className = 'user-identity-panel';
            identityPanel.innerHTML = `
                <div class="user-identity-content">
                    <h2>Who are you?</h2>
                    <form autocomplete="off">
                        <div class="user-input-row">
                            <div class="user-field-wrapper">
                                <input type="text" id="user-initials" class="user-initials-input" name="user-initials-${Date.now()}" maxlength="4" placeholder="initials" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-form-type="other">
                                <div id="initials-dropdown" class="initials-dropdown"></div>
                            </div>
                            <input type="text" id="user-name" class="user-name-input" name="user-name-${Date.now()}" placeholder="name" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-form-type="other">
                        </div>
                    </form>
                </div>
            `;

            overlay.appendChild(identityPanel);
            document.body.appendChild(overlay);

            // Set up listeners right after creating the overlay
            setupUserIdentityListeners();
        }
    } else {
        // Remove overlay if it exists
        if (overlay) {
            overlay.remove();
        }
    }
}

// Function to open a project
function openProject(projectId) {
    currentProjectId = projectId;
    setProjectIdInURL(projectId);
    isProjectOpen = true;

    // Reset authentication state for new project
    isUserAuthenticated = false;
    currentUserInitials = null;
    currentUserName = null;

    // Initialize Socket.IO connection with project ID
    if (socket) {
        socket.disconnect();
    }
    socket = io({
        query: { projectId: currentProjectId }
    });

    // Set up socket event listeners
    setupSocketListeners();

    // Check if we have a known identity for this project
    const projectUsers = getProjectUsers(projectId);
    const sessionUser = getSessionUser();

    if (projectUsers.length > 0) {
        // We've used this project before - auto-authenticate silently
        const mostRecentUser = projectUsers[0];
        currentUserInitials = mostRecentUser.initials;
        currentUserName = mostRecentUser.name;

        // Authenticate with server
        socket.emit('user:register', {
            projectId: currentProjectId,
            initials: mostRecentUser.initials,
            name: mostRecentUser.name
        }, (response) => {
            if (response.success) {
                isUserAuthenticated = true;
                saveSessionUser(mostRecentUser.initials, mostRecentUser.name);

                // Update welcome text
                const welcomeText = document.getElementById('welcome-text');
                if (welcomeText) {
                    welcomeText.textContent = `Welcome to your collaborative workspace, ${mostRecentUser.name} [${mostRecentUser.initials}]`;
                }

                // Enable controls without showing dialog
                setControlsEnabled(true);
            } else {
                // Authentication failed - show dialog
                setControlsEnabled(false);
            }
        });
    } else if (sessionUser) {
        // New project but we have session defaults - show dialog with defaults
        setControlsEnabled(false);
    } else {
        // Completely new user - show dialog
        setControlsEnabled(false);
    }

    // Update the Open submenu (project will be added to known projects when state:init fires)
    setTimeout(function() {
        populateOpenSubmenu();
    }, 100);
}

// Function to close current project
function closeProject() {
    isProjectOpen = false;
    currentProjectId = null;

    // Clear URL hash
    window.location.hash = '';

    // Disconnect socket
    if (socket) {
        socket.disconnect();
        socket = null;
    }

    // Clear viewport and palette
    const viewportContent = document.querySelector('.viewport-content');
    const cardList = document.getElementById('card-list');
    if (viewportContent) {
        viewportContent.querySelectorAll('.viewport-card').forEach(card => card.remove());
    }
    if (cardList) {
        cardList.innerHTML = '';
    }

    // Clear project name
    const projectNameEl = document.getElementById('project-name');
    if (projectNameEl) {
        projectNameEl.value = 'No Project Open';
    }

    // Reset welcome text
    const welcomeText = document.getElementById('welcome-text');
    if (welcomeText) {
        welcomeText.textContent = 'Welcome to your collaborative workspace';
    }

    // Clear authentication state
    isUserAuthenticated = false;
    currentUserInitials = null;
    currentUserName = null;

    // Disable controls (this will remove the overlay and user identity fields)
    setControlsEnabled(false);
}

// Setup socket event listeners
function setupSocketListeners() {
    const projectNameEl = document.getElementById('project-name');
    const cardList = document.getElementById('card-list');
    const viewport = document.querySelector('.viewport');
    const viewportContent = document.querySelector('.viewport-content');

    // Function to update card content
    function updateCardContent(card, header, body) {
        const headerDiv = document.createElement('div');
        headerDiv.className = 'card-header';
        headerDiv.textContent = header;

        const bodyDiv = document.createElement('div');
        bodyDiv.className = 'card-body';
        bodyDiv.textContent = body;

        card.innerHTML = '';
        card.appendChild(headerDiv);
        if (body) {
            card.appendChild(bodyDiv);
        }

        card.dataset.header = header;
        card.dataset.body = body;
    }

    // Drag handlers
    function handleDragStart(e) {
        // Create custom drag ghost with gradient
        const ghost = e.target.cloneNode(true);
        ghost.classList.add('drag-ghost');
        ghost.style.width = e.target.offsetWidth + 'px';
        ghost.style.height = e.target.offsetHeight + 'px';
        document.body.appendChild(ghost);

        // Set the custom drag image
        e.dataTransfer.setDragImage(ghost, 0, 0);

        // Clean up the ghost after a brief moment
        setTimeout(() => {
            if (ghost.parentNode) {
                ghost.parentNode.removeChild(ghost);
            }
        }, 0);

        e.target.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', JSON.stringify({
            type: e.target.dataset.cardType,
            color: e.target.dataset.cardColor
        }));
    }

    function handleDragEnd(e) {
        e.target.classList.remove('dragging');
    }

    function handleCardDoubleClick(e) {
        e.preventDefault();

        const card = e.currentTarget;

        // Update focal point to center of card for future zooming
        setFocalPointFromEvent(e, card);

        const editModal = document.getElementById('edit-modal');
        const editCardVisual = document.getElementById('edit-card-visual');
        const editCardHeader = document.getElementById('edit-card-header');
        const editCardBody = document.getElementById('edit-card-body');

        editCardHeader.textContent = card.dataset.header || '';

        // Convert newlines to HTML for contenteditable
        const bodyText = card.dataset.body || '';
        editCardBody.innerHTML = bodyText
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .split('\n')
            .map((line, index) => index === 0 ? line : '<div>' + line + '</div>')
            .join('');

        editCardVisual.style.backgroundColor = card.style.backgroundColor;
        editCardVisual.style.color = getTextColorForBackground(card.style.backgroundColor);
        editModal.dataset.editingCardId = card.dataset.id;
        editModal.style.display = 'block';
        editCardHeader.focus();
    }

    // Create a palette card
    function createPaletteCard(type, color) {
        const cardStack = document.createElement('div');
        cardStack.className = 'card-stack';
        cardStack.style.backgroundColor = color;

        const card = document.createElement('div');
        card.className = 'palette-card';
        card.style.backgroundColor = color;
        card.style.color = getTextColorForBackground(color);
        card.textContent = type;
        card.draggable = true;
        card.dataset.cardType = type;
        card.dataset.cardColor = color;

        card.addEventListener('dragstart', handleDragStart);
        card.addEventListener('dragend', handleDragEnd);

        cardStack.appendChild(card);
        cardList.appendChild(cardStack);
    }

    // Create a viewport card
    function createViewportCard(id, header, body, color, left, top, zIndex, authorInitials) {
        debugLog.info('createViewportCard called', {
            id,
            header,
            body,
            color,
            left,
            top,
            zIndex,
            authorInitials
        });

        const card = document.createElement('div');
        card.className = 'viewport-card';
        card.dataset.id = id;
        card.style.backgroundColor = color;
        card.style.color = getTextColorForBackground(color);
        card.style.left = left;
        card.style.top = top;
        card.style.zIndex = zIndex || 1;

        updateCardContent(card, header, body);

        // Add author initials in upper right corner
        if (authorInitials) {
            const authorEl = document.createElement('div');
            authorEl.className = 'card-author';
            authorEl.textContent = authorInitials;
            card.appendChild(authorEl);
        }

        card.draggable = true;
        card.addEventListener('dblclick', handleCardDoubleClick);

        viewportContent.appendChild(card);

        debugLog.info('Card appended to viewport', {
            id,
            cardRect: card.getBoundingClientRect(),
            computedStyle: {
                left: card.style.left,
                top: card.style.top,
                transform: window.getComputedStyle(card).transform
            }
        });
    }

    // WebSocket event listeners
    socket.on('state:init', (serverState) => {
        // Clear existing cards
        cardList.innerHTML = '';
        viewportContent.querySelectorAll('.viewport-card').forEach(card => card.remove());

        // Set project name
        if (serverState.projectName) {
            // Server already has a name for this project
            projectNameEl.value = serverState.projectName;
            saveKnownProject(currentProjectId, serverState.projectName);
        } else {
            // Check if we have this project in localStorage
            const knownProjects = getKnownProjects();
            if (knownProjects[currentProjectId]) {
                // Use the known project name and tell the server
                const knownName = knownProjects[currentProjectId].name;
                projectNameEl.value = knownName;
                socket.emit('project:rename', { projectId: currentProjectId, name: knownName });
            } else {
                // Generate a new random name for this new project
                const randomName = generateProjectName();
                projectNameEl.value = randomName;
                socket.emit('project:rename', { projectId: currentProjectId, name: randomName });
                saveKnownProject(currentProjectId, randomName);
            }
        }

        // Load palette cards
        serverState.paletteCards.forEach(cardData => {
            createPaletteCard(cardData.type, cardData.color);
        });

        // Load viewport cards
        serverState.viewportCards.forEach(cardData => {
            createViewportCard(cardData.id, cardData.header, cardData.body, cardData.color, cardData.left, cardData.top, cardData.zIndex, cardData.authorInitials);
        });
    });

    socket.on('project:renamed', (data) => {
        projectNameEl.value = data.name;
        saveKnownProject(currentProjectId, data.name);
    });

    socket.on('palette:add', (cardData) => {
        const existingCards = document.querySelectorAll('.palette-card');
        for (let card of existingCards) {
            if (card.dataset.cardType === cardData.type && card.dataset.cardColor === cardData.color) {
                return;
            }
        }
        createPaletteCard(cardData.type, cardData.color);
    });

    socket.on('viewport:add', (cardData) => {
        createViewportCard(cardData.id, cardData.header, cardData.body, cardData.color, cardData.left, cardData.top, cardData.zIndex, cardData.authorInitials);
    });

    socket.on('viewport:move', (data) => {
        const card = document.querySelector(`[data-id="${data.id}"]`);
        if (card) {
            card.style.left = data.left;
            card.style.top = data.top;
            card.style.zIndex = data.zIndex;
        }
    });

    socket.on('viewport:update', (data) => {
        const card = document.querySelector(`[data-id="${data.id}"]`);
        if (card) {
            updateCardContent(card, data.header, data.body);
            card.style.zIndex = data.zIndex;
        }
    });

    // Handle full state sync (e.g., after z-index normalization)
    socket.on('state:sync', (serverState) => {
        // Update all viewport cards with new z-index values
        serverState.viewportCards.forEach(cardData => {
            const card = document.querySelector(`[data-id="${cardData.id}"]`);
            if (card) {
                card.style.zIndex = cardData.zIndex;
            }
        });
        console.log('Z-index normalized - card stacking order preserved');
    });
}

// Function to set up user identity event listeners (called after overlay is created)
function setupUserIdentityListeners() {
    const userInitialsInput = document.getElementById('user-initials');
    const userNameInput = document.getElementById('user-name');
    const initialsDropdown = document.getElementById('initials-dropdown');

    if (!userInitialsInput || !userNameInput || !initialsDropdown) {
        // Elements don't exist yet (no overlay), will be set up later
        return;
    }

    let validationTimeout = null;

    // Initially disable name field until initials are validated
    userNameInput.disabled = true;

    // Priority: project-specific user > session user > show dropdown
    if (currentProjectId) {
        // Check if this user has contributed to this specific project before
        const projectUsers = getProjectUsers(currentProjectId);
        if (projectUsers.length > 0) {
            // Use the most recent user for THIS project
            const mostRecentUser = projectUsers[0];
            userInitialsInput.value = mostRecentUser.initials;
            userNameInput.value = mostRecentUser.name;
            userNameInput.disabled = false;
            // Validate with server and auto-authenticate
            validateInitials(mostRecentUser.initials, true);
        } else {
            // This is a new project - try session user as fallback
            const sessionUser = getSessionUser();
            if (sessionUser) {
                userInitialsInput.value = sessionUser.initials;
                userNameInput.value = sessionUser.name;
                userNameInput.disabled = false;
                // Validate with server and auto-authenticate
                validateInitials(sessionUser.initials, true);
            } else {
                // Brand new user - show dropdown on focus
                userInitialsInput.addEventListener('focus', function showAllUsers() {
                    if (userInitialsInput.value === '') {
                        showUserDropdown('');
                    }
                    // Remove this listener after first focus
                    userInitialsInput.removeEventListener('focus', showAllUsers);
                });
            }
        }
    } else {
        // No project open yet - show dropdown on focus
        userInitialsInput.addEventListener('focus', function showAllUsers() {
            if (userInitialsInput.value === '') {
                showUserDropdown('');
            }
            // Remove this listener after first focus
            userInitialsInput.removeEventListener('focus', showAllUsers);
        });
    }

    // Handle Tab key in initials field
    userInitialsInput.addEventListener('keydown', function(e) {
        if (e.key === 'Tab') {
            const initials = userInitialsInput.value.trim().toUpperCase();
            if (initials) {
                const localUsers = getProjectUsers(currentProjectId);
                const filteredUsers = localUsers.filter(user => user.initials.toUpperCase().startsWith(initials));

                // If exactly one match, auto-select it
                if (filteredUsers.length === 1) {
                    e.preventDefault();
                    userInitialsInput.value = filteredUsers[0].initials;
                    initialsDropdown.classList.remove('show');
                    validateInitials(filteredUsers[0].initials, true);
                    // Focus will move to name field after validation enables it
                    setTimeout(() => {
                        if (!userNameInput.disabled) {
                            userNameInput.focus();
                        }
                    }, 100);
                }
            }
        } else if (e.key === 'Enter') {
            const initials = userInitialsInput.value.trim().toUpperCase();
            if (initials && userNameInput.value.trim()) {
                e.preventDefault();
                authenticateUser(initials, userNameInput.value.trim());
            }
        }
    });

    // Handle initials input
    userInitialsInput.addEventListener('input', function(e) {
        const initials = e.target.value.toUpperCase().trim();
        e.target.value = initials;

        // Clear validation states
        userInitialsInput.classList.remove('valid', 'error');
        userNameInput.disabled = true;
        userNameInput.value = '';
        userNameInput.removeAttribute('data-expected-name');
        isUserAuthenticated = false;
        setControlsEnabled(false);

        // Show filtered dropdown if we have at least one character
        if (initials.length > 0) {
            showUserDropdown(initials);

            // Debounced validation
            clearTimeout(validationTimeout);
            validationTimeout = setTimeout(() => {
                validateInitials(initials);
            }, 300);
        } else {
            // Show all users if field becomes empty
            showUserDropdown('');
        }
    });

    // Validate initials with server
    function validateInitials(initials, autoFillName = false) {
        if (!currentProjectId || !socket) return;

        socket.emit('user:validate', { projectId: currentProjectId, initials }, (response) => {
            if (response.available) {
                userInitialsInput.classList.remove('error');
                userInitialsInput.classList.add('valid');
                userNameInput.disabled = false;

                // If this is a returning user, auto-fill their name
                if (response.isReturning && response.existingName) {
                    userNameInput.value = response.existingName;
                    userNameInput.setAttribute('data-expected-name', response.existingName);

                    // If called from dropdown, auto-authenticate
                    if (autoFillName) {
                        authenticateUser(initials, response.existingName);
                    }
                } else {
                    // New user - clear any previous name
                    userNameInput.removeAttribute('data-expected-name');
                }
                // Don't auto-focus name field - let user tab to it
            } else {
                // Initials are actively in use
                userInitialsInput.classList.remove('valid');
                userInitialsInput.classList.add('error');
                userNameInput.disabled = true;
                userNameInput.value = '';
                userNameInput.removeAttribute('data-expected-name');
            }
        });
    }

    // Show dropdown with users filtered by first letter
    function showUserDropdown(filterInitials = '') {
        if (!currentProjectId) return;

        const localUsers = getProjectUsers(currentProjectId);
        initialsDropdown.innerHTML = '';

        // Filter users by first letter if provided
        const filteredUsers = filterInitials
            ? localUsers.filter(user => user.initials.startsWith(filterInitials))
            : localUsers;

        if (filteredUsers.length === 0) {
            const emptyItem = document.createElement('div');
            emptyItem.className = 'dropdown-item';
            emptyItem.textContent = filterInitials ? `No users starting with "${filterInitials}"` : 'No recent users';
            emptyItem.style.fontStyle = 'italic';
            emptyItem.style.color = '#999';
            initialsDropdown.appendChild(emptyItem);
        } else {
            filteredUsers.forEach(user => {
                const item = document.createElement('div');
                item.className = 'dropdown-item';
                item.innerHTML = `<span class="dropdown-item-initials">${user.initials}</span><span class="dropdown-item-name">${user.name}</span>`;
                item.addEventListener('click', () => {
                    userInitialsInput.value = user.initials;
                    initialsDropdown.classList.remove('show');
                    validateInitials(user.initials, true);
                });
                initialsDropdown.appendChild(item);
            });
        }

        initialsDropdown.classList.add('show');
    }

    // Handle name input
    userNameInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            const initials = userInitialsInput.value.trim();
            const name = userNameInput.value.trim();

            if (initials && name) {
                authenticateUser(initials, name);
            }
        }
    });

    userNameInput.addEventListener('blur', function() {
        const initials = userInitialsInput.value.trim();
        const name = userNameInput.value.trim();

        if (initials && name && !isUserAuthenticated) {
            authenticateUser(initials, name);
        }
    });

    // Authenticate user with server
    function authenticateUser(initials, name) {
        if (!currentProjectId || !socket) return;

        // Check if this is a returning user with expected name
        const expectedName = userNameInput.getAttribute('data-expected-name');
        if (expectedName && name !== expectedName) {
            alert(`This user's name is "${expectedName}". Please use the correct name or choose different initials.`);
            userNameInput.value = expectedName;
            userNameInput.focus();
            return;
        }

        socket.emit('user:register', { projectId: currentProjectId, initials, name }, (response) => {
            if (response.success) {
                currentUserInitials = initials;
                currentUserName = name;
                isUserAuthenticated = true;

                // Save to session and localStorage
                saveSessionUser(initials, name);
                saveProjectUser(currentProjectId, initials, name);

                // Update welcome text with user info
                const welcomeText = document.getElementById('welcome-text');
                if (welcomeText) {
                    welcomeText.textContent = `Welcome to your collaborative workspace, ${name} [${initials}]`;
                }

                // Enable all controls
                setControlsEnabled(true);

                console.log(`User authenticated: ${initials} (${name})`);
            } else {
                alert(response.message || 'Failed to register user. Initials may have been taken.');
                userInitialsInput.classList.add('error');
                userNameInput.disabled = true;
                isUserAuthenticated = false;
                setControlsEnabled(false);
            }
        });
    }
}

// Function to populate Open submenu with known projects
function populateOpenSubmenu() {
    const submenu = document.getElementById('open-submenu');
    const knownProjects = getKnownProjects();
    const projectIds = Object.keys(knownProjects);

    // Sort by lastAccessed (most recent first)
    projectIds.sort((a, b) => {
        const dateA = new Date(knownProjects[a].lastAccessed);
        const dateB = new Date(knownProjects[b].lastAccessed);
        return dateB - dateA;
    });

    submenu.innerHTML = '';

    if (projectIds.length === 0) {
        const emptyItem = document.createElement('a');
        emptyItem.href = '#';
        emptyItem.textContent = 'No known projects';
        emptyItem.style.fontStyle = 'italic';
        emptyItem.style.color = '#999';
        emptyItem.addEventListener('click', (e) => e.preventDefault());
        submenu.appendChild(emptyItem);
    } else {
        projectIds.forEach(id => {
            const project = knownProjects[id];
            const item = document.createElement('a');
            item.href = '#';
            item.innerHTML = `${project.name}<span class="submenu-item-id">${id}</span>`;
            item.addEventListener('click', function(e) {
                e.preventDefault();
                openProject(id);
            });
            submenu.appendChild(item);
        });
    }
}

// Main application
document.addEventListener('DOMContentLoaded', function() {
    const projectNameEl = document.getElementById('project-name');
    const shareBtn = document.getElementById('share-btn');

    // Populate Open submenu
    populateOpenSubmenu();

    // Check if we should open a project on load
    if (currentProjectId) {
        openProject(currentProjectId);
    } else {
        closeProject();
    }

    // Handle hash changes (when URL is pasted or changed)
    window.addEventListener('hashchange', function() {
        const newProjectId = getProjectIdFromURL();
        if (newProjectId && newProjectId !== currentProjectId) {
            openProject(newProjectId);
        } else if (!newProjectId && isProjectOpen) {
            closeProject();
        }
    });

    // New menu item
    const newMenuItem = document.getElementById('menu-new');
    if (newMenuItem) {
        newMenuItem.addEventListener('click', function(e) {
            e.preventDefault();
            const newProjectId = generateProjectId();
            openProject(newProjectId);
        });
    }

    // Open submenu is handled by hover and populated dynamically

    // Close menu item
    const closeMenuItem = document.getElementById('menu-close');
    if (closeMenuItem) {
        closeMenuItem.addEventListener('click', function(e) {
            e.preventDefault();
            if (isProjectOpen && confirm('Close the current project?')) {
                closeProject();
            }
        });
    }

    // Exit menu item
    const exitMenuItem = document.getElementById('menu-exit');
    if (exitMenuItem) {
        exitMenuItem.addEventListener('click', function(e) {
            e.preventDefault();
            if (confirm('Are you sure you want to exit?')) {
                window.close();
            }
        });
    }

    // Show Log menu item
    const showLogMenuItem = document.getElementById('menu-show-log');
    const logModal = document.getElementById('log-modal');
    const logClearBtn = document.getElementById('log-clear');
    const logCloseBtn = document.getElementById('log-close');

    if (showLogMenuItem) {
        showLogMenuItem.addEventListener('click', function(e) {
            e.preventDefault();
            logModal.style.display = 'block';
            debugLog.updateDisplay();
        });
    }

    if (logClearBtn) {
        logClearBtn.addEventListener('click', function() {
            debugLog.clear();
        });
    }

    if (logCloseBtn) {
        logCloseBtn.addEventListener('click', function() {
            logModal.style.display = 'none';
        });
    }

    // Close log modal when clicking outside
    window.addEventListener('click', function(event) {
        if (event.target === logModal) {
            logModal.style.display = 'none';
        }
    });

    // About menu item
    const aboutMenuItem = document.getElementById('menu-about');
    if (aboutMenuItem) {
        aboutMenuItem.addEventListener('click', function(e) {
            e.preventDefault();
            alert('CardStorming v1.0\n\nA collaborative workspace for card-based brainstorming and ideation.\n\nDeveloped with Claude Code');
        });
    }

    // Share button - show dialog
    const shareModal = document.getElementById('share-modal');
    const shareMessage = document.getElementById('share-message');
    const shareCopyText = document.getElementById('share-copy-text');
    const shareCopyLink = document.getElementById('share-copy-link');
    const shareCancel = document.getElementById('share-cancel');

    shareBtn.addEventListener('click', function() {
        const projectName = projectNameEl.value.trim();
        const projectUrl = window.location.origin + window.location.pathname + '#' + currentProjectId;
        const message = `Join me in CardStorming on "${projectName}"!\n\n${projectUrl}`;

        // Display the message in the dialog
        shareMessage.textContent = message;

        // Show the dialog
        shareModal.style.display = 'block';
    });

    // Copy Text button
    shareCopyText.addEventListener('click', function() {
        const projectName = projectNameEl.value.trim();
        const projectUrl = window.location.origin + window.location.pathname + '#' + currentProjectId;
        const message = `Join me in CardStorming on "${projectName}"!\n\n${projectUrl}`;

        navigator.clipboard.writeText(message).then(function() {
            shareCopyText.textContent = '✓ Copied!';
            shareCopyText.style.backgroundColor = '#4CAF50';
            shareCopyText.style.color = 'white';
            setTimeout(function() {
                shareCopyText.textContent = 'Copy Text';
                shareCopyText.style.backgroundColor = '';
                shareCopyText.style.color = '';
                shareModal.style.display = 'none';
            }, 1000);
        }).catch(function(err) {
            alert('Failed to copy to clipboard');
        });
    });

    // Copy Link button
    shareCopyLink.addEventListener('click', function() {
        const projectUrl = window.location.origin + window.location.pathname + '#' + currentProjectId;

        navigator.clipboard.writeText(projectUrl).then(function() {
            shareCopyLink.textContent = '✓ Copied!';
            shareCopyLink.style.backgroundColor = '#4CAF50';
            shareCopyLink.style.color = 'white';
            setTimeout(function() {
                shareCopyLink.textContent = 'Copy Link';
                shareCopyLink.style.backgroundColor = '';
                shareCopyLink.style.color = '';
                shareModal.style.display = 'none';
            }, 1000);
        }).catch(function(err) {
            alert('Failed to copy to clipboard');
        });
    });

    // Cancel button
    shareCancel.addEventListener('click', function() {
        shareModal.style.display = 'none';
    });

    // Close modal when clicking outside
    window.addEventListener('click', function(event) {
        if (event.target === shareModal) {
            shareModal.style.display = 'none';
        }
    });

    // Project name editing
    projectNameEl.addEventListener('change', function() {
        const newName = projectNameEl.value.trim();
        if (newName && socket) {
            socket.emit('project:rename', { projectId: currentProjectId, name: newName });
        }
    });

    projectNameEl.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            projectNameEl.blur();
        }
    });

    // Zoom controls with press-and-hold
    const zoomOutBtn = document.getElementById('zoom-out-btn');
    const centerBtn = document.getElementById('center-btn');
    const zoomInBtn = document.getElementById('zoom-in-btn');

    let zoomInterval = null;
    const ZOOM_HOLD_DELAY = 500; // Initial delay before continuous zoom starts (ms)
    const ZOOM_HOLD_INTERVAL = 50; // Interval between zoom steps when holding (ms)

    function startContinuousZoom(zoomFunction, event) {
        // Immediate first zoom
        zoomFunction(event);

        // Start continuous zoom after delay (no event for continuous - zoom to center)
        let timeoutId = setTimeout(() => {
            zoomInterval = setInterval(() => zoomFunction(), ZOOM_HOLD_INTERVAL);
        }, ZOOM_HOLD_DELAY);

        return { timeoutId, intervalId: null };
    }

    function stopContinuousZoom(timers) {
        if (timers.timeoutId) clearTimeout(timers.timeoutId);
        if (zoomInterval) {
            clearInterval(zoomInterval);
            zoomInterval = null;
        }
    }

    if (zoomOutBtn) {
        let zoomOutTimers = {};

        zoomOutBtn.addEventListener('mousedown', function(e) {
            e.preventDefault();
            zoomOutTimers = startContinuousZoom(zoomOut, e);
        });

        zoomOutBtn.addEventListener('mouseup', function(e) {
            e.preventDefault();
            stopContinuousZoom(zoomOutTimers);
        });

        zoomOutBtn.addEventListener('mouseleave', function(e) {
            stopContinuousZoom(zoomOutTimers);
        });

        // Touch support
        zoomOutBtn.addEventListener('touchstart', function(e) {
            e.preventDefault();
            zoomOutTimers = startContinuousZoom(zoomOut, e);
        });

        zoomOutBtn.addEventListener('touchend', function(e) {
            e.preventDefault();
            stopContinuousZoom(zoomOutTimers);
        });
    }

    if (centerBtn) {
        centerBtn.addEventListener('click', function(e) {
            e.preventDefault();
            centerView();
        });
    }

    if (zoomInBtn) {
        let zoomInTimers = {};

        zoomInBtn.addEventListener('mousedown', function(e) {
            e.preventDefault();
            zoomInTimers = startContinuousZoom(zoomIn, e);
        });

        zoomInBtn.addEventListener('mouseup', function(e) {
            e.preventDefault();
            stopContinuousZoom(zoomInTimers);
        });

        zoomInBtn.addEventListener('mouseleave', function(e) {
            stopContinuousZoom(zoomInTimers);
        });

        // Touch support
        zoomInBtn.addEventListener('touchstart', function(e) {
            e.preventDefault();
            zoomInTimers = startContinuousZoom(zoomIn, e);
        });

        zoomInBtn.addEventListener('touchend', function(e) {
            e.preventDefault();
            stopContinuousZoom(zoomInTimers);
        });
    }

    // Card creation functionality with color wheel
    const addCardBtn = document.getElementById('add-card-btn');
    const modal = document.getElementById('card-modal');
    const modalOk = document.getElementById('modal-ok');
    const modalCancel = document.getElementById('modal-cancel');
    const cardTypeInput = document.getElementById('card-type');
    const colorWheel = document.getElementById('color-wheel');
    const colorPreview = document.getElementById('color-preview');

    let selectedColor = '#fff9c4'; // Default color

    // Draw color wheel
    function drawColorWheel() {
        const ctx = colorWheel.getContext('2d');
        const width = colorWheel.width;
        const height = colorWheel.height;
        const radius = width / 2;
        const centerX = width / 2;
        const centerY = height / 2;

        // Draw color wheel
        for (let angle = 0; angle < 360; angle++) {
            const startAngle = (angle - 1) * Math.PI / 180;
            const endAngle = angle * Math.PI / 180;

            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, startAngle, endAngle);
            ctx.closePath();

            const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
            const hue = angle;
            gradient.addColorStop(0, '#ffffff');
            gradient.addColorStop(0.7, `hsl(${hue}, 100%, 50%)`);
            gradient.addColorStop(1, `hsl(${hue}, 100%, 25%)`);

            ctx.fillStyle = gradient;
            ctx.fill();
        }
    }

    // Get color from wheel at click position
    function getColorAtPosition(x, y) {
        const rect = colorWheel.getBoundingClientRect();
        const canvasX = x - rect.left;
        const canvasY = y - rect.top;
        const ctx = colorWheel.getContext('2d');
        const imageData = ctx.getImageData(canvasX, canvasY, 1, 1).data;
        return `rgb(${imageData[0]}, ${imageData[1]}, ${imageData[2]})`;
    }

    // Convert RGB to hex
    function rgbToHex(rgb) {
        const match = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
        if (!match) return rgb;
        const r = parseInt(match[1]);
        const g = parseInt(match[2]);
        const b = parseInt(match[3]);
        return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    // Handle color wheel click
    colorWheel.addEventListener('click', function(e) {
        const color = getColorAtPosition(e.clientX, e.clientY);
        selectedColor = rgbToHex(color);
        colorPreview.style.backgroundColor = selectedColor;
    });

    addCardBtn.addEventListener('click', function() {
        drawColorWheel();
        modal.style.display = 'block';
        cardTypeInput.value = '';
        colorPreview.style.backgroundColor = selectedColor;
        cardTypeInput.focus();
    });

    modalCancel.addEventListener('click', function() {
        modal.style.display = 'none';
    });

    modalOk.addEventListener('click', function() {
        const cardType = cardTypeInput.value.trim();

        if (cardType === '') {
            alert('Please enter a card type name');
            return;
        }

        socket.emit('palette:add', {
            type: cardType,
            color: selectedColor
        });

        modal.style.display = 'none';
    });

    window.addEventListener('click', function(event) {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });

    cardTypeInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            modalOk.click();
        }
    });

    // Drag and Drop functionality
    const viewport = document.querySelector('.viewport');
    let draggedViewportCard = null;
    let offsetX = 0;
    let offsetY = 0;

    viewport.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = draggedViewportCard ? 'move' : 'copy';
        viewport.classList.add('drag-over');
    });

    viewport.addEventListener('dragleave', function(e) {
        if (e.target === viewport) {
            viewport.classList.remove('drag-over');
        }
    });

    // Card edit modal elements
    const editModal = document.getElementById('edit-modal');
    const editCloseBtn = document.getElementById('edit-close');
    const editDeleteBtn = document.getElementById('edit-delete');
    const editSaveBtn = document.getElementById('edit-save');
    const editCardVisual = document.getElementById('edit-card-visual');
    const editCardHeader = document.getElementById('edit-card-header');
    const editCardBody = document.getElementById('edit-card-body');
    let pendingCard = null;

    // Convert screen coordinates to workspace coordinates
    function screenToWorkspace(screenX, screenY) {
        const viewport = document.querySelector('.viewport');
        const viewportContent = document.querySelector('.viewport-content');
        const rect = viewport.getBoundingClientRect();
        const viewportStyle = window.getComputedStyle(viewport);
        const paddingLeft = parseFloat(viewportStyle.paddingLeft);
        const paddingTop = parseFloat(viewportStyle.paddingTop);

        // Get current pan offset from viewport-content transform
        let panX = 0, panY = 0;
        if (viewportContent) {
            const currentTransform = viewportContent.style.transform;
            if (currentTransform && currentTransform.includes('translate')) {
                const match = currentTransform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
                if (match) {
                    panX = parseFloat(match[1]);
                    panY = parseFloat(match[2]);
                }
            }
        }

        // Get position relative to viewport, accounting for padding, pan, and zoom
        // Formula: (screen - viewportOrigin - padding - pan) / zoom
        const contentX = (screenX - rect.left - paddingLeft - panX) / currentZoom;
        const contentY = (screenY - rect.top - paddingTop - panY) / currentZoom;

        debugLog.info('screenToWorkspace', {
            screenX,
            screenY,
            viewportRect: { left: rect.left, top: rect.top },
            padding: { left: paddingLeft, top: paddingTop },
            pan: { x: panX, y: panY },
            currentZoom,
            result: { x: contentX, y: contentY }
        });

        return { x: contentX, y: contentY };
    }

    // Handle drop events (both new cards and moving existing cards)
    viewport.addEventListener('drop', function(e) {
        e.preventDefault();
        viewport.classList.remove('drag-over');

        // Update focal point to drop location
        setFocalPointFromEvent(e);

        debugLog.info('Drop event', {
            clientX: e.clientX,
            clientY: e.clientY,
            isDraggingViewportCard: !!draggedViewportCard
        });

        // If dropping a viewport card (moving it)
        if (draggedViewportCard) {
            // Subtract the screen-space offset from the drop position before converting
            // This gives us the position where the top-left corner of the card should be
            const adjustedScreenX = e.clientX - offsetX;
            const adjustedScreenY = e.clientY - offsetY;

            const finalPos = screenToWorkspace(adjustedScreenX, adjustedScreenY);

            // Snap to grid
            const snappedX = snapToGrid(finalPos.x);
            const snappedY = snapToGrid(finalPos.y);

            debugLog.info('Moving existing card', {
                cardId: draggedViewportCard.dataset.id,
                screenPos: { x: e.clientX, y: e.clientY },
                offset: { x: offsetX, y: offsetY },
                adjustedScreen: { x: adjustedScreenX, y: adjustedScreenY },
                finalPos,
                snapped: { x: snappedX, y: snappedY }
            });

            socket.emit('viewport:move', {
                id: draggedViewportCard.dataset.id,
                left: snappedX + 'px',
                top: snappedY + 'px'
            });
            return;
        }

        // Otherwise it's a new card from palette
        const dataStr = e.dataTransfer.getData('text/plain');
        if (!dataStr) return;

        const data = JSON.parse(dataStr);
        const dropPos = screenToWorkspace(e.clientX, e.clientY);

        // Center the card under cursor (150px wide, 100px tall)
        let x = dropPos.x - 75;
        let y = dropPos.y - 50;

        // Snap to grid
        x = snapToGrid(x);
        y = snapToGrid(y);

        pendingCard = {
            id: generateId(),
            type: data.type,
            color: data.color,
            left: x + 'px',
            top: y + 'px'
        };

        debugLog.info('Creating new card', {
            dropPos,
            centered: { x, y },
            snapped: { x, y },
            pendingCard
        });

        editCardHeader.textContent = '';
        editCardBody.textContent = '';
        editCardVisual.style.backgroundColor = data.color;
        editCardVisual.style.color = getTextColorForBackground(data.color);
        editModal.style.display = 'block';
        editCardHeader.focus();
    });

    // Viewport card drag handlers
    viewport.addEventListener('dragstart', function(e) {
        if (e.target.classList.contains('viewport-card')) {
            draggedViewportCard = e.target;
            // Lock cursor to top-left corner for predictable grid snapping
            offsetX = 0;
            offsetY = 0;

            // Create custom drag ghost with gradient
            const ghost = e.target.cloneNode(true);
            ghost.classList.add('drag-ghost');
            ghost.style.width = e.target.offsetWidth + 'px';
            ghost.style.height = e.target.offsetHeight + 'px';
            document.body.appendChild(ghost);

            // Set the custom drag image
            e.dataTransfer.setDragImage(ghost, 0, 0);

            // Clean up the ghost after a brief moment
            setTimeout(() => {
                if (ghost.parentNode) {
                    ghost.parentNode.removeChild(ghost);
                }
            }, 0);

            // Add dragging class to original card
            e.target.classList.add('dragging');
        }
    }, false);

    viewport.addEventListener('dragend', function(e) {
        if (e.target.classList.contains('viewport-card')) {
            e.target.classList.remove('dragging');
            draggedViewportCard = null;
        }
    }, false);

    // Viewport panning (click and drag to move view)
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panOffsetX = 0;
    let panOffsetY = 0;
    let currentPanX = 0;
    let currentPanY = 0;

    viewport.addEventListener('mousedown', function(e) {
        // Only pan if clicking directly on viewport or viewport-content (not on a card)
        const viewportContent = document.querySelector('.viewport-content');
        if (e.target === viewport || e.target === viewportContent
            || e.target.classList.contains('viewport') || e.target.classList.contains('viewport-content')
            || (e.target.tagName === 'P' && e.target.parentElement === viewport)) {
            isPanning = true;
            panStartX = e.clientX;
            panStartY = e.clientY;
            panOffsetX = currentPanX;
            panOffsetY = currentPanY;
            viewport.style.cursor = 'grabbing';
            e.preventDefault();
        }
    });

    viewport.addEventListener('mousemove', function(e) {
        if (!isPanning) return;

        const dx = e.clientX - panStartX;
        const dy = e.clientY - panStartY;

        currentPanX = panOffsetX + dx;
        currentPanY = panOffsetY + dy;

        // Update viewport-content transform to include both pan and scale
        const viewportContent = document.querySelector('.viewport-content');
        if (viewportContent) {
            const originX = focalPoint.x * 100;
            const originY = focalPoint.y * 100;
            viewportContent.style.transform = `translate(${currentPanX}px, ${currentPanY}px) scale(${currentZoom})`;
            viewportContent.style.transformOrigin = `${originX}% ${originY}%`;
        }
    });

    viewport.addEventListener('mouseup', function(e) {
        if (isPanning) {
            isPanning = false;
            viewport.style.cursor = '';
        }
    });

    viewport.addEventListener('mouseleave', function(e) {
        if (isPanning) {
            isPanning = false;
            viewport.style.cursor = '';
        }
    });

    // Handle Enter key in header - move to body
    editCardHeader.addEventListener('keydown', function(e) {
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

    // Handle triple Enter in body - close and save
    let enterCount = 0;
    let lastEnterTime = 0;
    editCardBody.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            const now = Date.now();
            if (now - lastEnterTime < 500) {
                enterCount++;
            } else {
                enterCount = 1;
            }
            lastEnterTime = now;

            if (enterCount >= 3) {
                e.preventDefault();
                saveAndCloseEditModal();
                enterCount = 0;
            }
        } else {
            enterCount = 0;
        }
    });

    // Close button handler (cancel without saving)
    editCloseBtn.addEventListener('click', function() {
        editModal.style.display = 'none';
        pendingCard = null;
        editModal.dataset.editingCardId = '';
        enterCount = 0;
    });

    // Delete button handler
    editDeleteBtn.addEventListener('click', function() {
        const editingCardId = editModal.dataset.editingCardId;

        // Only allow deleting existing cards, not new ones
        if (editingCardId && confirm('Delete this card?')) {
            socket.emit('viewport:delete', { id: editingCardId });
            editModal.style.display = 'none';
            editModal.dataset.editingCardId = '';
            pendingCard = null;
            enterCount = 0;
        }
    });

    // Save button handler (save and close)
    editSaveBtn.addEventListener('click', function() {
        saveAndCloseEditModal();
    });

    // Save and close function
    function saveAndCloseEditModal() {
        const editingCardId = editModal.dataset.editingCardId;
        const header = editCardHeader.textContent.trim();

        // Extract body text preserving line breaks
        // contenteditable creates <div> or <br> for line breaks
        const body = editCardBody.innerHTML
            .replace(/<div><br><\/div>/g, '\n')  // Empty lines
            .replace(/<div>/g, '\n')              // Line breaks
            .replace(/<br\s*\/?>/g, '\n')         // <br> tags
            .replace(/<[^>]+>/g, '')              // Remove all other HTML tags
            .replace(/&nbsp;/g, ' ')              // Replace &nbsp; with space
            .replace(/&amp;/g, '&')               // Decode &amp;
            .replace(/&lt;/g, '<')                // Decode &lt;
            .replace(/&gt;/g, '>')                // Decode &gt;
            .trim();

        if (editingCardId) {
            // Editing existing card
            debugLog.info('Emitting viewport:update', {
                id: editingCardId,
                header,
                body
            });

            socket.emit('viewport:update', {
                id: editingCardId,
                header: header,
                body: body
            });
            editModal.dataset.editingCardId = '';
        } else if (pendingCard) {
            // Creating new card
            const cardData = {
                id: pendingCard.id,
                header: header || pendingCard.type,
                body: body,
                color: pendingCard.color,
                left: pendingCard.left,
                top: pendingCard.top,
                authorInitials: currentUserInitials
            };

            debugLog.info('Emitting viewport:add', cardData);

            socket.emit('viewport:add', cardData);
            pendingCard = null;
        }

        editModal.style.display = 'none';
        enterCount = 0;
    }

    // Click outside modal to close
    window.addEventListener('click', function(event) {
        if (event.target === editModal) {
            editModal.style.display = 'none';
            editModal.dataset.editingCardId = '';
            pendingCard = null;
            enterCount = 0;
        }
    });
});
