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
     * Auto-pan when mouse is near edges during drag
     * @param {MouseEvent} e - Mouse event
     * @returns {boolean} true if panning occurred
     */
    autoPan(e) {
        const rect = this.viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const edgeThresholdX = rect.width * this.EDGE_RATIO;
        const edgeThresholdY = rect.height * this.EDGE_RATIO;

        let didPan = false;

        if (mouseX < edgeThresholdX) {
            this.currentPan.x += this.PAN_SPEED;
            didPan = true;
        }
        if (mouseX > rect.width - edgeThresholdX) {
            this.currentPan.x -= this.PAN_SPEED;
            didPan = true;
        }
        if (mouseY < edgeThresholdY) {
            this.currentPan.y += this.PAN_SPEED;
            didPan = true;
        }
        if (mouseY > rect.height - edgeThresholdY) {
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
}
