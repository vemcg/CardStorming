// Wormhole element - extends DraggableElement

import { DraggableElement } from '../core/DraggableElement.js';
import { debugLog } from '../utils/DebugLog.js';

export class Wormhole extends DraggableElement {
    constructor(x, y, id, partnerId) {
        super(x, y, { isPersistent: true });

        this.id = id;
        this.partnerId = partnerId;
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
        wormhole.style.zIndex = '100';
        wormhole.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.3)';

        // Get SVG from wormhole button
        const wormholeBtnElement = document.getElementById('wormhole-btn');
        if (wormholeBtnElement) {
            wormhole.innerHTML = wormholeBtnElement.innerHTML;
            const svg = wormhole.querySelector('svg');
            if (svg) {
                svg.style.width = '96px';
                svg.style.height = '96px';
            }
        }

        this.element = wormhole;
        this.updatePosition(viewportManager);

        // Attach event listeners
        this.attachEventListeners(viewportManager);

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
            y: this.y
        };
    }
}
