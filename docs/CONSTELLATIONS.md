# Constellations

## Overview

Constellations are groups of cards that are related by proximity. Cards within a threshold distance of each other are automatically grouped into the same constellation. This provides visual organization and potential for group operations.

## Detection Algorithm

### Distance-Based Connected Components (Chosen Approach)

We use a simple connected components algorithm where cards within a threshold distance are grouped together:

- **Threshold distance**: ~200-300 pixels (roughly 1.5x card width)
- **Algorithm**: Connected components using DFS
  - For each card, find all cards within threshold distance
  - Build an adjacency graph
  - Use DFS/BFS to find connected components
  - Each component is a constellation

**Pros**: Simple, fast, intuitive
**Cons**: Need to tune threshold distance

### Implementation Pseudocode

```javascript
function detectConstellations(cards, threshold = 250) {
    const constellations = [];
    const visited = new Set();

    function findConnectedCards(card, constellation) {
        if (visited.has(card.id)) return;
        visited.add(card.id);
        constellation.add(card);

        // Find nearby cards
        for (const otherCard of cards) {
            if (visited.has(otherCard.id)) continue;

            const distance = Math.sqrt(
                Math.pow(card.x - otherCard.x, 2) +
                Math.pow(card.y - otherCard.y, 2)
            );

            if (distance <= threshold) {
                findConnectedCards(otherCard, constellation);
            }
        }
    }

    for (const card of cards) {
        if (!visited.has(card.id)) {
            const constellation = new Set();
            findConnectedCards(card, constellation);
            constellations.push(constellation);
        }
    }

    return constellations;
}
```

## When to Update Constellations

- **On card drop**: Recalculate after any card is moved
- **Debounced**: Wait 100-200ms after last move to avoid excessive recalculation
- **On card add/delete**: Recalculate when cards are created or removed
- **On teleport**: Recalculate after wormhole teleportation

## Data Storage

Store constellation IDs with each card:
```javascript
card.constellationId = 'constellation-123';
```

Or maintain a separate constellation map in AppState:
```javascript
appState.constellations = new Map(); // constellationId -> Set of card IDs
```

## Visual Feedback

**Chosen approach**: Subtle background
- Semi-transparent colored region around constellation
- Drawn behind cards as an SVG or canvas shape
- Different pastel colors for each constellation
- Updates smoothly when cards move

### Alternative Approaches Considered

1. **Connecting lines**: Faint lines between constellation members
2. **Border highlight**: Highlight border when hovering over constellation member
3. **Label**: Constellation name/count in center of bounding box

## Performance Considerations

- For N cards, distance checks are O(N²)
- Should be fine for hundreds of cards
- For thousands, consider spatial indexing (quadtree/R-tree)

## Future Enhancements

- Manual constellation assignment (override automatic detection)
- Constellation naming
- Group operations (move all, delete all, color all)
- Constellation statistics (card count, area, density)
- Export/import constellation definitions
