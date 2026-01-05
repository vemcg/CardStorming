// Application state management

import { debugLog } from '../utils/DebugLog.js';

export class AppState {
    constructor() {
        // Collections
        this.cards = new Map();      // id -> Card
        this.wormholes = new Map();  // id -> Wormhole

        // Current drag state
        this.currentDrag = null;     // DraggableElement being dragged

        // Socket connection
        this.socket = null;

        // Project info
        this.projectId = null;
        this.projectName = null;
    }

    /**
     * Add a card
     */
    addCard(card) {
        this.cards.set(card.id, card);
        debugLog.info('Card added to state', { id: card.id, total: this.cards.size });
    }

    /**
     * Remove a card
     */
    removeCard(id) {
        const removed = this.cards.delete(id);
        if (removed) {
            debugLog.info('Card removed from state', { id, remaining: this.cards.size });
        }
        return removed;
    }

    /**
     * Get a card by ID
     */
    getCard(id) {
        return this.cards.get(id);
    }

    /**
     * Add a wormhole
     */
    addWormhole(wormhole) {
        this.wormholes.set(wormhole.id, wormhole);
        debugLog.info('Wormhole added to state', { id: wormhole.id, total: this.wormholes.size });
    }

    /**
     * Remove a wormhole
     */
    removeWormhole(id) {
        const removed = this.wormholes.delete(id);
        if (removed) {
            debugLog.info('Wormhole removed from state', { id, remaining: this.wormholes.size });
        }
        return removed;
    }

    /**
     * Get a wormhole by ID
     */
    getWormhole(id) {
        return this.wormholes.get(id);
    }

    /**
     * Clear all cards
     */
    clearCards() {
        this.cards.forEach(card => card.destroy());
        this.cards.clear();
        debugLog.info('All cards cleared');
    }

    /**
     * Clear all wormholes
     */
    clearWormholes() {
        this.wormholes.forEach(wormhole => wormhole.destroy());
        this.wormholes.clear();
        debugLog.info('All wormholes cleared');
    }

    /**
     * Clear everything
     */
    clearAll() {
        this.clearCards();
        this.clearWormholes();
        this.paletteCards = [];
        this.currentDrag = null;
    }

    /**
     * Serialize all cards for storage
     */
    serializeCards() {
        return Array.from(this.cards.values()).map(card => card.serialize());
    }

    /**
     * Serialize all wormholes for storage
     */
    serializeWormholes() {
        return Array.from(this.wormholes.values()).map(wormhole => wormhole.serialize());
    }
}
