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
        this.enableAutoZoom = true;
        this._lastClickTime = 0;
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
        card.dataset.tooltip = 'Single-click to select · Double-click to edit · Drag to move · Drop on a wormhole to teleport';

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

        // Top row: header text + initials side by side via flexbox
        const topRow = document.createElement('div');
        topRow.style.display = 'flex';
        topRow.style.alignItems = 'flex-start';
        topRow.style.gap = '4px';
        topRow.style.marginBottom = '4px';
        topRow.style.width = '100%';

        const headerDiv = document.createElement('div');
        headerDiv.className = 'card-header-text';
        headerDiv.style.fontSize = '11px';
        headerDiv.style.fontWeight = 'bold';
        headerDiv.style.lineHeight = '1.2';
        headerDiv.style.overflow = 'hidden';
        headerDiv.style.textOverflow = 'ellipsis';
        headerDiv.style.whiteSpace = 'nowrap';
        headerDiv.style.color = textColor;
        headerDiv.style.flex = '1';
        headerDiv.style.minWidth = '0'; // required for ellipsis inside flex
        headerDiv.textContent = this.header;
        topRow.appendChild(headerDiv);

        if (this.authorInitials) {
            const initialsDiv = document.createElement('div');
            initialsDiv.className = 'card-initials';
            initialsDiv.style.fontSize = '11px';
            initialsDiv.style.fontWeight = 'bold';
            initialsDiv.style.color = textColor;
            initialsDiv.style.flexShrink = '0';
            initialsDiv.style.lineHeight = '1.2';
            initialsDiv.textContent = this.authorInitials;
            topRow.appendChild(initialsDiv);
        }

        card.appendChild(topRow);

        // Body text
        const bodyDiv = document.createElement('div');
        bodyDiv.className = 'card-body-text';
        bodyDiv.style.fontSize = '9px';
        bodyDiv.style.lineHeight = '1.4';
        bodyDiv.style.overflow = 'visible';
        bodyDiv.style.color = textColor;
        bodyDiv.style.whiteSpace = 'pre-wrap';
        bodyDiv.textContent = this.body;
        card.appendChild(bodyDiv);

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
     * Handle click - single click selects, double click opens edit modal
     */
    onClick(e, viewportManager, appState) {
        const now = Date.now();
        const isDouble = (now - this._lastClickTime) < 350;
        this._lastClickTime = now;

        if (isDouble) {
            debugLog.info('Card double-clicked - opening edit modal', { id: this.id });
            viewportManager.setFocalPointFromEvent(e);
            document.dispatchEvent(new CustomEvent('card:edit', {
                detail: { card: this, mouseEvent: e }
            }));
        } else {
            debugLog.info('Card single-clicked - selecting', { id: this.id });
            document.dispatchEvent(new CustomEvent('card:select', {
                detail: { card: this, addToSelection: e.ctrlKey || e.metaKey }
            }));
        }
    }

    /**
     * Handle drop - update position on server
     */
    onDrop(e, viewportManager, appState) {
        debugLog.info('Card dropped', { id: this.id, x: this.x, y: this.y });

        // If card was selected before drag, moving it makes the elevated z-index permanent
        if (this._preSelectZIndex !== undefined) {
            const newZ = (appState ? appState.maxZIndex : 1000) + 1;
            this.zIndex = newZ;
            if (appState) appState.maxZIndex = newZ;
            if (this.element) this.element.style.zIndex = String(newZ);
            delete this._preSelectZIndex;
        }

        // Check if dropped on a wormhole (bounding box overlap)
        const cardW = 150, cardH = 120;
        const wormW = 160, wormH = 100;
        const wormholes = Array.from(appState.wormholes.values());
        for (const wormhole of wormholes) {
            const overlaps = (
                this.x < wormhole.x + wormW &&
                this.x + cardW > wormhole.x &&
                this.y < wormhole.y + wormH &&
                this.y + cardH > wormhole.y
            );

            if (overlaps) {
                const partner = appState.wormholes.get(wormhole.partnerId);
                if (partner) {
                    // Calculate offset from drag start to wormhole
                    const offsetX = this.dragStartWorkspaceX - wormhole.x;
                    const offsetY = this.dragStartWorkspaceY - wormhole.y;

                    debugLog.info('Card teleported through wormhole', {
                        cardId: this.id,
                        from: wormhole.id,
                        to: partner.id,
                        dragStartPos: { x: this.dragStartWorkspaceX, y: this.dragStartWorkspaceY },
                        wormholePos: { x: wormhole.x, y: wormhole.y },
                        offset: { x: offsetX, y: offsetY }
                    });

                    // Teleport card to partner wormhole with same relative offset
                    this.x = partner.x + offsetX;
                    this.y = partner.y + offsetY;
                    this.updatePosition(viewportManager);

                    // Store the teleported card position for center button
                    appState.lastTeleportedCardId = this.id;

                    // Emit update to server
                    if (appState.socket) {
                        appState.socket.emit('viewport:move', {
                            id: this.id,
                            x: this.x,
                            y: this.y,
                            zIndex: this.zIndex
                        });
                    }

                    // Update constellations after teleportation
                    if (window.constellationManager) {
                        const cards = Array.from(appState.cards.values());
                        window.constellationManager.updateConstellationsDebounced(cards);
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

        // Update constellations after drop
        if (window.constellationManager) {
            const cards = Array.from(appState.cards.values());
            window.constellationManager.updateConstellationsDebounced(cards);
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
        const headerDiv = this.element.querySelector('.card-header-text');
        const bodyDiv = this.element.querySelector('.card-body-text');
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
