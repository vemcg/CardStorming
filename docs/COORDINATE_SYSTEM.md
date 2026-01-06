# CardStorming Coordinate System Documentation

## Overview

This document explains in detail how coordinates work in the CardStorming application, including all transformations between different coordinate systems.

---

## Coordinate Systems

We have **THREE** different coordinate systems in play:

### 1. Screen Coordinates (Absolute)
- **Origin**: Top-left corner of the browser window
- **Units**: Pixels
- **Examples**: Mouse event coordinates (`e.clientX`, `e.clientY`)
- **Range**: (0, 0) to (window width, window height)

### 2. Workspace Coordinates (Center-Origin)
- **Origin**: Center of the viewport content area
- **Units**: Pixels
- **Purpose**: Logical positioning of cards independent of zoom/pan
- **Range**: Unlimited (-∞ to +∞)
- **Important**: This is where card positions are stored on the server

### 3. CSS Coordinates (Top-Left Origin)
- **Origin**: Top-left corner of viewport content area
- **Units**: Pixels
- **Purpose**: DOM element positioning (`element.style.left`, `element.style.top`)
- **Range**: Unlimited (-∞ to +∞)

---

## The Viewport Structure

```
┌─────────────────────────────────────────┐
│ Browser Window (Screen Coordinates)     │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │ .viewport                          │ │ ← viewport.getBoundingClientRect()
│  │   Padding: 32px                    │ │
│  │  ┌──────────────────────────────┐  │ │
│  │  │ .viewport-content            │  │ │ ← Content area (after padding)
│  │  │                              │  │ │
│  │  │   CENTER (Workspace 0,0) ●   │  │ │ ← Workspace origin
│  │  │                              │  │ │
│  │  │   Cards positioned here      │  │ │
│  │  │                              │  │ │
│  │  └──────────────────────────────┘  │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### Key Measurements

```javascript
const viewport = document.querySelector('.viewport');
const rect = viewport.getBoundingClientRect();
const viewportStyle = window.getComputedStyle(viewport);
const paddingLeft = parseFloat(viewportStyle.paddingLeft);  // 32px
const paddingTop = parseFloat(viewportStyle.paddingTop);    // 32px

// Content area (excluding padding)
const viewportWidth = rect.width - paddingLeft * 2;
const viewportHeight = rect.height - paddingTop * 2;

// Center point in CSS coordinates
const centerX = viewportWidth / 2;   // e.g., 968.5px for 2001px width
const centerY = viewportHeight / 2;  // e.g., 542px for 1148px height
```

---

## Transform System

The `.viewport-content` element has a CSS transform applied:

```css
.viewport-content {
    transform: translate(panX, panY) scale(zoom);
}
```

### Transform Variables

| Variable | Type | Description | Initial Value |
|----------|------|-------------|---------------|
| `panX` | Number (px) | Horizontal pan offset in screen pixels | 0 |
| `panY` | Number (px) | Vertical pan offset in screen pixels | 0 |
| `currentZoom` | Number | Scale factor | 1.0 |
| `focalPoint.x` | Number (0-1) | Horizontal focal point (normalized) | 0.5 |
| `focalPoint.y` | Number (0-1) | Vertical focal point (normalized) | 0.5 |

**CRITICAL**: The pan values are in **screen pixels**, applied **before** the scale transform.

---

## Coordinate Conversions

### 1. Screen to Workspace

**Purpose**: Convert mouse position to logical card position

**Function**: `screenToWorkspace(screenX, screenY)`

**Steps**:

```javascript
// 1. Get viewport dimensions
const viewport = document.querySelector('.viewport');
const rect = viewport.getBoundingClientRect();
const viewportStyle = window.getComputedStyle(viewport);
const paddingLeft = parseFloat(viewportStyle.paddingLeft);  // 32
const paddingTop = parseFloat(viewportStyle.paddingTop);    // 32

// 2. Get current pan offset from transform
const viewportContent = document.querySelector('.viewport-content');
const currentTransform = viewportContent.style.transform;
// Parse: "translate(-15px, 0px) scale(1)"
let panX = 0, panY = 0;
const match = currentTransform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
if (match) {
    panX = parseFloat(match[1]);  // e.g., -15
    panY = parseFloat(match[2]);  // e.g., 0
}

// 3. Calculate viewport center
const viewportWidth = rect.width - paddingLeft * 2;   // e.g., 1937
const viewportHeight = rect.height - paddingTop * 2;  // e.g., 1084
const centerX = viewportWidth / 2;   // e.g., 968.5
const centerY = viewportHeight / 2;  // e.g., 542

// 4. Transform screen to workspace
// Workspace = (screen - viewport.left - padding - center - pan) / zoom
const workspaceX = (screenX - rect.left - paddingLeft - centerX - panX) / currentZoom;
const workspaceY = (screenY - rect.top - paddingTop - centerY - panY) / currentZoom;
```

**Example**:
```
Given:
  screenX = 786
  screenY = 577 (clientY from mouse event)
  rect.left = 0
  rect.top = 115
  paddingLeft = 32
  paddingTop = 32
  centerX = 968.5
  centerY = 542
  panX = -15
  panY = 0
  currentZoom = 1.0

Calculate:
  workspaceX = (786 - 0 - 32 - 968.5 - (-15)) / 1.0
             = (786 - 32 - 968.5 + 15) / 1.0
             = -199.5

  workspaceY = (577 - 115 - 32 - 542 - 0) / 1.0
             = -112
```

---

### 2. Workspace to CSS

**Purpose**: Convert logical card position to DOM positioning

**Function**: `workspaceToCSS(workspaceX, workspaceY)`

**Steps**:

```javascript
// 1. Get viewport dimensions (same as above)
const viewport = document.querySelector('.viewport');
const rect = viewport.getBoundingClientRect();
const viewportStyle = window.getComputedStyle(viewport);
const paddingLeft = parseFloat(viewportStyle.paddingLeft);
const paddingTop = parseFloat(viewportStyle.paddingTop);

// 2. Calculate viewport center
const viewportWidth = rect.width - paddingLeft * 2;
const viewportHeight = rect.height - paddingTop * 2;
const centerX = viewportWidth / 2;
const centerY = viewportHeight / 2;

// 3. Convert workspace to CSS
// CSS = workspace + center
const cssX = workspaceX + centerX;
const cssY = workspaceY + centerY;
```

**Example**:
```
Given:
  workspaceX = -275
  workspaceY = -150
  centerX = 968.5
  centerY = 542

Calculate:
  cssX = -275 + 968.5 = 693.5
  cssY = -150 + 542 = 392
```

---

### 3. CSS to Workspace

**Purpose**: Convert DOM position back to logical position (used in zoom reset)

**Formula**:
```javascript
const workspaceX = cssX - centerX;
const workspaceY = cssY - centerY;
```

**Example**:
```
Given:
  cssX = 693.5 (from card.style.left)
  cssY = 392 (from card.style.top)
  centerX = 968.5
  centerY = 542

Calculate:
  workspaceX = 693.5 - 968.5 = -275
  workspaceY = 392 - 542 = -150
```

---

## Card Drop Flow

### When Dropping a NEW Card from Palette

**Step 1**: Get drop position
```javascript
// Mouse at screen (938, 635)
const dropPos = screenToWorkspace(938, 635);
// Result: { x: -24.5, y: -56 }
```

**Step 2**: Center card under cursor
```javascript
// Card is 150px wide, 100px tall
let x = dropPos.x - 75;  // -24.5 - 75 = -99.5
let y = dropPos.y - 50;  // -56 - 50 = -106
```

**Step 3**: Snap to grid (25px grid)
```javascript
x = Math.round(-99.5 / 25) * 25 = -100
y = Math.round(-106 / 25) * 25 = -100
```

**Step 4**: Send to server as workspace coordinates
```javascript
socket.emit('viewport:add', {
    id: 'card123',
    header: 'B1',
    body: '',
    color: '#5073ff',
    left: '-100px',        // ← Workspace coordinates!
    top: '-100px',
    authorInitials: 'VEM'
});
```

**Step 5**: Server broadcasts to all clients

**Step 6**: Client receives and creates card
```javascript
socket.on('viewport:add', (cardData) => {
    createViewportCard(
        cardData.id,
        cardData.header,
        cardData.body,
        cardData.color,
        cardData.left,      // '-100px'
        cardData.top,       // '-100px'
        cardData.zIndex,
        cardData.authorInitials
    );
});
```

**Step 7**: Convert to CSS and position card
```javascript
function createViewportCard(id, header, body, color, left, top, zIndex, authorInitials) {
    const card = document.createElement('div');

    // Parse workspace coordinates
    const workspaceX = parseFloat(left);   // -100
    const workspaceY = parseFloat(top);    // -100

    // Convert to CSS coordinates
    const cssPos = workspaceToCSS(workspaceX, workspaceY);
    // Result: { x: 868.5, y: 442 }

    // Position the card
    card.style.left = cssPos.x + 'px';     // '868.5px'
    card.style.top = cssPos.y + 'px';      // '442px'

    viewportContent.appendChild(card);
}
```

---

### When Moving an EXISTING Card

**Step 1**: Drag starts - record grab offset
```javascript
viewport.addEventListener('dragstart', function(e) {
    const cardRect = e.target.getBoundingClientRect();

    // Offset from card's top-left to grab point
    offsetX = e.clientX - cardRect.left;  // e.g., 73px
    offsetY = e.clientY - cardRect.top;   // e.g., 59px
});
```

**Step 2**: During drag - auto-zoom and pan
```javascript
viewport.addEventListener('dragover', function(e) {
    handleDragZoomAndPan(e);
    // Gradually zooms out and pans as you approach edges
});
```

**Step 3**: Drop - calculate new position
```javascript
viewport.addEventListener('drop', function(e) {
    // Adjust for grab offset
    const adjustedScreenX = e.clientX - offsetX;  // 929 - 92.5 = 836.5
    const adjustedScreenY = e.clientY - offsetY;  // 677 - 40 = 637

    // Convert to workspace
    const finalPos = screenToWorkspace(adjustedScreenX, adjustedScreenY);
    // THIS IS THE PROBLEM: When zoomed out, the pan offset is huge,
    // which makes the workspace coordinates completely wrong!

    // Snap to grid
    const snappedX = snapToGrid(finalPos.x);
    const snappedY = snapToGrid(finalPos.y);

    // Send to server
    socket.emit('viewport:move', {
        id: draggedViewportCard.dataset.id,
        left: snappedX + 'px',
        top: snappedY + 'px'
    });
});
```

**Step 4**: Zoom reset after drop
```javascript
viewport.addEventListener('dragend', function(e) {
    if (currentZoom < 1.0) {
        // Get card's CSS position
        const cardLeft = parseFloat(draggedViewportCard.style.left);
        const cardTop = parseFloat(draggedViewportCard.style.top);

        // Convert CSS → Workspace
        const workspaceX = cardLeft - centerX;
        const workspaceY = cardTop - centerY;

        // Calculate card center in workspace
        const cardCenterX = workspaceX + 75;  // 150px / 2
        const cardCenterY = workspaceY + 50;  // 100px / 2

        // Pan to center the card
        const newPanX = -cardCenterX;
        const newPanY = -cardCenterY;

        // Reset transform
        currentZoom = 1.0;
        viewportContent.style.transform =
            `translate(${newPanX}px, ${newPanY}px) scale(1.0)`;
    }
});
```

---

## The Problem: Zoomed Drop Positioning

### Root Cause

When you drop a card while zoomed out (e.g., zoom = 0.1), the `screenToWorkspace()` calculation includes the current pan offset. But the pan offset was calculated for the zoomed-out view, and it's **huge** (e.g., panX = -55.1, panY = -73.6 at 0.1x zoom translates to -551px, -736px in workspace units).

### Example of the Bug

```
Drop at screen position: (836.5, 637)
Current state:
  zoom = 0.1
  panX = -55.1
  panY = -73.6

screenToWorkspace calculation:
  workspaceX = (836.5 - 0 - 32 - 968.5 - (-55.1)) / 0.1
             = (836.5 - 32 - 968.5 + 55.1) / 0.1
             = -108.9 / 0.1
             = -1089

This positions the card at workspace (-1089, 216), which converts to
CSS (-120.5px, 758px) at zoom 1.0.

But when we zoom reset and change the pan, the card is now positioned
incorrectly relative to the new pan offset!
```

### The Issue in Detail

1. **During drag at zoom 0.1**: The view is panned/zoomed to show a wide area
2. **Calculate drop position**: Uses current pan offset to calculate workspace coords
3. **Card gets positioned**: Based on those (incorrect) workspace coords
4. **Zoom resets to 1.0**: Pan changes to center the card
5. **Card appears in wrong place**: Because its workspace position was calculated using the wrong pan offset

---

## Proposed Solution

The workspace coordinates should be **independent of pan and zoom**. The issue is that we're mixing the current pan state into the workspace calculation.

### Option 1: Store Screen Position During Drag

During drag, store the screen position where the card should end up (relative to a fixed reference), then convert to workspace AFTER resetting zoom.

### Option 2: Separate Workspace from View Transform

Don't use pan in the `screenToWorkspace` calculation when dropping. Instead:
1. Calculate where in the viewport the card is (0-1 normalized)
2. Map that directly to workspace coordinates
3. Don't factor in current pan

### Option 3: Fix Pan Before Converting

Before calling `screenToWorkspace`, temporarily reset pan to 0, do the conversion, then restore pan.

---

## Current Variable Summary

| Variable | Location | Type | Purpose |
|----------|----------|------|---------|
| `currentZoom` | Global | Number | Current zoom level (0.1 to 3.0) |
| `focalPoint.x` | Global | Number | Horizontal focal point (0-1) |
| `focalPoint.y` | Global | Number | Vertical focal point (0-1) |
| `panX` | Transform string | Number (px) | Horizontal pan offset |
| `panY` | Transform string | Number (px) | Vertical pan offset |
| `draggedViewportCard` | Global | Element | Card being dragged |
| `offsetX` | Drag state | Number (px) | Grab offset X |
| `offsetY` | Drag state | Number (px) | Grab offset Y |
| `dragStartTime` | Global | Number (ms) | When drag started (for zoom delay) |

---

## Reading This Document

1. **Save this file** as `COORDINATE_SYSTEM.md` in your project root
2. **View in VS Code**: Right-click → "Open Preview" for formatted view
3. **Or view in browser**: Use a Markdown viewer extension or upload to GitHub

The key sections to understand:
- **Coordinate Systems**: What each system represents
- **Coordinate Conversions**: The math behind each transformation
- **Card Drop Flow**: Step-by-step what happens when you drop a card
- **The Problem**: Why cards end up in the wrong place when zooming

---

## Next Steps

To fix the positioning bug, we need to either:
1. Modify `screenToWorkspace()` to not use pan when zoomed out
2. Store the intended drop position differently during drag
3. Recalculate the card position after zoom reset based on where it visually was

The fundamental issue is that **workspace coordinates should be absolute**, but we're calculating them using **view-dependent pan offsets**.
