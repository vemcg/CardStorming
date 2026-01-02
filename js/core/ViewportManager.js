// Viewport pan, zoom, and focal point management

import { debugLog } from '../utils/DebugLog.js';

export class ViewportManager {
    constructor(viewportElement, viewportContentElement) {
        this.viewport = viewportElement;
        this.viewportContent = viewportContentElement;

        // Zoom limits
        this.MIN_ZOOM = 0.1;
        this.MAX_ZOOM = 2.0;
        this.currentZoom = 1.0;

        // Pan state
        this.currentPan = { x: 0, y: 0 };

        // Focal point (workspace coordinates)
        this.focalPoint = { x: 0, y: 0 };

        // Auto-pan settings
        this.EDGE_RATIO = 0.15;
        this.PAN_SPEED = 3;

        // Auto-zoom settings
        this.ZOOM_SPEED = 0.002;
        this.ZOOM_DELAY_MS = 1500;

        // Manual zoom tracking (for restoring after auto-zoom)
        this.manualZoom = 1.0;
        this.manualPan = { x: 0, y: 0 };
        this.manualFocalPoint = { x: 0, y: 0 };
    }

    /**
     * Get current transform
     */
    getTransform() {
        return {
            zoom: this.currentZoom,
            pan: { ...this.currentPan },
            focalPoint: { ...this.focalPoint }
        };
    }

    /**
     * Apply transform to viewport
     */
    applyTransform() {
        this.viewportContent.style.transform =
            `translate(${this.currentPan.x}px, ${this.currentPan.y}px) scale(${this.currentZoom})`;

        debugLog.info('Applied transform', {
            zoom: this.currentZoom,
            pan: this.currentPan,
            focalPoint: this.focalPoint
        });
    }

    /**
     * Set focal point from mouse event
     */
    setFocalPointFromEvent(e) {
        const rect = this.viewport.getBoundingClientRect();
        const style = window.getComputedStyle(this.viewport);
        const paddingLeft = parseFloat(style.paddingLeft);
        const paddingTop = parseFloat(style.paddingTop);

        const viewportWidth = rect.width - paddingLeft * 2;
        const viewportHeight = rect.height - paddingTop * 2;
        const centerX = viewportWidth / 2;
        const centerY = viewportHeight / 2;

        const screenRelativeX = e.clientX - rect.left - paddingLeft;
        const screenRelativeY = e.clientY - rect.top - paddingTop;
        const screenRelativeToCenterX = screenRelativeX - centerX;
        const screenRelativeToCenterY = screenRelativeY - centerY;

        this.focalPoint.x = (screenRelativeToCenterX - this.currentPan.x) / this.currentZoom;
        this.focalPoint.y = (screenRelativeToCenterY - this.currentPan.y) / this.currentZoom;

        debugLog.info('setFocalPointFromEvent', {
            clientX: e.clientX,
            clientY: e.clientY,
            focalPoint: this.focalPoint
        });
    }

    /**
     * Zoom to a specific level, keeping focal point centered
     */
    zoomTo(targetZoom, focalX = this.focalPoint.x, focalY = this.focalPoint.y) {
        const oldZoom = this.currentZoom;
        this.currentZoom = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, targetZoom));

        // Adjust pan to keep focal point in same screen position
        this.currentPan.x = this.currentPan.x * (this.currentZoom / oldZoom);
        this.currentPan.y = this.currentPan.y * (this.currentZoom / oldZoom);

        this.focalPoint.x = focalX;
        this.focalPoint.y = focalY;

        this.applyTransform();
    }

    /**
     * Zoom in (multiplicative)
     */
    zoomIn(e = null) {
        if (e) this.setFocalPointFromEvent(e);
        this.zoomTo(this.currentZoom * 1.1);
    }

    /**
     * Zoom out (multiplicative)
     */
    zoomOut(e = null) {
        if (e) this.setFocalPointFromEvent(e);
        this.zoomTo(this.currentZoom * 0.9);
    }

    /**
     * Gradually zoom out (for auto-zoom during drag)
     */
    zoomOutGradual() {
        if (this.currentZoom > this.MIN_ZOOM) {
            this.currentZoom = Math.max(this.MIN_ZOOM, this.currentZoom - this.ZOOM_SPEED);
            this.applyTransform();
        }
    }

    /**
     * Center view (reset to origin)
     */
    centerView() {
        this.currentZoom = 1.0;
        this.currentPan = { x: 0, y: 0 };
        this.focalPoint = { x: 0, y: 0 };
        this.applyTransform();
    }

    /**
     * Pan to specific workspace coordinates
     */
    panTo(workspaceX, workspaceY) {
        this.currentPan.x = -workspaceX * this.currentZoom;
        this.currentPan.y = -workspaceY * this.currentZoom;
        this.focalPoint.x = workspaceX;
        this.focalPoint.y = workspaceY;
        this.applyTransform();
    }

    /**
     * Auto-pan when card is dragged beyond half the distance to viewport edge
     * @param {number} startX - Card's initial workspace X position
     * @param {number} startY - Card's initial workspace Y position
     * @param {number} currentX - Card's current workspace X position
     * @param {number} currentY - Card's current workspace Y position
     * @returns {boolean} true if panning occurred
     */
    autoPan(startX, startY, currentX, currentY) {
        const rect = this.viewport.getBoundingClientRect();

        // Convert workspace positions to screen coordinates to measure distance to edges
        const startScreenX = (startX * this.currentZoom) + this.currentPan.x;
        const startScreenY = (startY * this.currentZoom) + this.currentPan.y;
        const currentScreenX = (currentX * this.currentZoom) + this.currentPan.x;
        const currentScreenY = (currentY * this.currentZoom) + this.currentPan.y;

        // Calculate how far the card has moved from start position
        const movedX = currentScreenX - startScreenX;
        const movedY = currentScreenY - startScreenY;

        // Calculate distances from start position to viewport edges
        const distToLeft = startScreenX;
        const distToRight = rect.width - startScreenX;
        const distToTop = startScreenY;
        const distToBottom = rect.height - startScreenY;

        let didPan = false;

        // Pan when moved more than half the distance toward an edge
        if (movedX < 0 && Math.abs(movedX) > distToLeft / 2) {
            // Moving left, passed halfway to left edge
            this.currentPan.x += this.PAN_SPEED;
            didPan = true;
        }
        if (movedX > 0 && movedX > distToRight / 2) {
            // Moving right, passed halfway to right edge
            this.currentPan.x -= this.PAN_SPEED;
            didPan = true;
        }
        if (movedY < 0 && Math.abs(movedY) > distToTop / 2) {
            // Moving up, passed halfway to top edge
            this.currentPan.y += this.PAN_SPEED;
            didPan = true;
        }
        if (movedY > 0 && movedY > distToBottom / 2) {
            // Moving down, passed halfway to bottom edge
            this.currentPan.y -= this.PAN_SPEED;
            didPan = true;
        }

        if (didPan) {
            this.applyTransform();
        }

        return didPan;
    }

    /**
     * Check if point is inside viewport bounds
     */
    isInViewport(screenX, screenY) {
        const rect = this.viewport.getBoundingClientRect();
        return screenX >= rect.left && screenX <= rect.right &&
               screenY >= rect.top && screenY <= rect.bottom;
    }

    /**
     * Save current zoom/pan as manual zoom level
     */
    saveManualZoom() {
        this.manualZoom = this.currentZoom;
        this.manualPan = { ...this.currentPan };
        this.manualFocalPoint = { ...this.focalPoint };
        debugLog.info('Saved manual zoom', { zoom: this.manualZoom });
    }

    /**
     * Restore manual zoom level (after auto-zoom)
     */
    restoreManualZoom() {
        this.currentZoom = this.manualZoom;
        this.currentPan = { ...this.manualPan };
        this.focalPoint = { ...this.manualFocalPoint };
        this.applyTransform();
        debugLog.info('Restored manual zoom', { zoom: this.manualZoom });
    }
}
