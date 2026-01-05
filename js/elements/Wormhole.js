// Wormhole element - extends DraggableElement

import { DraggableElement } from '../core/DraggableElement.js';
import { debugLog } from '../utils/DebugLog.js';

export class Wormhole extends DraggableElement {
    constructor(x, y, id, partnerId, name = '', zIndex = 1) {
        super(x, y, { isPersistent: true });

        this.id = id;
        this.partnerId = partnerId;
        this.name = name;
        this.zIndex = zIndex;
    }

    /**
     * Render wormhole to DOM
     */
    render(viewportManager) {
        const wormhole = document.createElement('div');
        wormhole.className = 'wormhole-portal';
        wormhole.dataset.id = this.id;
        wormhole.dataset.partnerId = this.partnerId;

        wormhole.style.position = 'absolute';
        wormhole.style.width = '120px';
        wormhole.style.height = '120px';
        wormhole.style.backgroundColor = 'rgba(255, 255, 255, 0.95)';
        wormhole.style.border = '3px solid #666';
        wormhole.style.borderRadius = '50%';
        wormhole.style.display = 'flex';
        wormhole.style.alignItems = 'center';
        wormhole.style.justifyContent = 'center';
        wormhole.style.cursor = 'pointer';
        wormhole.style.zIndex = String(this.zIndex);
        wormhole.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.3)';
        wormhole.style.pointerEvents = 'auto';  // Ensure pointer events are enabled

        // Create inner container for SVG and label
        const innerContainer = document.createElement('div');
        innerContainer.style.display = 'flex';
        innerContainer.style.flexDirection = 'column';
        innerContainer.style.alignItems = 'center';
        innerContainer.style.justifyContent = 'center';
        innerContainer.style.width = '100%';
        innerContainer.style.height = '100%';
        innerContainer.style.pointerEvents = 'none'; // Let events pass through to parent wormhole div

        // Get SVG from wormhole button
        const wormholeBtnElement = document.getElementById('wormhole-btn');
        if (wormholeBtnElement) {
            const svgContainer = document.createElement('div');
            svgContainer.innerHTML = wormholeBtnElement.innerHTML;
            const svg = svgContainer.querySelector('svg');
            if (svg) {
                svg.style.width = '80px';
                svg.style.height = '80px';
            }
            innerContainer.appendChild(svgContainer);
        }

        // Add name label if provided
        if (this.name) {
            const label = document.createElement('div');
            label.style.fontSize = '12px';
            label.style.fontWeight = 'bold';
            label.style.color = '#333';
            label.style.marginTop = '5px';
            label.style.textAlign = 'center';
            label.style.maxWidth = '110px';
            label.style.overflow = 'hidden';
            label.style.textOverflow = 'ellipsis';
            label.style.whiteSpace = 'nowrap';
            label.textContent = this.name;
            innerContainer.appendChild(label);
        }

        wormhole.appendChild(innerContainer);

        this.element = wormhole;
        this.updatePosition(viewportManager);

        // Note: Event listeners are attached in setupWormholeDragHandlers in app.js
        // Don't attach listeners here to avoid conflicts

        return wormhole;
    }

    /**
     * Attach mouse event listeners
     */
    attachEventListeners(viewportManager) {
        this.element.addEventListener('mousedown', (e) => {
            this.startDrag(e, viewportManager);
        });
    }

    /**
     * Handle click - teleport to partner wormhole
     */
    onClick(e, viewportManager, appState) {
        debugLog.info('Wormhole clicked - attempting teleport', {
            from: this.id,
            to: this.partnerId
        });

        const partner = appState.wormholes.get(this.partnerId);
        if (partner) {
            debugLog.info('Teleporting to partner wormhole', {
                partnerId: partner.id,
                partnerPosition: { x: partner.x, y: partner.y }
            });

            // Pan viewport to center on partner wormhole
            viewportManager.panTo(partner.x, partner.y);
        } else {
            debugLog.error('Partner wormhole not found', { partnerId: this.partnerId });
        }
    }

    /**
     * Handle drop - update position on server
     */
    onDrop(e, viewportManager, appState) {
        debugLog.info('Wormhole dropped', { id: this.id, x: this.x, y: this.y });

        // Emit to server
        if (appState.socket) {
            appState.socket.emit('wormhole:move', {
                id: this.id,
                x: this.x,
                y: this.y
            });
        }
    }

    /**
     * Serialize wormhole for storage/network
     */
    serialize() {
        return {
            id: this.id,
            partnerId: this.partnerId,
            x: this.x,
            y: this.y,
            name: this.name,
            zIndex: this.zIndex
        };
    }
}
