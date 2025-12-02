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
        const cardHeaderInput = document.getElementById('card-header');
        const cardBodyInput = document.getElementById('card-body');

        cardHeaderInput.value = card.dataset.header || '';
        cardBodyInput.value = card.dataset.body || '';
        editModal.dataset.editingCardId = card.dataset.id;
        editModal.style.display = 'block';
        cardHeaderInput.focus();
    }

    // Create a palette card
    function createPaletteCard(type, color) {
        const cardStack = document.createElement('div');
        cardStack.className = 'card-stack';
        cardStack.style.backgroundColor = color;

        const card = document.createElement('div');
        card.className = 'palette-card';
        card.style.backgroundColor = color;
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
            projectNameEl.value = serverState.projectName;
            saveKnownProject(currentProjectId, serverState.projectName);
        } else {
            const randomName = generateProjectName();
            projectNameEl.value = randomName;
            socket.emit('project:rename', { projectId: currentProjectId, name: randomName });
            saveKnownProject(currentProjectId, randomName);
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

// Main application
document.addEventListener('DOMContentLoaded', function() {
    const projectNameEl = document.getElementById('project-name');
    const shareBtn = document.getElementById('share-btn');

    // Check if we should open a project on load
    if (currentProjectId) {
        openProject(currentProjectId);
    } else {
        closeProject();
    }

    // New menu item
    const newMenuItem = document.getElementById('menu-new');
    if (newMenuItem) {
        newMenuItem.addEventListener('click', function(e) {
            e.preventDefault();
            const newProjectId = generateProjectId();
            openProject(newProjectId);
        });
    }

    // Open menu item
    const openMenuItem = document.getElementById('menu-open');
    if (openMenuItem) {
        openMenuItem.addEventListener('click', function(e) {
            e.preventDefault();
            const knownProjects = getKnownProjects();
            const projectIds = Object.keys(knownProjects);

            if (projectIds.length === 0) {
                alert('No known projects yet. Create a new project or open one from a shared link.');
                return;
            }

            let message = 'Known Projects:\n\n';
            projectIds.forEach((id, index) => {
                const project = knownProjects[id];
                message += `${index + 1}. ${project.name} (${id})\n`;
            });
            message += '\nEnter the number of the project to open, or paste a project URL/ID:';

            const input = prompt(message);
            if (input) {
                let id = null;
                const num = parseInt(input);
                if (!isNaN(num) && num > 0 && num <= projectIds.length) {
                    id = projectIds[num - 1];
                } else {
                    id = input;
                    if (input.includes('#')) {
                        id = input.split('#')[1];
                    }
                }

                if (id) {
                    openProject(id);
                }
            }
        });
    }

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

    // Share button
    shareBtn.addEventListener('click', function() {
        const projectName = projectNameEl.value.trim();
        const projectUrl = window.location.origin + window.location.pathname + '#' + currentProjectId;
        const message = `Join me in CardStorming on "${projectName}"!\n\n${projectUrl}`;
        const htmlMessage = `<p>Join me in CardStorming on "<a href="${projectUrl}">${projectName}</a>"!</p><p><a href="${projectUrl}">${projectUrl}</a></p>`;

        if (navigator.clipboard && window.ClipboardItem) {
            const blob = new Blob([htmlMessage], { type: 'text/html' });
            const textBlob = new Blob([message], { type: 'text/plain' });
            const clipboardItem = new ClipboardItem({
                'text/html': blob,
                'text/plain': textBlob
            });

            navigator.clipboard.write([clipboardItem]).then(function() {
                const originalText = shareBtn.textContent;
                shareBtn.textContent = '✓ Copied!';
                shareBtn.style.backgroundColor = 'rgba(76, 175, 80, 0.3)';
                setTimeout(function() {
                    shareBtn.textContent = originalText;
                    shareBtn.style.backgroundColor = '';
                }, 2000);
            }).catch(function(err) {
                navigator.clipboard.writeText(message).then(function() {
                    alert('Share message copied to clipboard!');
                });
            });
        } else {
            navigator.clipboard.writeText(message).then(function() {
                alert('Share message copied to clipboard!');
            }).catch(function(err) {
                prompt('Copy this message to share:', message);
            });
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

    // Card creation functionality
    const addCardBtn = document.getElementById('add-card-btn');
    const modal = document.getElementById('card-modal');
    const modalOk = document.getElementById('modal-ok');
    const modalCancel = document.getElementById('modal-cancel');
    const cardTypeInput = document.getElementById('card-type');
    const cardColorSelect = document.getElementById('card-color');

    addCardBtn.addEventListener('click', function() {
        modal.style.display = 'block';
        cardTypeInput.value = '';
        cardTypeInput.focus();
    });

    modalCancel.addEventListener('click', function() {
        modal.style.display = 'none';
    });

    modalOk.addEventListener('click', function() {
        const cardType = cardTypeInput.value.trim();
        const cardColor = cardColorSelect.value;

        if (cardType === '') {
            alert('Please enter a card type name');
            return;
        }

        socket.emit('palette:add', {
            type: cardType,
            color: cardColor
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
    const editOkBtn = document.getElementById('edit-ok');
    const editCancelBtn = document.getElementById('edit-cancel');
    const cardHeaderInput = document.getElementById('card-header');
    const cardBodyInput = document.getElementById('card-body');
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

        cardHeaderInput.value = '';
        cardBodyInput.value = '';
        editModal.style.display = 'block';
        cardHeaderInput.focus();
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

    // Edit modal handlers
    editOkBtn.addEventListener('click', function() {
        const editingCardId = editModal.dataset.editingCardId;
        const header = cardHeaderInput.value.trim();
        const body = cardBodyInput.value.trim();

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
    });

    editCancelBtn.addEventListener('click', function() {
        editModal.style.display = 'none';
        editModal.dataset.editingCardId = '';
        pendingCard = null;
    });

    cardHeaderInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            editOkBtn.click();
        }
    });

    window.addEventListener('click', function(event) {
        if (event.target === editModal) {
            editModal.style.display = 'none';
            editModal.dataset.editingCardId = '';
            pendingCard = null;
        }
    });
});
