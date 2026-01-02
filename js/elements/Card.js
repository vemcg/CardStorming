// Card element - extends DraggableElement

import { DraggableElement } from '../core/DraggableElement.js';
import { debugLog } from '../utils/DebugLog.js';

export class Card extends DraggableElement {
    constructor(x, y, id, header, body, color, authorInitials, zIndex = 1) {
        super(x, y, { isPersistent: true });

        this.id = id;
        this.header = header || '';
        this.body = body || '';
        this.color = color || '#FFF59D';
        this.authorInitials = authorInitials || '';
        this.zIndex = zIndex;

        this.isExpanded = false;
    }

    /**
     * Calculate text color based on background brightness
     */
    getTextColor() {
        // Convert hex to RGB
        const hex = this.color.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);

        // Calculate relative luminance
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

        // Return white for dark backgrounds, black for light
        return luminance > 0.5 ? '#000000' : '#FFFFFF';
    }

    /**
     * Render card to DOM
     */
    render(viewportManager) {
        const card = document.createElement('div');
        card.className = 'viewport-card';
        card.dataset.id = this.id;
        card.dataset.header = this.header;
        card.dataset.body = this.body;

        card.style.position = 'absolute';
        card.style.width = '150px';
        card.style.minHeight = '120px';
        card.style.height = 'auto';
        card.style.backgroundColor = this.color;
        card.style.cursor = 'grab';
        card.style.userSelect = 'none';
        card.style.zIndex = this.zIndex;
        card.style.padding = '8px 8px 4px 8px';
        card.style.boxSizing = 'border-box';
        card.style.overflow = 'hidden';
        card.style.wordWrap = 'break-word';

        // Plain colored background
        card.style.backgroundColor = this.color;

        // Calculate text color based on background brightness
        const textColor = this.getTextColor();

        // Header text
        const headerDiv = document.createElement('div');
        headerDiv.style.fontSize = '11px';
        headerDiv.style.fontWeight = 'bold';
        headerDiv.style.lineHeight = '1.2';
        headerDiv.style.marginBottom = '4px';
        headerDiv.style.overflow = 'hidden';
        headerDiv.style.textOverflow = 'ellipsis';
        headerDiv.style.whiteSpace = 'nowrap';
        headerDiv.style.color = textColor;
        headerDiv.textContent = this.header;
        card.appendChild(headerDiv);

        // Body text
        const bodyDiv = document.createElement('div');
        bodyDiv.style.fontSize = '9px';
        bodyDiv.style.lineHeight = '1.4';
        bodyDiv.style.overflow = 'visible';
        bodyDiv.style.color = textColor;
        bodyDiv.style.whiteSpace = 'pre-wrap';
        bodyDiv.textContent = this.body;
        card.appendChild(bodyDiv);

        // Author initials in top right
        if (this.authorInitials) {
            const initialsDiv = document.createElement('div');
            initialsDiv.className = 'card-initials';
            initialsDiv.style.position = 'absolute';
            initialsDiv.style.top = '8px';
            initialsDiv.style.right = '8px';
            initialsDiv.style.fontSize = '11px';
            initialsDiv.style.fontWeight = 'bold';
            initialsDiv.style.color = textColor;
            initialsDiv.style.zIndex = '2';
            initialsDiv.textContent = this.authorInitials;
            card.appendChild(initialsDiv);
        }

        this.element = card;
        this.updatePosition(viewportManager);

        // Attach event listeners
        this.attachEventListeners(viewportManager);

        return card;
    }

    /**
     * Attach mouse event listeners
     */
    attachEventListeners(viewportManager) {
        this.element.addEventListener('mousedown', (e) => {
            // Global appState will be passed during drag
            this.startDrag(e, viewportManager);
        });
    }

    /**
     * Handle click - open edit modal
     */
    onClick(e, viewportManager, appState) {
        debugLog.info('Card clicked - opening edit modal', { id: this.id });

        // Set focal point to card
        viewportManager.setFocalPointFromEvent(e);

        // Trigger edit modal (will be handled by app.js)
        const editEvent = new CustomEvent('card:edit', {
            detail: {
                card: this,
                mouseEvent: e
            }
        });
        document.dispatchEvent(editEvent);
    }

    /**
     * Handle drop - update position on server
     */
    onDrop(e, viewportManager, appState) {
        debugLog.info('Card dropped', { id: this.id, x: this.x, y: this.y });

        // Check if dropped on a wormhole
        const wormholes = Array.from(appState.wormholes.values());
        for (const wormhole of wormholes) {
            const distance = Math.sqrt(
                Math.pow(this.x - wormhole.x, 2) +
                Math.pow(this.y - wormhole.y, 2)
            );

            // If within 60 pixels of wormhole center, teleport to partner
            if (distance < 60) {
                const partner = appState.wormholes.get(wormhole.partnerId);
                if (partner) {
                    debugLog.info('Card teleported through wormhole', {
                        cardId: this.id,
                        from: wormhole.id,
                        to: partner.id
                    });

                    // Teleport card to partner wormhole location
                    this.x = partner.x;
                    this.y = partner.y;
                    this.updatePosition(viewportManager);

                    // Emit update to server
                    if (appState.socket) {
                        appState.socket.emit('viewport:move', {
                            id: this.id,
                            x: this.x,
                            y: this.y,
                            zIndex: this.zIndex
                        });
                    }

                    return;
                }
            }
        }

        // Normal drop - emit to server
        if (appState.socket) {
            appState.socket.emit('viewport:move', {
                id: this.id,
                x: this.x,
                y: this.y,
                zIndex: this.zIndex
            });
        }
    }

    /**
     * Expand card for preview
     */
    expand() {
        if (this.isExpanded) return;

        this.isExpanded = true;
        this.element.style.transform = 'scale(1.5)';
        this.element.style.zIndex = '999';
        this.element.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';

        debugLog.info('Card expanded', { id: this.id });
    }

    /**
     * Collapse card from preview
     */
    collapse() {
        if (!this.isExpanded) return;

        this.isExpanded = false;
        this.element.style.transform = '';
        this.element.style.zIndex = this.zIndex;
        this.element.style.boxShadow = '';

        debugLog.info('Card collapsed', { id: this.id });
    }

    /**
     * Update card content
     */
    updateContent(header, body) {
        this.header = header;
        this.body = body;
        this.element.dataset.header = header;
        this.element.dataset.body = body;

        // Update DOM
        const headerDiv = this.element.querySelector('div:first-child');
        const bodyDiv = this.element.querySelector('div:nth-child(2)');
        if (headerDiv) headerDiv.textContent = header;
        if (bodyDiv) bodyDiv.textContent = body;

        debugLog.info('Card content updated', { id: this.id, header, body });
    }

    /**
     * Serialize card for storage/network
     */
    serialize() {
        return {
            id: this.id,
            x: this.x,
            y: this.y,
            header: this.header,
            body: this.body,
            color: this.color,
            authorInitials: this.authorInitials,
            zIndex: this.zIndex
        };
    }
}
