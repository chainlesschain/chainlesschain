# accessibility

**Source**: `src\renderer\utils\accessibility.js`

**Generated**: 2026-01-27T06:44:03.902Z

---

## class AccessibilityManager

```javascript
class AccessibilityManager
```

* Accessibility Utilities
 * 无障碍性工具集 - 提升应用的可访问性 (WCAG 2.1 AA)
 *
 * Features:
 * - ARIA attribute management
 * - Keyboard navigation helpers
 * - Focus management
 * - Screen reader announcements
 * - Color contrast checking
 * - Reduced motion detection

---

## init()

```javascript
init()
```

* Initialize accessibility features

---

## createAnnouncer()

```javascript
createAnnouncer()
```

* Create live region for screen reader announcements

---

## announce(message, priority = "polite")

```javascript
announce(message, priority = "polite")
```

* Announce message to screen readers
   * @param {string} message - Message to announce
   * @param {string} priority - 'polite' or 'assertive'

---

## focus(element, options =

```javascript
focus(element, options =
```

* Focus management

---

## focus(element, options =

```javascript
focus(element, options =
```

* Focus an element with error handling
   * @param {HTMLElement|string} element - Element or selector
   * @param {Object} options - Focus options

---

## restoreFocus()

```javascript
restoreFocus()
```

* Restore previous focus

---

## trapFocus(container)

```javascript
trapFocus(container)
```

* Focus trap (for modals, dialogs)
   * @param {HTMLElement} container - Container element

---

## releaseFocusTrap()

```javascript
releaseFocusTrap()
```

* Release focus trap

---

## getFocusableElements(container)

```javascript
getFocusableElements(container)
```

* Get all focusable elements within a container
   * @param {HTMLElement} container - Container element
   * @returns {Array} Array of focusable elements

---

## setupKeyboardNavigation()

```javascript
setupKeyboardNavigation()
```

* Keyboard navigation

---

## setupKeyboardNavigation()

```javascript
setupKeyboardNavigation()
```

* Setup global keyboard navigation

---

## isInputElement(element)

```javascript
isInputElement(element)
```

* Check if element is an input element

---

## showKeyboardShortcuts()

```javascript
showKeyboardShortcuts()
```

* Show keyboard shortcuts dialog

---

## setAria(element, attributes)

```javascript
setAria(element, attributes)
```

* ARIA helpers

---

## setAria(element, attributes)

```javascript
setAria(element, attributes)
```

* Set ARIA attributes on an element
   * @param {HTMLElement} element - Target element
   * @param {Object} attributes - ARIA attributes

---

## createAccessibleButton(config)

```javascript
createAccessibleButton(config)
```

* Create accessible button
   * @param {Object} config - Button configuration
   * @returns {HTMLButtonElement}

---

## checkContrast(foreground, background)

```javascript
checkContrast(foreground, background)
```

* Color contrast checking

---

## checkContrast(foreground, background)

```javascript
checkContrast(foreground, background)
```

* Check if color contrast meets WCAG AA standard
   * @param {string} foreground - Foreground color (hex)
   * @param {string} background - Background color (hex)
   * @returns {Object} Contrast ratio and pass/fail status

---

## getLuminance(hex)

```javascript
getLuminance(hex)
```

* Get relative luminance of a color
   * @param {string} hex - Hex color code
   * @returns {number} Luminance value

---

## hexToRgb(hex)

```javascript
hexToRgb(hex)
```

* Convert hex color to RGB
   * @param {string} hex - Hex color code
   * @returns {Object} RGB values

---

## prefersReducedMotion()

```javascript
prefersReducedMotion()
```

* Utility functions

---

## prefersReducedMotion()

```javascript
prefersReducedMotion()
```

* Check if reduced motion is preferred
   * @returns {boolean}

---

## prefersHighContrast()

```javascript
prefersHighContrast()
```

* Check if high contrast is preferred
   * @returns {boolean}

---

## getColorSchemePreference()

```javascript
getColorSchemePreference()
```

* Get current color scheme preference
   * @returns {string} 'light' or 'dark'

---

## destroy()

```javascript
destroy()
```

* Destroy and cleanup

---

## export function getAccessibilityManager(options)

```javascript
export function getAccessibilityManager(options)
```

* Get or create accessibility manager instance

---

## export function announce(message, priority)

```javascript
export function announce(message, priority)
```

* Convenience functions

---

