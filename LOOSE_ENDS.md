# Loose Ends

This document tracks potential improvements and documents current behavior for future refinement.

## Performance Improvements

### Rendering Optimization
- **Debounce/throttle frequent updates**: Operations like auto-pan during drag, coordinate display updates, and transform applications could be throttled to reduce unnecessary reflows
- **Virtual rendering for large card sets**: If the workspace grows to hundreds of cards, implement viewport-based culling to only render visible cards
- **Optimize z-index updates**: Currently every card position change triggers a z-index recalculation broadcast. Consider batching these updates or using a dirty flag system
- **Canvas-based rendering**: For very large workspaces, consider rendering cards on a canvas instead of DOM elements to improve performance

### Network Optimization
- **Batch socket emissions**: Instead of emitting individual card updates, batch multiple changes and send them together
- **Delta compression**: Send only changed properties rather than full card state
- **Client-side prediction**: Apply local changes immediately and reconcile with server, rather than waiting for server confirmation

### Memory Management
- **Cleanup observers**: Ensure ResizeObserver and other observers are properly disconnected when elements are removed
- **Event listener cleanup**: Audit for potential memory leaks from event listeners on dynamically created elements

## Auto-Pan and Auto-Zoom Behavior

### Current Implementation
Auto-pan and auto-zoom activate when dragging cards, constellations, or wormholes near viewport edges.

**Auto-Pan**:
- Triggers when dragged object moves more than 65% of the distance from its starting position toward a viewport edge
- Pans at `PAN_SPEED = 3.0` pixels per frame
- Threshold set at 65% to avoid being too aggressive

**Auto-Zoom**:
- Gradually zooms out when auto-panning is active
- Zooms at `ZOOM_SPEED = 0.005` per frame
- Minimum zoom level: `MIN_ZOOM = 0.1`
- Uses `zoomTo()` to maintain focal point stability

### Potential Improvements
1. **Acceleration curves**: Instead of constant speed, use easing functions so pan/zoom starts slow and accelerates
2. **Distance-based speed**: Pan/zoom faster when dragging further from edges
3. **Smooth restoration**: When drag ends, smoothly animate back to manual zoom rather than instant snap
4. **Edge proximity detection**: Consider both cursor position AND dragged object position for more intuitive behavior
5. **Diagonal movement**: Currently pans on X and Y independently - could optimize for diagonal movement
6. **User preferences**: Make auto-pan/zoom speed configurable in settings

## Center Button Behavior

### Current Implementation
The center button has two modes based on click timing:

**Slow Click (>500ms between clicks)**:
- Toggles between current focal point and previous focal point
- Allows jumping back and forth between two locations
- Useful for comparing two areas of the workspace
- Stores previous focal point in `previousFocalPoint` variable

**Fast Double-Click (<500ms between clicks)**:
- Restores preferred zoom level set by zoom buttons or scroll wheel
- Keeps current focal point centered
- Does NOT restore pan position, only zoom level
- Saves current state as new manual zoom after restoring

### Potential Improvements
1. **Focal point history stack**: Instead of just two focal points, maintain a history stack (last 5-10 positions)
2. **Visual feedback**: Show animation or highlight when toggling between focal points
3. **Smart focal point tracking**: Automatically save focal point when:
   - Dropping cards/constellations/wormholes
   - Teleporting through wormholes
   - Zooming to a specific location
   - Manual panning completes
4. **Configurable timing**: Make the 500ms threshold configurable for users with different clicking speeds
5. **Triple-click behavior**: Add a third action for triple-click (e.g., zoom to fit all cards)
6. **Breadcrumb trail**: Visual indicator showing previous focal point locations on the workspace

## Palette Zoom Behavior

### Current Implementation
Scroll wheel over palette scales the palette width to adjust viewport/palette space allocation:
- Scales palette width dynamically (base: 200px, range: 0.5x to 2.0x)
- Scales padding, margins, button heights proportionally
- Scales card stack offsets (::before and ::after pseudo-elements)
- Height always stays at 100%

### Potential Improvements
1. **Persist palette zoom**: Save palette scale to localStorage/server so it persists across sessions
2. **Smooth transitions**: Add CSS transitions when scaling to avoid jarring jumps
3. **Min/max visual feedback**: Show indicator when reaching min (0.5x) or max (2.0x) scale
4. **Font size scaling**: Currently text size doesn't scale - consider scaling font-size proportionally
5. **Scroll position preservation**: Maintain scroll position within palette when scaling
6. **Keyboard shortcuts**: Add hotkeys for palette zoom (e.g., Ctrl+[ and Ctrl+])

## Viewport Coordinate System

### Current Behavior
- Workspace uses infinite canvas coordinate system with origin at (0,0)
- Focal point tracks the workspace coordinates of the center of user attention
- Pan and zoom transformations keep focal point at same screen position
- Coordinate display shows focal point position in workspace coordinates

### Potential Improvements
1. **Grid overlay**: Optional grid overlay showing coordinate system
2. **Minimap**: Small overview map showing viewport position relative to all cards
3. **Coordinate search**: Jump to specific coordinates via text input
4. **Bookmark locations**: Save named locations in the workspace
5. **Distance ruler**: Tool to measure distances between points in workspace coordinates

## Wormhole and Teleportation

### Current Behavior
- Wormholes teleport cards between locations
- Last teleported card ID tracked in `appState.lastTeleportedCardId`
- Currently cleared after first center button click

### Potential Improvements
1. **Teleport history**: Track history of all teleportations
2. **Wormhole usage statistics**: Show how many times each wormhole has been used
3. **Bidirectional highlighting**: When hovering one wormhole end, highlight its pair
4. **Teleport animation**: Visual feedback showing card moving through wormhole
5. **Wormhole groups**: Support more than 2 ends (multi-endpoint wormholes)

## Constellation Features

### Current Behavior
- Constellations group cards together
- Dragging one card in constellation moves all cards
- Constellation center becomes focal point when dropped

### Potential Improvements
1. **Constellation outlines**: Visual boundary showing constellation area
2. **Constellation zoom**: Double-click constellation to zoom to fit all cards
3. **Constellation metadata**: Name, description, creation date for each constellation
4. **Nested constellations**: Support constellations containing other constellations
5. **Auto-layout**: Automatic arrangement of cards within constellation
6. **Collision detection**: Prevent constellation cards from overlapping

## Testing and Debugging

### Needed Tests
1. **Edge case handling**: Test behavior at extreme zoom levels, large coordinate values, many simultaneous drags
2. **Performance benchmarks**: Measure frame rate with 100, 500, 1000+ cards
3. **Network resilience**: Test behavior with poor connectivity, disconnections, reconnections
4. **Multi-user stress test**: Many users editing simultaneously
5. **Browser compatibility**: Test on Safari, Firefox, Chrome, Edge
6. **Mobile support**: Touch events, gesture handling, responsive layout

### Debug Tools Needed
1. **Performance overlay**: Show FPS, DOM node count, active listeners
2. **Network inspector**: Visualize socket.io message traffic
3. **State inspector**: View current appState, viewportManager state in UI
4. **Time travel debugging**: Record and replay interaction sequences
5. **Coordinate overlay**: Show workspace coordinates on hover
