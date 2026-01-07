// Constellation detection and visualization

import { debugLog } from '../utils/DebugLog.js';
import { CoordinateSystem } from './CoordinateSystem.js';

export class ConstellationManager {
    constructor(viewport, viewportManager) {
        this.viewport = viewport;
        this.viewportManager = viewportManager;
        this.constellations = new Map(); // constellationId -> Set of card IDs
        this.cardToConstellation = new Map(); // cardId -> constellationId
        this.constellationLayer = null;
        this.updateDebounceTimer = null;

        // Drag state
        this.isDraggingConstellation = false;
        this.draggedConstellationId = null;
        this.dragStartPos = { x: 0, y: 0 };
        this.dragStartCardPositions = new Map(); // cardId -> {x, y}

        // Configuration
        this.PROXIMITY_THRESHOLD = 250; // pixels
        this.UPDATE_DEBOUNCE_MS = 150; // ms
        this.COLORS = [
            'rgba(255, 182, 193, 0.15)', // light pink
            'rgba(173, 216, 230, 0.15)', // light blue
            'rgba(144, 238, 144, 0.15)', // light green
            'rgba(255, 218, 185, 0.15)', // peach
            'rgba(221, 160, 221, 0.15)', // plum
            'rgba(255, 255, 224, 0.15)', // light yellow
            'rgba(176, 224, 230, 0.15)', // powder blue
            'rgba(255, 228, 196, 0.15)', // bisque
        ];

        this.createConstellationLayer();
    }

    /**
     * Create container for constellation backgrounds
     */
    createConstellationLayer() {
        const viewportContent = this.viewport.querySelector('.viewport-content');
        if (!viewportContent) {
            debugLog.error('Could not find viewport-content for constellation layer');
            return;
        }

        // Create a div container for constellation backgrounds
        this.constellationLayer = document.createElement('div');
        this.constellationLayer.id = 'constellation-layer';
        this.constellationLayer.style.position = 'absolute';
        this.constellationLayer.style.top = '0';
        this.constellationLayer.style.left = '0';
        this.constellationLayer.style.width = '0';
        this.constellationLayer.style.height = '0';
        this.constellationLayer.style.pointerEvents = 'none'; // Container doesn't block pointer events
        this.constellationLayer.style.zIndex = '0';

        // Insert as first child so it's behind everything
        viewportContent.insertBefore(this.constellationLayer, viewportContent.firstChild);

        debugLog.info('Constellation layer created');
    }

    /**
     * Detect constellations using connected components algorithm
     * Cards are connected if their shadow rectangles overlap
     */
    detectConstellations(cards) {
        const visited = new Set();
        const newConstellations = [];

        // Card dimensions and shadow padding
        const cardWidth = 150;
        const cardHeight = 120;
        const shadowPadding = 40;

        // Check if two shadow rectangles overlap
        const shadowsOverlap = (card1, card2) => {
            const rect1 = {
                left: card1.x - shadowPadding,
                right: card1.x + cardWidth + shadowPadding,
                top: card1.y - shadowPadding,
                bottom: card1.y + cardHeight + shadowPadding
            };

            const rect2 = {
                left: card2.x - shadowPadding,
                right: card2.x + cardWidth + shadowPadding,
                top: card2.y - shadowPadding,
                bottom: card2.y + cardHeight + shadowPadding
            };

            // Check if rectangles overlap
            return !(rect1.right < rect2.left ||
                     rect1.left > rect2.right ||
                     rect1.bottom < rect2.top ||
                     rect1.top > rect2.bottom);
        };

        const findConnectedCards = (card, constellation) => {
            if (visited.has(card.id)) return;
            visited.add(card.id);
            constellation.add(card.id);

            // Find cards whose shadows overlap with this card's shadow
            for (const otherCard of cards) {
                if (visited.has(otherCard.id)) continue;

                if (shadowsOverlap(card, otherCard)) {
                    findConnectedCards(otherCard, constellation);
                }
            }
        };

        for (const card of cards) {
            if (!visited.has(card.id)) {
                const constellation = new Set();
                findConnectedCards(card, constellation);
                newConstellations.push(constellation);
            }
        }

        return newConstellations;
    }

    /**
     * Update constellation assignments
     */
    updateConstellations(cards) {
        // Don't update constellations while dragging - prevents constellation IDs from changing mid-drag
        if (this.isDraggingConstellation) {
            debugLog.info('Skipping constellation update during drag');
            return;
        }

        if (!cards || cards.length === 0) {
            this.constellations.clear();
            this.cardToConstellation.clear();
            this.renderConstellations([]);
            debugLog.info('Cleared all constellations (no cards)');
            return;
        }

        // Log card IDs being processed
        const cardIds = cards.map(c => c.id);
        debugLog.info('Processing constellation update', {
            cardCount: cards.length,
            cardIds
        });

        // Detect new constellations
        const detectedConstellations = this.detectConstellations(cards);

        // Clear old mappings
        this.constellations.clear();
        this.cardToConstellation.clear();

        // Create new constellation IDs and mappings
        detectedConstellations.forEach((cardSet, index) => {
            const constellationId = `constellation-${Date.now()}-${index}`;
            this.constellations.set(constellationId, cardSet);

            // Map each card to its constellation
            for (const cardId of cardSet) {
                this.cardToConstellation.set(cardId, constellationId);
            }
        });

        debugLog.info('Constellations updated', {
            count: this.constellations.size,
            cards: cards.length,
            constellations: Array.from(this.constellations.entries()).map(([id, cardIds]) => ({
                id,
                cardIds: Array.from(cardIds)
            }))
        });

        // Render the constellation backgrounds
        this.renderConstellations(cards);
    }

    /**
     * Update constellations with debouncing
     */
    updateConstellationsDebounced(cards) {
        if (this.updateDebounceTimer) {
            clearTimeout(this.updateDebounceTimer);
        }

        this.updateDebounceTimer = setTimeout(() => {
            this.updateConstellations(cards);
            this.updateDebounceTimer = null;
        }, this.UPDATE_DEBOUNCE_MS);
    }

    /**
     * Calculate bounding box for a constellation
     */
    calculateBoundingBox(cardIds, cards) {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        let foundCards = 0;

        for (const cardId of cardIds) {
            const card = cards.find(c => c.id === cardId);
            if (!card) {
                debugLog.warn('Card not found in calculateBoundingBox', { cardId, availableCards: cards.map(c => c.id) });
                continue;
            }

            foundCards++;

            // Card dimensions (approximate)
            const cardWidth = 150;
            const cardHeight = 120;

            minX = Math.min(minX, card.x);
            minY = Math.min(minY, card.y);
            maxX = Math.max(maxX, card.x + cardWidth);
            maxY = Math.max(maxY, card.y + cardHeight);
        }

        // If no cards were found, return null to skip rendering
        if (foundCards === 0) {
            debugLog.error('No cards found for constellation bounding box', { cardIds: Array.from(cardIds) });
            return null;
        }

        // Add padding
        const padding = 20;
        return {
            x: minX - padding,
            y: minY - padding,
            width: maxX - minX + padding * 2,
            height: maxY - minY + padding * 2
        };
    }

    /**
     * Calculate minimum z-index of constellation members
     */
    getMinZIndex(cardIds, cards) {
        let minZ = Infinity;
        for (const cardId of cardIds) {
            const card = cards.find(c => c.id === cardId);
            if (card && card.zIndex !== undefined) {
                minZ = Math.min(minZ, card.zIndex);
            }
        }
        return minZ === Infinity ? 0 : minZ;
    }

    /**
     * Render constellation shadows - one shadow per card in a constellation
     */
    renderConstellations(cards) {
        if (!this.constellationLayer) return;

        // Clear existing shadows
        this.constellationLayer.innerHTML = '';

        const renderedConstellations = [];

        for (const [constellationId, cardIds] of this.constellations) {
            if (cardIds.size < 2) continue; // Skip single-card constellations

            const minZ = this.getMinZIndex(cardIds, cards);

            // Create a shadow for each card in the constellation
            for (const cardId of cardIds) {
                const card = cards.find(c => c.id === cardId);
                if (!card) continue;

                // Convert workspace coordinates to CSS coordinates
                const cssPos = CoordinateSystem.workspaceToCSS(card.x, card.y, this.viewport);

                // Card dimensions
                const cardWidth = 150;
                const cardHeight = 120;
                const shadowPadding = 40; // Padding around card for shadow

                // Create shadow div - rectangular shadow slightly larger than card
                const shadow = document.createElement('div');
                shadow.className = 'constellation-shadow';
                shadow.style.position = 'absolute';
                shadow.style.left = `${cssPos.x - shadowPadding}px`;
                shadow.style.top = `${cssPos.y - shadowPadding}px`;
                shadow.style.width = `${cardWidth + shadowPadding * 2}px`;
                shadow.style.height = `${cardHeight + shadowPadding * 2}px`;
                shadow.style.backgroundColor = '#E8E8E8'; // Very light grey, opaque
                shadow.style.zIndex = minZ - 1; // All shadows behind all cards
                shadow.style.cursor = 'grab';
                shadow.style.pointerEvents = 'auto';
                shadow.dataset.constellationId = constellationId;
                shadow.dataset.cardId = cardId;

                // Add drag handlers for constellation dragging
                this.attachDragHandlers(shadow, constellationId, cards);

                this.constellationLayer.appendChild(shadow);
            }

            renderedConstellations.push({
                constellationId,
                cardCount: cardIds.size,
                cardIds: Array.from(cardIds),
                minZ
            });
        }

        debugLog.info('Constellation shadows rendered', {
            constellations: this.constellations.size,
            totalShadows: this.constellationLayer.children.length,
            details: renderedConstellations
        });
    }

    /**
     * Attach drag event handlers to constellation background
     */
    attachDragHandlers(background, constellationId, cards) {
        const onMouseDown = (e) => {
            e.preventDefault();
            e.stopPropagation();

            this.isDraggingConstellation = true;
            this.draggedConstellationId = constellationId;
            background.style.cursor = 'grabbing';

            // Store initial mouse position in workspace coordinates (no pan)
            this.dragStartPos = CoordinateSystem.screenToWorkspaceNoPan(
                e.clientX,
                e.clientY,
                this.viewport,
                this.viewportManager.currentZoom
            );

            // Cache DOM elements and initial positions for performance
            this.dragStartCardPositions.clear();
            this.dragCardElements = new Map(); // Cache card DOM elements
            this.dragShadowElements = []; // Cache shadow elements

            const cardIds = this.constellations.get(constellationId);
            for (const cardId of cardIds) {
                const card = cards.find(c => c.id === cardId);
                if (card) {
                    this.dragStartCardPositions.set(cardId, { x: card.x, y: card.y });

                    // Cache card element
                    const cardElement = document.querySelector(`[data-id="${cardId}"]`);
                    if (cardElement) {
                        this.dragCardElements.set(cardId, cardElement);
                    }
                }
            }

            // Cache shadow elements
            this.dragShadowElements = Array.from(
                this.constellationLayer.querySelectorAll(`[data-constellation-id="${constellationId}"]`)
            );

            // Add global mouse handlers
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);

            debugLog.info('Constellation drag started', { constellationId });
        };

        const onMouseMove = (e) => {
            if (!this.isDraggingConstellation) return;

            // Get current mouse position in workspace coordinates (no pan)
            const currentPos = CoordinateSystem.screenToWorkspaceNoPan(
                e.clientX,
                e.clientY,
                this.viewport,
                this.viewportManager.currentZoom
            );

            // Calculate delta from drag start
            const deltaX = currentPos.x - this.dragStartPos.x;
            const deltaY = currentPos.y - this.dragStartPos.y;

            const shadowPadding = 40;

            // Move all cards in constellation using cached elements
            for (const [cardId, startPos] of this.dragStartCardPositions) {
                const newX = startPos.x + deltaX;
                const newY = startPos.y + deltaY;

                // Update card position in appState
                if (window.appState && window.appState.cards.has(cardId)) {
                    const card = window.appState.cards.get(cardId);
                    card.x = newX;
                    card.y = newY;

                    // Update DOM element position using cached element
                    const cardElement = this.dragCardElements.get(cardId);
                    if (cardElement) {
                        const cssPos = CoordinateSystem.workspaceToCSS(newX, newY, this.viewport);
                        cardElement.style.left = `${cssPos.x}px`;
                        cardElement.style.top = `${cssPos.y}px`;
                    }
                }
            }

            // Update shadow positions using cached shadow elements
            for (const shadow of this.dragShadowElements) {
                const cardId = shadow.dataset.cardId;
                if (window.appState && window.appState.cards.has(cardId)) {
                    const card = window.appState.cards.get(cardId);
                    const cssPos = CoordinateSystem.workspaceToCSS(card.x, card.y, this.viewport);
                    shadow.style.left = `${cssPos.x - shadowPadding}px`;
                    shadow.style.top = `${cssPos.y - shadowPadding}px`;
                }
            }
        };

        const onMouseUp = () => {
            if (!this.isDraggingConstellation) return;

            background.style.cursor = 'grab';
            this.isDraggingConstellation = false;

            // Remove global mouse handlers
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            const cardIds = this.constellations.get(this.draggedConstellationId);

            if (!cardIds) {
                debugLog.warn('No constellation found for draggedConstellationId', {
                    draggedConstellationId: this.draggedConstellationId
                });
                this.draggedConstellationId = null;
                this.dragStartCardPositions.clear();
                this.dragCardElements.clear();
                this.dragShadowElements = [];
                return;
            }

            debugLog.info('Constellation drag ended, checking for wormhole', {
                cardCount: cardIds.size,
                wormholeCount: window.appState?.wormholes?.size || 0
            });

            // Check if any card's shadow in the constellation was dropped on a wormhole
            if (window.appState && window.appState.wormholes) {
                const wormholes = Array.from(window.appState.wormholes.values());
                const cardWidth = 150;
                const cardHeight = 120;
                const shadowPadding = 40;

                // Check each card's shadow rectangle against each wormhole
                for (const cardId of cardIds) {
                    if (!window.appState.cards.has(cardId)) continue;

                    const card = window.appState.cards.get(cardId);

                    // Define the card's shadow rectangle
                    const shadowRect = {
                        left: card.x - shadowPadding,
                        right: card.x + cardWidth + shadowPadding,
                        top: card.y - shadowPadding,
                        bottom: card.y + cardHeight + shadowPadding
                    };

                    for (const wormhole of wormholes) {
                        // Check if wormhole center point is inside the shadow rectangle
                        const wormholeInShadow = (
                            wormhole.x >= shadowRect.left &&
                            wormhole.x <= shadowRect.right &&
                            wormhole.y >= shadowRect.top &&
                            wormhole.y <= shadowRect.bottom
                        );

                        debugLog.info('Checking card shadow against wormhole', {
                            cardId,
                            cardPos: { x: card.x, y: card.y },
                            shadowRect,
                            wormholeId: wormhole.id,
                            wormholePos: { x: wormhole.x, y: wormhole.y },
                            wormholeInShadow
                        });

                        // If wormhole is inside any card's shadow, teleport entire constellation
                        if (wormholeInShadow) {
                            const partner = window.appState.wormholes.get(wormhole.partnerId);
                            if (partner) {
                                debugLog.info('Constellation teleported through wormhole', {
                                    constellationId: this.draggedConstellationId,
                                    from: wormhole.id,
                                    to: partner.id,
                                    triggerCardId: cardId,
                                    triggerCardPos: { x: card.x, y: card.y },
                                    wormholePos: { x: wormhole.x, y: wormhole.y },
                                    cardCount: cardIds.size
                                });

                                // Teleport all cards maintaining relative positions
                                for (const otherCardId of cardIds) {
                                    if (window.appState.cards.has(otherCardId)) {
                                        const otherCard = window.appState.cards.get(otherCardId);
                                        const startPos = this.dragStartCardPositions.get(otherCardId);

                                        if (startPos) {
                                            // Calculate offset from trigger card's start position to wormhole
                                            const triggerStartPos = this.dragStartCardPositions.get(cardId);
                                            const offsetX = triggerStartPos.x - wormhole.x;
                                            const offsetY = triggerStartPos.y - wormhole.y;

                                            // Calculate this card's offset from trigger card's start position
                                            const relOffsetX = startPos.x - triggerStartPos.x;
                                            const relOffsetY = startPos.y - triggerStartPos.y;

                                            // New position: partner wormhole + trigger offset + relative offset
                                            otherCard.x = partner.x + offsetX + relOffsetX;
                                            otherCard.y = partner.y + offsetY + relOffsetY;

                                            // Update DOM element
                                            const cardElement = document.querySelector(`[data-id="${otherCardId}"]`);
                                            if (cardElement) {
                                                const cssPos = CoordinateSystem.workspaceToCSS(otherCard.x, otherCard.y, this.viewport);
                                                cardElement.style.left = `${cssPos.x}px`;
                                                cardElement.style.top = `${cssPos.y}px`;
                                            }

                                            // Emit update to server
                                            if (window.appState.socket) {
                                                window.appState.socket.emit('viewport:move', {
                                                    id: otherCardId,
                                                    x: otherCard.x,
                                                    y: otherCard.y,
                                                    zIndex: otherCard.zIndex
                                                });
                                            }
                                        }
                                    }
                                }

                                // Store first card for center button
                                window.appState.lastTeleportedCardId = cardId;

                                // Clean up (must be done before updating constellations)
                                this.draggedConstellationId = null;
                                this.dragStartCardPositions.clear();
                                this.dragCardElements.clear();
                                this.dragShadowElements = [];

                                // Update constellations after teleportation
                                if (window.constellationManager) {
                                    const allCards = Array.from(window.appState.cards.values());
                                    window.constellationManager.updateConstellationsDebounced(allCards);
                                }

                                return; // Exit early, teleportation handled
                            }
                        }
                    }
                }
            }

            // Normal drop (not on wormhole) - emit viewport:move events for all moved cards
            if (window.appState && window.appState.socket) {
                for (const cardId of cardIds) {
                    if (window.appState.cards.has(cardId)) {
                        const card = window.appState.cards.get(cardId);
                        window.appState.socket.emit('viewport:move', {
                            id: cardId,
                            x: card.x,
                            y: card.y,
                            zIndex: card.zIndex
                        });
                    }
                }
            }

            debugLog.info('Constellation drag completed', {
                constellationId: this.draggedConstellationId,
                cardsMoved: cardIds.size
            });

            // Set focal point to constellation center (average position of all cards)
            let centerX = 0;
            let centerY = 0;
            let count = 0;
            for (const cardId of cardIds) {
                if (window.appState.cards.has(cardId)) {
                    const card = window.appState.cards.get(cardId);
                    centerX += card.x;
                    centerY += card.y;
                    count++;
                }
            }
            if (count > 0) {
                this.viewportManager.focalPoint.x = centerX / count;
                this.viewportManager.focalPoint.y = centerY / count;
            }

            // Clean up (must be done before updating constellations)
            this.draggedConstellationId = null;
            this.dragStartCardPositions.clear();
            this.dragCardElements.clear();
            this.dragShadowElements = [];

            // Update constellations after normal drop
            if (window.constellationManager) {
                const allCards = Array.from(window.appState.cards.values());
                window.constellationManager.updateConstellationsDebounced(allCards);
            }
        };

        background.addEventListener('mousedown', onMouseDown);
    }

    /**
     * Get constellation ID for a card
     */
    getConstellationId(cardId) {
        return this.cardToConstellation.get(cardId);
    }

    /**
     * Get all cards in a constellation
     */
    getConstellationCards(constellationId) {
        return this.constellations.get(constellationId);
    }
}
