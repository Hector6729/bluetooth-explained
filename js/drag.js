// drag.js: two kinds of dragging.
//  1. makeGlassDraggable: move any liquid-glass piece around the screen.
//  2. makeObjectDraggable: move a 3D object across the floor with mouse or finger.

/*
 * ===========================================================================
 *  drag.js  -  PICKING THINGS UP AND MOVING THEM
 * ===========================================================================
 *
 *  WHAT THIS FILE DOES
 *  -------------------
 *  Part 1, makeGlassDraggable(el): makes a flat HTML panel (the frosted
 *  "liquid glass" boxes) draggable around the screen. It doesn't move the
 *  element directly; it sets CSS variables (--dx, --dy, --tilt, --sx, --sy)
 *  on it, and style.css uses those variables in a `transform` to slide,
 *  tilt and squish the panel. When you let go, a springy CSS transition
 *  makes it wobble back into shape.
 *
 *  Part 2, makeObjectDraggable(world, object, options): lets you grab a 3D
 *  object (like the headphones) and slide it across the floor. Because the
 *  screen is flat but the world is 3D, we use RAYCASTING: an invisible laser
 *  from the camera through the mouse pointer into the 3D world.
 *
 *  HOW IT FITS WITH THE OTHER FILES
 *  --------------------------------
 *  - main.js calls makeGlassDraggable() on every panel, the top bar, the
 *    hint and the welcome card. It listens for our 'panelmoved' event to
 *    re-fit the 3D view around the panels.
 *  - Step files (js/steps/*.js) call makeObjectDraggable() on their gadgets
 *    and keep the returned "stop" function to call when the step ends.
 *  - It uses world.camera, world.renderer and world.controls from scene.js.
 *
 *  KEY IDEAS USED HERE
 *  -------------------
 *  - Events and listeners: the browser fires "events" (pointerdown = finger
 *    or mouse button pressed, pointermove = moved, pointerup = released,
 *    pointercancel = the system interrupted the touch). addEventListener(name,
 *    fn) says "call fn when that happens"; removeEventListener undoes it.
 *    "Pointer" events cover mouse, touch and pen with one set of code.
 *  - The event object `e` carries details: e.clientX/e.clientY (pointer
 *    position in pixels from the window's top-left), e.target (the exact
 *    element touched), e.pointerId (which finger/mouse), e.button (0 = left).
 *  - Pointer capture: canvas.setPointerCapture(id) keeps sending that
 *    pointer's events to the canvas even if the finger slides off it.
 *  - CustomEvent + dispatchEvent: we can invent our own event name
 *    ('panelmoved') and fire it, just like the browser fires 'click'.
 *    bubbles: true means it travels up through parent elements to document.
 *  - CSS variables: el.style.setProperty('--dx', '30px') sets a variable
 *    that the stylesheet reads with var(--dx).
 *  - Arrow functions: (a, b) => a + b is a short way to write a function.
 *  - Template literals: `${x}px` is a string with the value of x inserted.
 *  - Optional chaining: thing?.method() only calls method if thing isn't null.
 *  - Three.js Raycaster: shoots a ray and lists which 3D objects it hits.
 *  - NDC (Normalised Device Coordinates): Three.js wants the mouse position
 *    as numbers from -1 to +1 (left to right, bottom to top), not pixels.
 *  - Plane: an infinite flat sheet (our floor). ray.intersectPlane() finds
 *    the exact 3D point where the ray meets it.
 * ===========================================================================
 */

// Import Three.js (for Raycaster, Vector2, Vector3 and Plane in part 2).
import * as THREE from 'three';
import { sfx } from './sound.js'; // pick-up / put-down sounds

// ---------- 1. Dragging liquid glass ----------
// Grab the glass anywhere that isn't a control (button, slider, switch, text box).
// While it moves, it squishes and tilts in the direction you pull, like a drop
// of liquid. Let go and the CSS spring curve wobbles it back into shape.
// Double-click empty glass to send it back home.

// Things inside the glass that should keep working normally instead of dragging.
// This is a CSS selector list: any button, input, select, textarea, link,
// element with role="switch", or element with class "toggle".
const CONTROLS = 'button, input, select, textarea, a, [role="switch"], .toggle';
const START_AFTER = 5; // pixels you must move before a drag starts (so clicks still work)

/**
 * makeGlassDraggable(el)
 * el: an HTML element (a DOM element: the browser's object for a tag on the page).
 * Adds the listeners that let the visitor drag it. main.js calls this for each panel.
 */
export function makeGlassDraggable(el) {
  // classList is the element's list of CSS classes; adding 'draggable' turns on
  // the "grab" cursor and the transform styles in style.css.
  el.classList.add('draggable');
  // How far the panel has been moved in total (kept between drags).
  let offsetX = 0;
  let offsetY = 0;
  let press = null; // where the pointer went down
  let dragging = false; // true once the pointer has moved more than START_AFTER pixels
  let lastX = 0; // pointer x on the previous move, used to measure sideways speed

  // Two tiny helper functions written as arrow functions:
  // set('--dx', '10px') sets a CSS variable on this element.
  const set = (name, value) => el.style.setProperty(name, value);
  const tooSmall = () => window.innerWidth <= 860; // phones stack panels, no dragging

  // When a finger or mouse button goes down on the panel...
  el.addEventListener('pointerdown', (e) => {
    // ...ignore it on phones, for non-left mouse buttons, or if it landed on a control.
    // e.target.closest(CONTROLS) walks up from the touched element looking for a
    // match, so touching the text inside a button still counts as the button.
    if (tooSmall() || e.button !== 0 || e.target.closest(CONTROLS)) return;
    // e.offsetX is the x inside the element; past clientWidth means the scrollbar.
    if (e.offsetX > el.clientWidth && e.target === el) return; // the scrollbar
    e.preventDefault(); // stop the browser starting a text selection instead of our drag
    // Remember where the press started and which pointer it was.
    press = { x: e.clientX, y: e.clientY, id: e.pointerId };
    lastX = e.clientX;
    // Follow the pointer across the whole window, even if it leaves the glass.
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  });

  // Runs on every pointer movement while the button/finger is held down.
  function move(e) {
    // Ignore moves if nothing is pressed or if it's a different finger.
    if (!press || e.pointerId !== press.id) return;
    // How far the pointer has travelled since the press, in pixels.
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (!dragging) {
      // Math.hypot(dx, dy) = straight-line distance (Pythagoras).
      // Too small a move? Treat it as a click, not a drag (yet).
      if (Math.hypot(dx, dy) < START_AFTER) return;
      dragging = true; // the drag really starts now
      el.classList.add('dragging'); // style.css: stronger shadow, no spring while held
      document.body.classList.add('is-dragging'); // e.g. stop text selection page-wide
      window.getSelection()?.removeAllRanges(); // don't highlight text while dragging
    }
    // Move the panel: previous total offset + this drag's distance.
    // The template literal `${...}px` turns the number into a string like "42px".
    set('--dx', `${offsetX + dx}px`);
    set('--dy', `${offsetY + dy}px`);

    // The liquid squish: faster sideways movement = more stretch and tilt.
    // speed = pixels moved since the last event, limited to between -40 and 40.
    const speed = Math.max(-40, Math.min(40, e.clientX - lastX));
    lastX = e.clientX;
    set('--tilt', `${speed * 0.08}deg`); // tilt up to about 3 degrees
    set('--sx', 1.02 + Math.abs(speed) * 0.0015); // stretch a little wider...
    set('--sy', 0.985 - Math.abs(speed) * 0.001); // ...and a little shorter
  }

  // Runs when the pointer is released (or the touch is cancelled).
  function release(e) {
    if (!press) return; // nothing was pressed: nothing to do
    if (!dragging && e.type === 'pointerup') move(e); // a very quick flick still counts
    // Stop listening to the whole window now the drag is over.
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', release);
    window.removeEventListener('pointercancel', release);
    if (dragging) {
      // Add this drag's distance to the running total, so the next drag starts from here.
      offsetX += e.clientX - press.x;
      offsetY += e.clientY - press.y;
      // Back to normal shape; the spring transition makes it wobble.
      set('--tilt', '0deg');
      set('--sx', 1);
      set('--sy', 1);
      el.classList.remove('dragging');
      document.body.classList.remove('is-dragging');
      // Tell the page a glass piece moved (so the 3D view can re-centre).
      // We create our own event called 'panelmoved'; main.js listens for it on document.
      el.dispatchEvent(new CustomEvent('panelmoved', { bubbles: true }));
    }
    // Reset, ready for the next press.
    press = null;
    dragging = false;
  }

  // Double-click empty glass: float back to where it started.
  el.addEventListener('dblclick', (e) => {
    if (e.target.closest(CONTROLS)) return; // double-clicking a control does nothing special
    offsetX = 0; // forget all past movement
    offsetY = 0;
    set('--dx', '0px'); // put it back at its CSS home position
    set('--dy', '0px');
    window.getSelection()?.removeAllRanges(); // a double-click normally selects a word; undo that
    el.dispatchEvent(new CustomEvent('panelmoved', { bubbles: true })); // re-fit the 3D view
  });
}

// ---------- 2. Dragging 3D objects ----------
// How it works: we shoot an invisible "ray" from the camera through the mouse.
// If the ray hits the object, we start dragging. While dragging, we find where
// the ray hits the floor (a flat plane at height 0) and move the object there.
/**
 * makeObjectDraggable(world, object, options)
 * world:  the object returned by createWorld() in scene.js.
 * object: the 3D thing to drag (usually a THREE.Group, like the headphones).
 * options (destructured from an object; "= {}" means it's optional):
 *   onMove(position) - called whenever the object moves, so the step can react.
 *   limit            - how far from the centre (in metres) it may go.
 *   axis             - 'x' = only slide left/right, 'z' = only forward/back,
 *                      anything else = move freely across the floor.
 * Returns a function that removes the listeners again (call it when the step ends).
 */
export function makeObjectDraggable(world, object, { onMove, limit, axis } = {}) {
  // Destructuring: pull these three properties out of world into variables.
  const { camera, renderer, controls } = world;
  const canvas = renderer.domElement; // the <canvas> the 3D world is drawn on
  const raycaster = new THREE.Raycaster(); // our invisible laser
  const mouse = new THREE.Vector2(); // the pointer position in NDC (-1..+1)
  // The floor as a maths plane: facing straight up (normal 0,1,0) at height 0.
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3(); // re-used to store where the ray hits the floor
  let dragging = false; // true while the object is held

  // Point the raycaster from the camera through the pointer's position.
  function aim(e) {
    // Where the canvas is on the page (left, top, width, height in pixels).
    const rect = canvas.getBoundingClientRect();
    // Convert pixels to NDC: x from -1 (left edge) to +1 (right edge)...
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    // ...and y from -1 (bottom) to +1 (top). Flipped, because screen pixels count downwards.
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera); // build the ray from these two
  }

  // Pointer pressed on the canvas.
  function onDown(e) {
    if (!object.visible) return; // hidden things can't be grabbed
    aim(e);
    // intersectObject lists everything the ray hits. true = also check the
    // object's children (the parts inside the group). Any hit = we grabbed it.
    if (raycaster.intersectObject(object, true).length > 0) {
      dragging = true;
      sfx.grab();
      controls.enabled = false; // stop the camera spinning while we drag
      canvas.setPointerCapture(e.pointerId); // keep getting this pointer's events even off the canvas
    }
  }

  // Pointer moved over the canvas (pressed or not).
  function onMoveEvent(e) {
    aim(e);
    if (!dragging) {
      // Show a "grab" hand when hovering over something draggable.
      const over = object.visible && raycaster.intersectObject(object, true).length > 0;
      if (over) canvas.style.cursor = 'grab';
      // Only clear the cursor if WE set it (another draggable might own it).
      else if (canvas.style.cursor === 'grab') canvas.style.cursor = '';
      return;
    }
    canvas.style.cursor = 'grabbing'; // closed hand while holding
    // Where does the ray hit the floor? intersectPlane writes the answer into
    // hitPoint and returns it (or null if the ray points away from the floor).
    if (raycaster.ray.intersectPlane(floor, hitPoint)) {
      // clamp keeps a number between -limit and +limit (so you can't drag it off the world).
      const clamp = (v) => Math.max(-limit, Math.min(limit, v));
      if (axis !== 'z') object.position.x = clamp(hitPoint.x); // move left/right unless locked to z
      if (axis !== 'x') object.position.z = clamp(hitPoint.z); // move forward/back unless locked to x
      if (onMove) onMove(object.position); // let the step know (e.g. to update signal strength)
    }
  }

  // Pointer released: drop the object and give camera control back.
  function onUp() {
    if (!dragging) return;
    dragging = false;
    sfx.drop();
    controls.enabled = true; // OrbitControls can spin the camera again
    canvas.style.cursor = ''; // '' = back to the default cursor from CSS
  }

  // Start listening for pointer events on the 3D canvas.
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMoveEvent);
  canvas.addEventListener('pointerup', onUp);

  // Call this to stop listening (when we leave the step).
  // We return an arrow function; the step stores it and calls it in its stop().
  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMoveEvent);
    canvas.removeEventListener('pointerup', onUp);
    canvas.style.cursor = '';
  };
}
