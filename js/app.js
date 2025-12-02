// CardStorming application
console.log('CardStorming initialized');

// Menu interactions
document.addEventListener('DOMContentLoaded', function() {
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

    // Card creation functionality
    const addCardBtn = document.getElementById('add-card-btn');
    const modal = document.getElementById('card-modal');
    const modalOk = document.getElementById('modal-ok');
    const modalCancel = document.getElementById('modal-cancel');
    const cardTypeInput = document.getElementById('card-type');
    const cardColorSelect = document.getElementById('card-color');
    const cardList = document.getElementById('card-list');

    // Open modal when + button is clicked
    addCardBtn.addEventListener('click', function() {
        modal.style.display = 'block';
        cardTypeInput.value = '';
        cardTypeInput.focus();
    });

    // Close modal on cancel
    modalCancel.addEventListener('click', function() {
        modal.style.display = 'none';
    });

    // Create card on OK
    modalOk.addEventListener('click', function() {
        const cardType = cardTypeInput.value.trim();
        const cardColor = cardColorSelect.value;

        if (cardType === '') {
            alert('Please enter a card type name');
            return;
        }

        // Create palette card
        createPaletteCard(cardType, cardColor);

        // Save state
        saveState();

        // Close modal
        modal.style.display = 'none';
    });

    // Close modal when clicking outside of it
    window.addEventListener('click', function(event) {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });

    // Allow Enter key to submit
    cardTypeInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            modalOk.click();
        }
    });

    // Drag and Drop functionality
    const viewport = document.querySelector('.viewport');
    let draggedCard = null;
    let maxZIndex = 1; // Track highest z-index
    let draggedViewportCard = null;
    let offsetX = 0;
    let offsetY = 0;

    function handleDragStart(e) {
        draggedCard = e.target;
        e.target.classList.add('dragging');

        // Store card data
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', JSON.stringify({
            type: e.target.dataset.cardType,
            color: e.target.dataset.cardColor
        }));
    }

    function handleDragEnd(e) {
        e.target.classList.remove('dragging');
        draggedCard = null;
    }

    // Viewport drag and drop handlers
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
            const x = e.clientX - viewportRect.left - offsetX;
            const y = e.clientY - viewportRect.top - offsetY;

            draggedViewportCard.style.left = Math.max(0, x) + 'px';
            draggedViewportCard.style.top = Math.max(0, y) + 'px';

            // Bring moved card to front
            bringToFront(draggedViewportCard);

            // Save state after moving
            saveState();
            return;
        }

        // Otherwise it's a new card from palette
        const dataStr = e.dataTransfer.getData('text/plain');
        if (!dataStr) return;

        const data = JSON.parse(dataStr);

        // Calculate drop position relative to viewport
        const viewportRect = viewport.getBoundingClientRect();
        const x = e.clientX - viewportRect.left - 75;
        const y = e.clientY - viewportRect.top - 50;

        // Create new card in viewport
        const newCard = document.createElement('div');
        newCard.className = 'viewport-card';
        newCard.style.backgroundColor = data.color;
        newCard.style.left = Math.max(0, x) + 'px';
        newCard.style.top = Math.max(0, y) + 'px';

        // Store card reference and data
        pendingCard = {
            element: newCard,
            type: data.type,
            color: data.color
        };

        // Show edit modal
        cardHeaderInput.value = '';
        cardBodyInput.value = '';
        editModal.style.display = 'block';
        cardHeaderInput.focus();
    });

    function handleViewportCardDragStart(e) {
        draggedViewportCard = e.currentTarget;
        const rect = e.currentTarget.getBoundingClientRect();
        const viewportRect = viewport.getBoundingClientRect();

        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;

        e.currentTarget.style.opacity = '0.5';
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', ''); // Required for Firefox
    }

    function handleViewportCardDragEnd(e) {
        e.currentTarget.style.opacity = '1';
        draggedViewportCard = null;
    }

    // Function to update card content
    function updateCardContent(card, header, body) {
        // Create card content structure
        const headerDiv = document.createElement('div');
        headerDiv.className = 'card-header';
        headerDiv.textContent = header;

        const bodyDiv = document.createElement('div');
        bodyDiv.className = 'card-body';
        bodyDiv.textContent = body;

        // Clear and populate card
        card.innerHTML = '';
        card.appendChild(headerDiv);
        if (body) {
            card.appendChild(bodyDiv);
        }

        // Store card data
        card.dataset.header = header;
        card.dataset.body = body;
    }

    // Function to bring card to front
    function bringToFront(card) {
        maxZIndex++;
        card.style.zIndex = maxZIndex;
    }

    // Save state to localStorage
    function saveState() {
        // Save palette card types
        const paletteCards = [];
        document.querySelectorAll('.palette-card').forEach(card => {
            paletteCards.push({
                type: card.dataset.cardType,
                color: card.dataset.cardColor
            });
        });

        // Save viewport cards
        const viewportCards = [];
        document.querySelectorAll('.viewport-card').forEach(card => {
            viewportCards.push({
                header: card.dataset.header || '',
                body: card.dataset.body || '',
                color: card.style.backgroundColor,
                left: card.style.left,
                top: card.style.top,
                zIndex: card.style.zIndex
            });
        });

        localStorage.setItem('cardstorming_palette', JSON.stringify(paletteCards));
        localStorage.setItem('cardstorming_viewport', JSON.stringify(viewportCards));
        localStorage.setItem('cardstorming_maxZIndex', maxZIndex);
    }

    // Load state from localStorage
    function loadState() {
        // Load palette cards
        const paletteData = localStorage.getItem('cardstorming_palette');
        if (paletteData) {
            const paletteCards = JSON.parse(paletteData);
            paletteCards.forEach(cardData => {
                createPaletteCard(cardData.type, cardData.color);
            });
        }

        // Load viewport cards
        const viewportData = localStorage.getItem('cardstorming_viewport');
        if (viewportData) {
            const viewportCards = JSON.parse(viewportData);
            viewportCards.forEach(cardData => {
                createViewportCard(cardData.header, cardData.body, cardData.color, cardData.left, cardData.top, cardData.zIndex);
            });
        }

        // Load maxZIndex
        const savedMaxZIndex = localStorage.getItem('cardstorming_maxZIndex');
        if (savedMaxZIndex) {
            maxZIndex = parseInt(savedMaxZIndex);
        }
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
    function createViewportCard(header, body, color, left, top, zIndex) {
        const card = document.createElement('div');
        card.className = 'viewport-card';
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

    // Edit modal OK button
    editOkBtn.addEventListener('click', function() {
        if (!pendingCard) return;

        const header = cardHeaderInput.value.trim();
        const body = cardBodyInput.value.trim();

        // Update card content
        updateCardContent(pendingCard.element, header || pendingCard.type, body);

        // Set z-index and bring to front
        bringToFront(pendingCard.element);

        // If this is a new card (not yet in viewport)
        if (!pendingCard.element.parentNode) {
            // Make card draggable
            pendingCard.element.draggable = true;
            pendingCard.element.addEventListener('dragstart', handleViewportCardDragStart);
            pendingCard.element.addEventListener('dragend', handleViewportCardDragEnd);
            pendingCard.element.addEventListener('dblclick', handleCardDoubleClick);

            // Add to viewport
            viewport.appendChild(pendingCard.element);
        }

        // Save state
        saveState();

        // Close modal
        editModal.style.display = 'none';
        pendingCard = null;
    });

    // Edit modal Cancel button
    editCancelBtn.addEventListener('click', function() {
        editModal.style.display = 'none';
        pendingCard = null;
    });

    // Allow Enter in header to submit
    cardHeaderInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            editOkBtn.click();
        }
    });

    // Close edit modal when clicking outside
    window.addEventListener('click', function(event) {
        if (event.target === editModal) {
            editModal.style.display = 'none';
            pendingCard = null;
        }
    });

    // Double-click handler for editing cards
    function handleCardDoubleClick(e) {
        e.preventDefault();
        const card = e.currentTarget;

        // Set up pending card for editing
        pendingCard = {
            element: card,
            type: card.dataset.header || '',
            color: card.style.backgroundColor
        };

        // Populate modal with current values
        cardHeaderInput.value = card.dataset.header || '';
        cardBodyInput.value = card.dataset.body || '';

        // Show edit modal
        editModal.style.display = 'block';
        cardHeaderInput.focus();
    }

    // Load saved state on page load
    loadState();
});
