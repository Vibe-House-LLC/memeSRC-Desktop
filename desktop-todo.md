# Desktop App Frontend TODO

## Overview
The Electron desktop app now has a transparent title bar with native macOS traffic light buttons. Your frontend needs to account for the native UI elements and provide a custom draggable header area.

## Critical Implementation Tasks

### 1. Add Draggable Header Area
**Priority: HIGH**

- [ ] Create a top header bar/navbar component (minimum height: 60px recommended)
- [ ] Apply `-webkit-app-region: drag` CSS property to the header
- [ ] Ensure the draggable area spans the full width of the window
- [ ] Add `-webkit-app-region: no-drag` to any interactive elements within the header (buttons, inputs, links, etc.)

**Example CSS:**
```css
.app-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 60px;
  -webkit-app-region: drag;
  z-index: 1000;
}

.app-header button,
.app-header input,
.app-header a {
  -webkit-app-region: no-drag;
}
```

### 2. Account for Traffic Light Buttons
**Priority: HIGH**

- [ ] Reserve left padding/margin for macOS traffic lights (positioned at x: 20, y: 20)
- [ ] Keep interactive elements at least 80px from the left edge in the top 60px
- [ ] Consider adding a visual spacer or logo area on the left side
- [ ] Test that traffic lights don't overlap with your content

**Recommended spacing:**
```css
.app-header-content {
  margin-left: 80px; /* Clear space for traffic lights */
  padding-top: 20px;
}
```

### 3. Handle Transparent Window Background
**Priority: MEDIUM**

- [ ] Set a solid background color on your root app element (body or #root)
- [ ] Ensure no transparent areas leak through unintentionally
- [ ] Test with dark mode and light mode color schemes
- [ ] Consider adding rounded corners to match macOS window style

**Example:**
```css
body, #root {
  background-color: #1a1a1a; /* or your theme color */
  margin: 0;
  min-height: 100vh;
}
```

### 4. Update Layout for Native Title Bar
**Priority: MEDIUM**

- [ ] Remove any old padding/margin that was compensating for the injected black bar
- [ ] The window height is no longer artificially increased by 40px
- [ ] Adjust any fixed positioning that relied on the old title bar offset
- [ ] Update scroll containers to account for the new header

### 5. Platform Detection (Optional)
**Priority: LOW**

- [ ] Detect if running in Electron vs web browser
- [ ] Show/hide custom title bar based on platform
- [ ] Adjust header styling for different platforms (macOS traffic lights are left, Windows controls are right)

**Detection method:**
```javascript
const isElectron = typeof window !== 'undefined' && 
                   typeof window.process !== 'undefined' && 
                   window.process.type === 'renderer';

const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
```

### 6. Styling Considerations
**Priority: MEDIUM**

- [ ] Design header to match your app theme (no more forced black bar)
- [ ] Add visual hierarchy (title, navigation, actions)
- [ ] Consider adding a subtle border or shadow at the bottom of header
- [ ] Ensure sufficient contrast for readability
- [ ] Test hover states on header elements

### 7. Test Window States
**Priority: HIGH**

- [ ] Test dragging the window by grabbing the header
- [ ] Verify buttons/links in header are clickable (not dragging)
- [ ] Test fullscreen mode (traffic lights may behave differently)
- [ ] Test window resizing and ensure header remains correct
- [ ] Verify traffic lights remain visible on different background colors

### 8. Responsive Considerations
**Priority: MEDIUM**

- [ ] Ensure header works at minimum window width (1000px default)
- [ ] Test header layout when window is maximized
- [ ] Consider collapsing header elements on smaller widths
- [ ] Ensure traffic light clearance is maintained at all widths

## Technical Notes

### Current Electron Configuration
```javascript
{
  transparent: true,
  titleBarStyle: 'hiddenInset',
  trafficLightPosition: { x: 20, y: 20 },
  defaultWidth: 1000,
  defaultHeight: 800
}
```

### Key CSS Properties
- `-webkit-app-region: drag` - Makes area draggable
- `-webkit-app-region: no-drag` - Makes element clickable within draggable area
- `position: fixed` - Recommended for header positioning
- High `z-index` - Ensure header stays on top

### Common Pitfalls
- ⚠️ Forgetting to add `no-drag` to interactive elements
- ⚠️ Not accounting for traffic light button space
- ⚠️ Transparent background showing through unexpectedly
- ⚠️ Header too short (minimum 40px, but 60px recommended for better UX)

## Testing Checklist

- [ ] Can drag window from header area
- [ ] All header buttons/links are clickable
- [ ] Traffic lights visible and not overlapped
- [ ] No visual glitches when moving window
- [ ] Header looks good with your app theme
- [ ] Works in both dev and production modes
- [ ] No transparent areas where there shouldn't be
- [ ] Proper spacing maintained in all window states

## Future Enhancements (Optional)

- [ ] Add custom window controls for Windows builds
- [ ] Implement custom traffic light appearance (if desired)
- [ ] Add double-click to maximize functionality on header
- [ ] Consider vibrancy/blur effects (macOS feature)
- [ ] Add minimize/maximize/close IPC handlers for custom controls

