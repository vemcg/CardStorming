// Wormhole element - extends DraggableElement

import { DraggableElement } from '../core/DraggableElement.js';
import { debugLog } from '../utils/DebugLog.js';
import { showWormholeEditDialog } from '../utils/DialogUtils.js';

export class Wormhole extends DraggableElement {
    constructor(x, y, id, partnerId, name = '', zIndex = 1) {
        super(x, y, { isPersistent: true });

        this.id = id;
        this.partnerId = partnerId;
        this.name = name;
        this.zIndex = zIndex;
        this.clickTimer = null; // For distinguishing single vs double click
        this.clickDelay = 250; // ms to wait for double-click
        this.preventClick = false; // Flag to prevent click after double-click
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
        wormhole.style.width = '160px';
        wormhole.style.height = '100px';
        wormhole.style.backgroundColor = 'transparent';
        wormhole.style.border = 'none';
        wormhole.style.borderRadius = '8px';
        wormhole.style.display = 'flex';
        wormhole.style.flexDirection = 'column';
        wormhole.style.alignItems = 'center';
        wormhole.style.justifyContent = 'flex-start';
        wormhole.style.cursor = 'pointer';
        wormhole.style.zIndex = String(this.zIndex);
        wormhole.style.overflow = 'visible';
        wormhole.style.pointerEvents = 'auto';  // Ensure pointer events are enabled

        // Create image container
        const imageContainer = document.createElement('div');
        imageContainer.style.width = '100%';
        imageContainer.style.height = '100%';
        imageContainer.style.borderRadius = '8px';
        imageContainer.style.overflow = 'hidden';
        imageContainer.style.boxShadow = '0 0 15px rgba(0, 206, 209, 0.6)';
        imageContainer.style.pointerEvents = 'none';

        // Use galaxy image
        const img = document.createElement('img');
        img.src = '/images/wormhole-galaxy.svg';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.display = 'block';
        imageContainer.appendChild(img);
        wormhole.appendChild(imageContainer);

        // Add name label if provided
        if (this.name) {
            const label = document.createElement('div');
            label.className = 'wormhole-label';
            label.style.fontSize = '12px';
            label.style.fontWeight = 'bold';
            label.style.color = '#fff';
            label.style.textShadow = '0 0 4px rgba(0, 0, 0, 0.8)';
            label.style.marginTop = '4px';
            label.style.textAlign = 'center';
            label.style.maxWidth = '150px';
            label.style.overflow = 'hidden';
            label.style.textOverflow = 'ellipsis';
            label.style.whiteSpace = 'nowrap';
            label.style.pointerEvents = 'none';
            label.textContent = this.name;
            wormhole.appendChild(label);
        }

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
     * Handle click - edit wormhole name (with delay to detect double-click)
     */
    async onClick(e, viewportManager, appState) {
        // Check if this click should be prevented (double-click occurred)
        if (this.preventClick) {
            this.preventClick = false;
            debugLog.info('Click prevented - was part of double-click');
            return;
        }

        // Clear any existing timer
        if (this.clickTimer) {
            clearTimeout(this.clickTimer);
            this.clickTimer = null;
        }

        // Store event properties we'll need later
        const clickX = e.clientX;
        const clickY = e.clientY;

        // Wait to see if a double-click is coming
        this.clickTimer = setTimeout(async () => {
            this.clickTimer = null;

            debugLog.info('Wormhole clicked - opening edit dialog', {
                id: this.id,
                currentName: this.name
            });

                try {
                    const newName = await showWormholeEditDialog(this.name, clickX, clickY);
                    debugLog.info('Dialog returned:', { newName, type: typeof newName });

                    if (newName !== null && newName !== this.name) {
                        debugLog.info('Updating wormhole name', {
                            id: this.id,
                            oldName: this.name,
                            newName: newName
                        });

                        // Update local name
                        this.name = newName;

                        // Update the label in the DOM
                        if (this.element) {
                            const innerContainer = this.element.querySelector('div');
                            let label = innerContainer ? innerContainer.querySelector('div:last-child') : null;

                            // Check if last child is actually a label (has textContent) or just the SVG container
                            if (label) {
                                const isLabel = label.textContent !== undefined && label.style.fontSize === '12px';
                                if (isLabel) {
                                    label.textContent = newName;
                                } else {
                                    // No label exists, create one
                                    label = null;
                                }
                            }

                            // Create label if it doesn't exist
                            if (!label && newName && innerContainer) {
                                label = document.createElement('div');
                                label.style.fontSize = '12px';
                                label.style.fontWeight = 'bold';
                                label.style.color = '#333';
                                label.style.marginTop = '5px';
                                label.style.textAlign = 'center';
                                label.style.maxWidth = '110px';
                                label.style.overflow = 'hidden';
                                label.style.textOverflow = 'ellipsis';
                                label.style.whiteSpace = 'nowrap';
                                label.textContent = newName;
                                innerContainer.appendChild(label);
                            }
                        }

                        // Emit to server
                        if (appState.socket) {
                            appState.socket.emit('wormhole:rename', {
                                id: this.id,
                                name: newName
                            });
                        }
                    } else if (newName === null) {
                        // Delete requested
                        debugLog.info('Deleting wormhole pair', {
                            id: this.id,
                            partnerId: this.partnerId
                        });

                        // Emit to server to delete both ends
                        if (appState.socket) {
                            appState.socket.emit('wormhole:delete', {
                                id1: this.id,
                                id2: this.partnerId
                            });
                        }
                    }
                } catch (err) {
                    if (err.message !== 'Wormhole edit cancelled') {
                        debugLog.error('Error editing wormhole name', err);
                    } else {
                        debugLog.info('Wormhole edit cancelled');
                    }
                }
            }, this.clickDelay);
    }

    /**
     * Handle double-click - teleport to partner wormhole
     */
    onDoubleClick(e, viewportManager, appState) {
        // Cancel the pending single-click timer
        if (this.clickTimer) {
            clearTimeout(this.clickTimer);
            this.clickTimer = null;
        }

        // Set flag to prevent onClick from executing
        this.preventClick = true;

        debugLog.info('Wormhole double-clicked - teleporting', {
            id: this.id,
            partnerId: this.partnerId
        });

        // Find the partner wormhole
        const partner = appState.getWormhole(this.partnerId);
        if (partner) {
            // Center the viewport on the partner wormhole
            viewportManager.centerOn(partner.x, partner.y);
            debugLog.info('Teleported to partner wormhole', {
                partnerId: partner.id,
                x: partner.x,
                y: partner.y
            });
        } else {
            debugLog.warn('Partner wormhole not found', { partnerId: this.partnerId });
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
