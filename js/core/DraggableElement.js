// Base class for all draggable elements

import { debugLog } from '../utils/DebugLog.js';
import { CoordinateSystem } from './CoordinateSystem.js';

export class DraggableElement {
    constructor(x, y, options = {}) {
        // Position in workspace coordinates
        this.x = x;
        this.y = y;

        // Options
        this.isPersistent = options.isPersistent ?? true;  // false only for ZoomSearchTool
        this.enableAutoZoom = false;     // Subclasses opt in (e.g. ZoomSearchTool)
        this.enableCardPreview = true;   // All elements get card preview

        // DOM element (set by render())
        this.element = null;

        // Drag state
        this.isDragging = false;
        this.dragStartTime = 0;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragStartWorkspaceX = 0;
        this.dragStartWorkspaceY = 0;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;
        this.hasMoved = false;

        // Auto-zoom state
        this.zoomAnimationFrame = null;

        // Card preview state
        this.nearestCard = null;
        this.expandedCard = null;

        // Constants
        this.CLICK_THRESHOLD = 5;      // pixels
        this.CLICK_TIME_THRESHOLD = 500; // ms
        this.ZOOM_DELAY_MS = 1500;     // ms before auto-zoom starts
    }

    /**
     * Render the element to DOM (override in subclasses)
     * Must set this.element
     */
    render(viewportManager) {
        throw new Error('render() must be implemented by subclass');
    }

    /**
     * Update element position in DOM based on workspace coordinates
     */
    updatePosition(viewportManager) {
        if (!this.element) return;

        const cssPos = CoordinateSystem.workspaceToCSS(
            this.x,
            this.y,
            viewportManager.viewport
        );

        this.element.style.left = cssPos.x + 'px';
        this.element.style.top = cssPos.y + 'px';
    }

    /**
     * Start dragging
     */
    startDrag(e, viewportManager, appState) {
        e.stopPropagation();

        this.isDragging = true;
        this.dragStartTime = Date.now();
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.dragStartWorkspaceX = this.x;
        this.dragStartWorkspaceY = this.y;
        this.hasMoved = false;

        // Store grab offset in workspace coords (pan-aware so card stays under cursor even when viewport pans)
        const initialWorkspacePos = CoordinateSystem.screenToWorkspace(
            e.clientX,
            e.clientY,
            viewportManager.viewport,
            viewportManager.currentZoom,
            viewportManager.currentPan
        );

        this.dragOffsetX = this.x - initialWorkspacePos.x;
        this.dragOffsetY = this.y - initialWorkspacePos.y;

        // Snapshot the user's zoom so endDrag can restore it after auto-zoom
        viewportManager.saveManualZoom();
        this.dragStartZoom = viewportManager.currentZoom;

        // Store original z-index
        this.originalZIndex = this.zIndex;

        // Visual feedback - set to maxZIndex + 1000 for temporary top position
        if (this.element) {
            this.element.style.opacity = '0.7';
            const maxZ = appState ? appState.maxZIndex : 1000;
            this.element.style.zIndex = String(maxZ + 1000);
        }


        debugLog.info(`${this.constructor.name} drag started`, {
            x: this.x,
            y: this.y,
            enableAutoZoom: this.enableAutoZoom
        });
    }

    /**
     * Drag (mouse move)
     */
    drag(e, viewportManager, appState) {
        if (!this.isDragging) return;

        // Check if mouse has moved beyond threshold
        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > this.CLICK_THRESHOLD) {
            this.hasMoved = true;
        }

        if (!this.hasMoved) return; // Don't move until threshold crossed

        // dragOffsetX/Y is in workspace coords; screenToWorkspace already accounts for
        // current pan and zoom, so the offset is added directly — no correction needed.
        const workspacePos = CoordinateSystem.screenToWorkspace(
            e.clientX,
            e.clientY,
            viewportManager.viewport,
            viewportManager.currentZoom,
            viewportManager.currentPan
        );

        this.x = workspacePos.x + this.dragOffsetX;
        this.y = workspacePos.y + this.dragOffsetY;
        this.updatePosition(viewportManager);

        // Auto-pan and auto-zoom when cursor is near the viewport edge
        const dragDuration = Date.now() - this.dragStartTime;
        const AUTO_PAN_DELAY = 1000;

        if (dragDuration > AUTO_PAN_DELAY) {
            viewportManager.autoPan(e.clientX, e.clientY);

            if (this.enableAutoZoom) {
                const rect = viewportManager.viewport.getBoundingClientRect();
                const nearEdge = (
                    e.clientX - rect.left < 60 ||
                    rect.right - e.clientX < 60 ||
                    e.clientY - rect.top < 60 ||
                    rect.bottom - e.clientY < 60
                );
                if (nearEdge) viewportManager.zoomOutGradual();
            }

            // Pan/zoom changed the viewport transform — recompute card position so it
            // stays under the cursor without waiting for the next mousemove event.
            const updatedPos = CoordinateSystem.screenToWorkspace(
                e.clientX,
                e.clientY,
                viewportManager.viewport,
                viewportManager.currentZoom,
                viewportManager.currentPan
            );
            this.x = updatedPos.x + this.dragOffsetX;
            this.y = updatedPos.y + this.dragOffsetY;
            this.updatePosition(viewportManager);
        }

        // Update nearest card for preview
        if (this.enableCardPreview && appState) {
            this.updateNearestCard(appState);
        }
    }

    /**
     * End drag (mouse up)
     */
    endDrag(e, viewportManager, appState) {
        if (!this.isDragging) return;

        this.isDragging = false;
        const dragDuration = Date.now() - this.dragStartTime;

        // Stop auto-zoom
        if (this.zoomAnimationFrame) {
            cancelAnimationFrame(this.zoomAnimationFrame);
            this.zoomAnimationFrame = null;
        }

        // Collapse any expanded card
        if (this.expandedCard) {
            this.expandedCard.collapse();
            this.expandedCard = null;
        }

        // Restore visual state
        if (this.element) {
            this.element.style.opacity = '1';
            // Restore original z-index (will be updated by onDrop if needed)
            if (this.originalZIndex !== undefined) {
                this.element.style.zIndex = String(this.originalZIndex);
            }
        }

        // Determine if it was a click or drag
        if (!this.hasMoved && dragDuration < this.CLICK_TIME_THRESHOLD) {
            this.onClick(e, viewportManager, appState);
        } else {
            // Set focal point to drop location
            viewportManager.focalPoint.x = this.x;
            viewportManager.focalPoint.y = this.y;

            // If auto-zoom changed the zoom during drag, restore the user's saved zoom
            // and center the view on the dropped card
            if (this.enableAutoZoom && viewportManager.currentZoom !== viewportManager.manualZoom) {
                viewportManager.currentZoom = viewportManager.manualZoom;
                viewportManager.panTo(this.x, this.y);
            }

            this.onDrop(e, viewportManager, appState);
        }

        // Non-persistent elements disappear
        if (!this.isPersistent) {
            this.destroy();
        }

        debugLog.info(`${this.constructor.name} drag ended`, {
            hasMoved: this.hasMoved,
            dragDuration,
            isPersistent: this.isPersistent,
            finalPosition: { x: this.x, y: this.y }
        });
    }

    /**
     * Start auto-zoom animation loop
     */
    startAutoZoom(viewportManager) {
        const animate = () => {
            if (!this.isDragging) {
                this.zoomAnimationFrame = null;
                return;
            }

            const now = Date.now();
            if (now - this.dragStartTime >= this.ZOOM_DELAY_MS) {
                viewportManager.zoomOutGradual();
            }

            this.zoomAnimationFrame = requestAnimationFrame(animate);
        };

        this.zoomAnimationFrame = requestAnimationFrame(animate);
    }

    /**
     * Update nearest card and show preview
     */
    updateNearestCard(appState) {
        const cards = Array.from(appState.cards.values()).filter(card => card !== this);
        const nearest = CoordinateSystem.findClosest(this.x, this.y, cards);

        if (nearest !== this.nearestCard) {
            // Collapse previous
            if (this.expandedCard && this.expandedCard !== nearest) {
                this.expandedCard.collapse();
            }

            // Expand new nearest
            if (nearest && nearest.expand) {
                nearest.expand();
                this.expandedCard = nearest;
            }

            this.nearestCard = nearest;
        }
    }

    /**
     * Handle click (override in subclasses)
     */
    onClick(e, viewportManager, appState) {
        debugLog.info(`${this.constructor.name} clicked`);
    }

    /**
     * Handle drop (override in subclasses)
     */
    onDrop(e, viewportManager, appState) {
        debugLog.info(`${this.constructor.name} dropped at`, { x: this.x, y: this.y });
    }

    /**
     * Remove element from DOM and clean up
     */
    destroy() {
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
        this.element = null;
    }

    /**
     * Serialize to JSON for storage/network
     */
    serialize() {
        return {
            x: this.x,
            y: this.y
        };
    }
}
