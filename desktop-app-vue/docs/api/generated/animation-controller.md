# animation-controller

**Source**: `src\renderer\utils\animation-controller.js`

**Generated**: 2026-01-27T06:44:03.902Z

---

## class AnimationController

```javascript
class AnimationController
```

* Animation Controller
 * 动画控制器 - 提供流畅的 60 FPS 动画和过渡效果
 *
 * Features:
 * - requestAnimationFrame-based animations
 * - Easing functions collection
 * - Spring physics animations
 * - Performance monitoring
 * - Animation queue management
 * - Reduced motion support (a11y)

---

## static easings =

```javascript
static easings =
```

* Easing functions
   * See: https://easings.net/

---

## animate(config)

```javascript
animate(config)
```

* Animate a value from start to end
   * @param {Object} config - Animation configuration
   * @returns {Promise} Resolves when animation completes

---

## animateProperties(element, properties, options =

```javascript
animateProperties(element, properties, options =
```

* Animate multiple properties simultaneously
   * @param {Object} element - Target element
   * @param {Object} properties - Properties to animate
   * @param {Object} options - Animation options

---

## spring(config)

```javascript
spring(config)
```

* Spring animation (physics-based)
   * @param {Object} config - Spring configuration

---

## startAnimationLoop()

```javascript
startAnimationLoop()
```

* Animation loop (requestAnimationFrame)

---

## completeAnimation(animation)

```javascript
completeAnimation(animation)
```

* Complete an animation

---

## cancel(animationId)

```javascript
cancel(animationId)
```

* Cancel an animation

---

## cancelAll()

```javascript
cancelAll()
```

* Cancel all animations

---

## getCurrentValue(element, property)

```javascript
getCurrentValue(element, property)
```

* Get current CSS property value

---

## setProperty(element, property, value)

```javascript
setProperty(element, property, value)
```

* Set CSS property value

---

## calculateSpringDuration(tension, friction)

```javascript
calculateSpringDuration(tension, friction)
```

* Calculate spring duration

---

## checkReducedMotion()

```javascript
checkReducedMotion()
```

* Check if user prefers reduced motion

---

## generateAnimationId()

```javascript
generateAnimationId()
```

* Generate unique animation ID

---

## getStats()

```javascript
getStats()
```

* Get statistics

---

## destroy()

```javascript
destroy()
```

* Destroy and cleanup

---

## export function getAnimationController(options)

```javascript
export function getAnimationController(options)
```

* Get or create animation controller instance

---

## export async function animate(config)

```javascript
export async function animate(config)
```

* Convenience function: animate a value

---

## export async function spring(config)

```javascript
export async function spring(config)
```

* Convenience function: spring animation

---

