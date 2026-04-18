// Viewport pan, zoom, and focal point management

import { debugLog } from '../utils/DebugLog.js';

export class ViewportManager {
    constructor(viewportElement, viewportContentElement) {
        this.viewport = viewportElement;
        this.viewportContent = viewportContentElement;

        // Zoom limits
        this.MIN_ZOOM = 0.02;
        this.MAX_ZOOM = 2.0;
        this.currentZoom = 1.0;

        // Pan state
        this.currentPan = { x: 0, y: 0 };

        // Focal point (workspace coordinates)
        this.focalPoint = { x: 0, y: 0 };

        // Auto-pan settings
        this.EDGE_RATIO = 0.15;
        this.PAN_SPEED = 80;        // px per step (throttled to ~1.3 steps/sec)
        this.lastAutoPanTime = 0;

        // Auto-zoom settings
        this.ZOOM_SPEED = 0.08;     // zoom units per step (throttled to ~1.3 steps/sec)
        this.ZOOM_DELAY_MS = 1500;
        this.DRAG_MIN_ZOOM = 0.02;  // don't zoom out further than this during drag
        this.lastAutoZoomTime = 0;

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

        // Update coordinates display
        const coordsDisplay = document.getElementById('viewport-coordinates');
        if (coordsDisplay) {
            const x = Math.round(this.focalPoint.x);
            const y = Math.round(this.focalPoint.y);
            coordsDisplay.textContent = `${x}, ${y}`;
        }

        // Debug logging (commented out for performance)
        // const stack = new Error().stack;
        // const callerLine = stack.split('\n')[2];
        // debugLog.info('Applied transform', {
        //     zoom: this.currentZoom,
        //     pan: this.currentPan,
        //     focalPoint: this.focalPoint,
        //     calledFrom: callerLine?.trim()
        // });
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
     * Zoom to a specific level, keeping focal point at same screen position
     */
    zoomTo(targetZoom, focalX = this.focalPoint.x, focalY = this.focalPoint.y) {
        const oldZoom = this.currentZoom;
        this.currentZoom = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, targetZoom));

        // Calculate the screen position of the focal point before zoom
        const screenFocalX = focalX * oldZoom + this.currentPan.x;
        const screenFocalY = focalY * oldZoom + this.currentPan.y;

        // Adjust pan to keep focal point at the same screen position after zoom
        this.currentPan.x = screenFocalX - focalX * this.currentZoom;
        this.currentPan.y = screenFocalY - focalY * this.currentZoom;

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
     * Gradually zoom out (for auto-zoom during drag) — throttled to ~60fps
     */
    zoomOutGradual() {
        const now = Date.now();
        if (now - this.lastAutoZoomTime < 250) return;
        this.lastAutoZoomTime = now;

        if (this.currentZoom > this.DRAG_MIN_ZOOM) {
            const newZoom = Math.max(this.DRAG_MIN_ZOOM, this.currentZoom - this.ZOOM_SPEED);
            this.zoomTo(newZoom);
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
        // Pan so that the workspace coordinates appear at the center of the viewport
        // In our coordinate system, workspace (0,0) is at viewport center when pan is (0,0)
        // So to center workspace point P, we need pan = -P * zoom

        // debugLog.info('=== panTo START ===');
        // debugLog.info('Input', { workspaceX, workspaceY });
        // debugLog.info('Current zoom', { zoom: this.currentZoom });

        const newPanX = -workspaceX * this.currentZoom;
        const newPanY = -workspaceY * this.currentZoom;

        // debugLog.info('Calculated newPan', { newPanX, newPanY });
        // debugLog.info('Old pan', { x: this.currentPan.x, y: this.currentPan.y });
        // debugLog.info('Old focal', { x: this.focalPoint.x, y: this.focalPoint.y });

        this.currentPan.x = newPanX;
        this.currentPan.y = newPanY;

        // debugLog.info('After setting pan', { x: this.currentPan.x, y: this.currentPan.y });

        this.focalPoint.x = workspaceX;
        this.focalPoint.y = workspaceY;

        // debugLog.info('After setting focal', { x: this.focalPoint.x, y: this.focalPoint.y });

        this.applyTransform();

        // debugLog.info('After applyTransform, pan', { x: this.currentPan.x, y: this.currentPan.y });
        // debugLog.info('After applyTransform, focal', { x: this.focalPoint.x, y: this.focalPoint.y });
        // debugLog.info('=== panTo END ===');
    }

    /**
     * Center the viewport on specific workspace coordinates
     */
    centerOn(workspaceX, workspaceY) {
        // Use panTo to center on the coordinates
        this.panTo(workspaceX, workspaceY);

        // Update manual state so auto-zoom returns to this position
        this.manualZoom = this.currentZoom;
        this.manualPan = { ...this.currentPan };
        this.manualFocalPoint = { x: workspaceX, y: workspaceY };
    }

    /**
     * Auto-pan when cursor is near the viewport edge — throttled to ~60fps.
     * @param {number} mouseClientX - cursor clientX
     * @param {number} mouseClientY - cursor clientY
     * @returns {boolean} true if panning occurred
     */
    autoPan(mouseClientX, mouseClientY) {
        const now = Date.now();
        if (now - this.lastAutoPanTime < 250) return false;
        this.lastAutoPanTime = now;

        const rect = this.viewport.getBoundingClientRect();
        const MARGIN = 60;
        let didPan = false;

        if (mouseClientX - rect.left < MARGIN) {
            this.currentPan.x += this.PAN_SPEED;
            didPan = true;
        } else if (rect.right - mouseClientX < MARGIN) {
            this.currentPan.x -= this.PAN_SPEED;
            didPan = true;
        }

        if (mouseClientY - rect.top < MARGIN) {
            this.currentPan.y += this.PAN_SPEED;
            didPan = true;
        } else if (rect.bottom - mouseClientY < MARGIN) {
            this.currentPan.y -= this.PAN_SPEED;
            didPan = true;
        }

        if (didPan) this.applyTransform();
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
