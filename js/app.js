// CardStorming application
console.log('CardStorming initialized');

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

// Function to disable/enable UI controls
function setControlsEnabled(enabled) {
    const addCardBtn = document.getElementById('add-card-btn');
    const projectNameEl = document.getElementById('project-name');
    const shareBtn = document.getElementById('share-btn');
    const viewport = document.querySelector('.viewport');
    const palette = document.querySelector('.palette');

    if (addCardBtn) addCardBtn.disabled = !enabled;
    if (projectNameEl) projectNameEl.disabled = !enabled;
    if (shareBtn) shareBtn.disabled = !enabled;

    if (viewport) {
        viewport.style.opacity = enabled ? '1' : '0.5';
        viewport.style.pointerEvents = enabled ? 'auto' : 'none';
    }
    if (palette) {
        palette.style.opacity = enabled ? '1' : '0.5';
        palette.style.pointerEvents = enabled ? 'auto' : 'none';
    }
}

// Function to open a project
function openProject(projectId) {
    currentProjectId = projectId;
    setProjectIdInURL(projectId);
    isProjectOpen = true;

    // Initialize Socket.IO connection with project ID
    if (socket) {
        socket.disconnect();
    }
    socket = io({
        query: { projectId: currentProjectId }
    });

    // Set up socket event listeners
    setupSocketListeners();

    // Enable controls
    setControlsEnabled(true);

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
    const viewport = document.querySelector('.viewport');
    const cardList = document.getElementById('card-list');
    if (viewport) {
        viewport.querySelectorAll('.viewport-card').forEach(card => card.remove());
    }
    if (cardList) {
        cardList.innerHTML = '';
    }

    // Clear project name
    const projectNameEl = document.getElementById('project-name');
    if (projectNameEl) {
        projectNameEl.value = 'No Project Open';
    }

    // Disable controls
    setControlsEnabled(false);
}

// Setup socket event listeners
function setupSocketListeners() {
    const projectNameEl = document.getElementById('project-name');
    const cardList = document.getElementById('card-list');
    const viewport = document.querySelector('.viewport');

    // Work surface offset - allows negative coordinates by offsetting the origin
    const WORK_SURFACE_OFFSET = 10000; // pixels

    // Center viewport on work surface origin (0,0)
    function centerViewport() {
        viewport.scrollLeft = WORK_SURFACE_OFFSET - viewport.clientWidth / 2;
        viewport.scrollTop = WORK_SURFACE_OFFSET - viewport.clientHeight / 2;
    }

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

    function handleViewportCardDragStart(e) {
        e.currentTarget.dragOffsetX = e.clientX - e.currentTarget.getBoundingClientRect().left;
        e.currentTarget.dragOffsetY = e.clientY - e.currentTarget.getBoundingClientRect().top;
        e.currentTarget.style.opacity = '0.5';
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', '');
    }

    function handleViewportCardDragEnd(e) {
        e.currentTarget.style.opacity = '1';
    }

    function handleCardDoubleClick(e) {
        e.preventDefault();
        const card = e.currentTarget;
        const editModal = document.getElementById('edit-modal');
        const editCardVisual = document.getElementById('edit-card-visual');
        const editCardHeader = document.getElementById('edit-card-header');
        const editCardBody = document.getElementById('edit-card-body');

        editCardHeader.textContent = card.dataset.header || '';
        editCardBody.textContent = card.dataset.body || '';
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
    function createViewportCard(id, header, body, color, left, top, zIndex) {
        const card = document.createElement('div');
        card.className = 'viewport-card';
        card.dataset.id = id;
        card.style.backgroundColor = color;
        card.style.color = getTextColorForBackground(color);
        card.style.left = left;
        card.style.top = top;
        card.style.zIndex = zIndex || 1;

        updateCardContent(card, header, body);

        card.draggable = true;
        card.addEventListener('dragstart', handleViewportCardDragStart);
        card.addEventListener('dragend', handleViewportCardDragEnd);
        card.addEventListener('dblclick', handleCardDoubleClick);

        viewport.appendChild(card);
    }

    // WebSocket event listeners
    socket.on('state:init', (serverState) => {
        // Clear existing cards
        cardList.innerHTML = '';
        viewport.querySelectorAll('.viewport-card').forEach(card => card.remove());

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
            createViewportCard(cardData.id, cardData.header, cardData.body, cardData.color, cardData.left, cardData.top, cardData.zIndex);
        });

        // Center viewport after loading initial state
        centerViewport();
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
        createViewportCard(cardData.id, cardData.header, cardData.body, cardData.color, cardData.left, cardData.top, cardData.zIndex);
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
    const editSaveBtn = document.getElementById('edit-save');
    const editCardVisual = document.getElementById('edit-card-visual');
    const editCardHeader = document.getElementById('edit-card-header');
    const editCardBody = document.getElementById('edit-card-body');
    let pendingCard = null;

    // Handle drop events (both new cards and moving existing cards)
    viewport.addEventListener('drop', function(e) {
        e.preventDefault();
        viewport.classList.remove('drag-over');

        // If dropping a viewport card (moving it)
        if (draggedViewportCard) {
            const viewportRect = viewport.getBoundingClientRect();
            const viewportStyle = window.getComputedStyle(viewport);
            const paddingLeft = parseInt(viewportStyle.paddingLeft);
            const paddingTop = parseInt(viewportStyle.paddingTop);

            const x = e.clientX - viewportRect.left - paddingLeft + viewport.scrollLeft - offsetX;
            const y = e.clientY - viewportRect.top - paddingTop + viewport.scrollTop - offsetY;

            socket.emit('viewport:move', {
                id: draggedViewportCard.dataset.id,
                left: x + 'px',
                top: y + 'px'
            });
            return;
        }

        // Otherwise it's a new card from palette
        const dataStr = e.dataTransfer.getData('text/plain');
        if (!dataStr) return;

        const data = JSON.parse(dataStr);
        const viewportRect = viewport.getBoundingClientRect();
        const viewportStyle = window.getComputedStyle(viewport);
        const paddingLeft = parseInt(viewportStyle.paddingLeft);
        const paddingTop = parseInt(viewportStyle.paddingTop);

        const x = e.clientX - viewportRect.left - paddingLeft + viewport.scrollLeft - 75;
        const y = e.clientY - viewportRect.top - paddingTop + viewport.scrollTop - 50;

        pendingCard = {
            id: generateId(),
            type: data.type,
            color: data.color,
            left: x + 'px',
            top: y + 'px'
        };

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
            const rect = e.target.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            e.target.style.opacity = '0.5';
        }
    }, true);

    viewport.addEventListener('dragend', function(e) {
        if (e.target.classList.contains('viewport-card')) {
            e.target.style.opacity = '1';
            draggedViewportCard = null;
        }
    }, true);

    // Viewport panning (click and drag to move view)
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panScrollLeft = 0;
    let panScrollTop = 0;

    viewport.addEventListener('mousedown', function(e) {
        // Only pan if clicking directly on viewport (not on a card)
        if (e.target === viewport || e.target.classList.contains('viewport')
            || (e.target.tagName === 'P' && e.target.parentElement === viewport)) {
            isPanning = true;
            panStartX = e.clientX;
            panStartY = e.clientY;
            panScrollLeft = viewport.scrollLeft;
            panScrollTop = viewport.scrollTop;
            viewport.style.cursor = 'grabbing';
            e.preventDefault();
        }
    });

    viewport.addEventListener('mousemove', function(e) {
        if (!isPanning) return;

        const dx = e.clientX - panStartX;
        const dy = e.clientY - panStartY;

        viewport.scrollLeft = panScrollLeft - dx;
        viewport.scrollTop = panScrollTop - dy;
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

    // Save button handler (save and close)
    editSaveBtn.addEventListener('click', function() {
        saveAndCloseEditModal();
    });

    // Save and close function
    function saveAndCloseEditModal() {
        const editingCardId = editModal.dataset.editingCardId;
        const header = editCardHeader.textContent.trim();
        const body = editCardBody.textContent.trim();

        if (editingCardId) {
            // Editing existing card
            socket.emit('viewport:update', {
                id: editingCardId,
                header: header,
                body: body
            });
            editModal.dataset.editingCardId = '';
        } else if (pendingCard) {
            // Creating new card
            socket.emit('viewport:add', {
                id: pendingCard.id,
                header: header || pendingCard.type,
                body: body,
                color: pendingCard.color,
                left: pendingCard.left,
                top: pendingCard.top
            });
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
