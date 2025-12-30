// Zoom Search Tool - extends DraggableElement
// Non-persistent tool for searching/previewing cards

import { DraggableElement } from '../core/DraggableElement.js';
import { debugLog } from '../utils/DebugLog.js';

export class ZoomSearchTool extends DraggableElement {
    constructor(x, y) {
        super(x, y, { isPersistent: false }); // Disappears on drop!
    }

    /**
     * Render zoom search ghost element
     */
    render(viewportManager) {
        const ghost = document.createElement('div');
        ghost.className = 'zoom-search-ghost';

        ghost.style.position = 'fixed'; // Fixed to screen, not viewport
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '10000';
        ghost.style.width = '64px';
        ghost.style.height = '64px';
        ghost.style.opacity = '0.7';

        // Get SVG from zoom-search button
        const zoomSearchBtn = document.getElementById('zoom-search-btn');
        if (zoomSearchBtn) {
            ghost.innerHTML = zoomSearchBtn.innerHTML;
        }

        this.element = ghost;

        // Position is handled differently - it follows cursor directly
        // Will be updated in drag()

        return ghost;
    }

    /**
     * Update position - for zoom search, this updates screen position not workspace
     */
    updateScreenPosition(screenX, screenY) {
        if (!this.element) return;

        // Center the 64x64 icon on cursor
        this.element.style.left = (screenX - 32) + 'px';
        this.element.style.top = (screenY - 32) + 'px';
    }

    /**
     * Override drag to update screen position and workspace position
     */
    drag(e, viewportManager, appState) {
        if (!this.isDragging) return;

        // Update screen position to follow cursor
        this.updateScreenPosition(e.clientX, e.clientY);

        // Call parent drag for auto-zoom, auto-pan, card preview
        super.drag(e, viewportManager, appState);
    }

    /**
     * Start drag - attach to document body
     */
    startDrag(e, viewportManager) {
        // Render and attach to body
        if (!this.element) {
            this.render(viewportManager);
            document.body.appendChild(this.element);
        }

        this.updateScreenPosition(e.clientX, e.clientY);

        super.startDrag(e, viewportManager);

        debugLog.info('Zoom-search drag started');
    }

    /**
     * Handle click - does nothing (just disappears)
     */
    onClick(e, viewportManager, appState) {
        debugLog.info('Zoom-search clicked (no-op)');
    }

    /**
     * Handle drop - does nothing (just disappears)
     */
    onDrop(e, viewportManager, appState) {
        debugLog.info('Zoom-search dropped');
        // Will auto-destroy because isPersistent = false
    }
}
