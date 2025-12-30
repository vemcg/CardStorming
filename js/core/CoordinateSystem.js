// Coordinate system transformations
// See COORDINATE_SYSTEM.md for detailed explanation

import { debugLog } from '../utils/DebugLog.js';

export class CoordinateSystem {
    /**
     * Convert screen coordinates to workspace coordinates
     * Takes into account current pan and zoom
     * @param {number} screenX - Screen X (clientX)
     * @param {number} screenY - Screen Y (clientY)
     * @param {Object} viewport - Viewport element
     * @param {number} currentZoom - Current zoom level
     * @param {Object} currentPan - Current pan {x, y}
     * @returns {Object} {x, y} in workspace coordinates
     */
    static screenToWorkspace(screenX, screenY, viewport, currentZoom, currentPan) {
        const rect = viewport.getBoundingClientRect();
        const style = window.getComputedStyle(viewport);
        const paddingLeft = parseFloat(style.paddingLeft);
        const paddingTop = parseFloat(style.paddingTop);

        const viewportWidth = rect.width - paddingLeft * 2;
        const viewportHeight = rect.height - paddingTop * 2;
        const centerX = viewportWidth / 2;
        const centerY = viewportHeight / 2;

        // Screen relative to viewport top-left
        const screenRelativeX = screenX - rect.left - paddingLeft;
        const screenRelativeY = screenY - rect.top - paddingTop;

        // Screen relative to center
        const screenRelativeToCenterX = screenRelativeX - centerX;
        const screenRelativeToCenterY = screenRelativeY - centerY;

        // Workspace coordinates
        const workspaceX = (screenRelativeToCenterX - currentPan.x) / currentZoom;
        const workspaceY = (screenRelativeToCenterY - currentPan.y) / currentZoom;

        debugLog.info('screenToWorkspace', {
            screenX, screenY,
            viewportRect: { left: rect.left, top: rect.top, width: viewportWidth, height: viewportHeight },
            viewportCenter: { centerX, centerY },
            padding: { paddingLeft, paddingTop },
            screenRelativeToViewport: { x: screenRelativeX, y: screenRelativeY },
            screenRelativeToCenter: { x: screenRelativeToCenterX, y: screenRelativeToCenterY },
            pan: currentPan,
            zoom: currentZoom,
            result: { workspaceX, workspaceY }
        });

        return { x: workspaceX, y: workspaceY };
    }

    /**
     * Convert screen to workspace WITHOUT accounting for pan
     * Used during dragging when we want element to follow cursor exactly
     */
    static screenToWorkspaceNoPan(screenX, screenY, viewport, currentZoom) {
        const rect = viewport.getBoundingClientRect();
        const style = window.getComputedStyle(viewport);
        const paddingLeft = parseFloat(style.paddingLeft);
        const paddingTop = parseFloat(style.paddingTop);

        const viewportWidth = rect.width - paddingLeft * 2;
        const viewportHeight = rect.height - paddingTop * 2;
        const centerX = viewportWidth / 2;
        const centerY = viewportHeight / 2;

        const screenRelativeX = screenX - rect.left - paddingLeft;
        const screenRelativeY = screenY - rect.top - paddingTop;
        const screenRelativeToCenterX = screenRelativeX - centerX;
        const screenRelativeToCenterY = screenRelativeY - centerY;

        const workspaceX = screenRelativeToCenterX / currentZoom;
        const workspaceY = screenRelativeToCenterY / currentZoom;

        debugLog.info('screenToWorkspaceNoPan', {
            screenX, screenY,
            viewportRect: { left: rect.left, top: rect.top, width: viewportWidth, height: viewportHeight },
            viewportCenter: { centerX, centerY },
            padding: { paddingLeft, paddingTop },
            screenRelativeToCenter: { x: screenRelativeToCenterX, y: screenRelativeToCenterY },
            zoom: currentZoom,
            result: { workspaceX, workspaceY }
        });

        return { x: workspaceX, y: workspaceY };
    }

    /**
     * Convert workspace coordinates to CSS coordinates
     * @param {number} workspaceX - Workspace X
     * @param {number} workspaceY - Workspace Y
     * @param {Object} viewport - Viewport element
     * @returns {Object} {x, y} in CSS coordinates (pixels from top-left)
     */
    static workspaceToCSS(workspaceX, workspaceY, viewport) {
        const rect = viewport.getBoundingClientRect();
        const style = window.getComputedStyle(viewport);
        const paddingLeft = parseFloat(style.paddingLeft);
        const paddingTop = parseFloat(style.paddingTop);

        const viewportWidth = rect.width - paddingLeft * 2;
        const viewportHeight = rect.height - paddingTop * 2;
        const centerX = viewportWidth / 2;
        const centerY = viewportHeight / 2;

        const cssX = workspaceX + centerX;
        const cssY = workspaceY + centerY;

        debugLog.info('workspaceToCSS', {
            workspaceX, workspaceY,
            viewportCenter: { centerX, centerY },
            result: { cssX, cssY }
        });

        return { x: cssX, y: cssY };
    }

    /**
     * Calculate distance between two points
     */
    static distance(x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Find the closest element to a point
     * @param {number} x - Point X
     * @param {number} y - Point Y
     * @param {Array} elements - Array of elements with x, y properties
     * @returns {Object|null} Closest element
     */
    static findClosest(x, y, elements) {
        if (!elements || elements.length === 0) return null;

        let closest = null;
        let minDistance = Infinity;

        for (const element of elements) {
            const dist = this.distance(x, y, element.x, element.y);
            if (dist < minDistance) {
                minDistance = dist;
                closest = element;
            }
        }

        return closest;
    }
}
