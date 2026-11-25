// scene.js: sets up the 3D world (renderer, camera, lights, mouse controls).

/*
 * ===========================================================================
 *  scene.js  -  THE 3D WORLD "ENGINE ROOM"
 * ===========================================================================
 *
 *  WHAT THIS FILE DOES
 *  -------------------
 *  It builds everything you need before you can see anything in 3D:
 *    - a RENDERER   (the painter that turns 3D maths into pixels on a <canvas>)
 *    - a SCENE      (the empty "stage" that holds every 3D object)
 *    - a CAMERA     (the eye we look through)
 *    - LIGHTS       (so shiny materials have shading instead of looking flat)
 *    - OrbitControls (lets the visitor drag to spin the view and scroll to zoom)
 *  It also gives back a few helper functions:
 *    - flyTo()    smoothly glides the camera to a new spot when the step changes
 *    - setFrame() zooms out / slides the picture so it fits between the panels
 *    - update()   called every frame to move the camera and redraw the picture
 *
 *  HOW IT FITS WITH THE OTHER FILES
 *  --------------------------------
 *  main.js calls createWorld(...) ONCE at start-up and keeps the returned
 *  "world" object. It passes that world to every step file (js/steps/*.js),
 *  which add their own 3D objects to world.scene. main.js calls
 *  world.flyTo() when the step changes, world.setFrame() when the panels move,
 *  and world.update(dt) in its animation loop (about 60 times a second).
 *  drag.js also uses world.camera, world.renderer and world.controls.
 *
 *  KEY IDEAS USED HERE
 *  -------------------
 *  - ES modules: "import" pulls code in from another file/library, "export"
 *    makes a function available to other files. Like Python's import.
 *  - Three.js: a JavaScript library that draws 3D graphics in the browser
 *    using WebGL (the graphics card). We import all of it as the name THREE.
 *  - PerspectiveCamera: far things look smaller, like a real eye.
 *  - Vector3: a point or direction in 3D space with x, y, z numbers.
 *    In Three.js, y is UP, x is right, z is towards the viewer.
 *  - lerp ("linear interpolation"): find a point part-way between A and B.
 *    k = 0 gives A, k = 1 gives B, k = 0.5 gives exactly halfway.
 *  - setViewOffset: draws only a shifted window of the camera's picture,
 *    which slides the whole scene sideways on screen without moving the camera.
 *  - ResizeObserver: a browser tool that calls our function whenever an
 *    element changes size (e.g. the window is resized or a phone is rotated).
 *  - dt (delta time): seconds since the previous frame. Multiplying speeds by
 *    dt keeps animations the same speed on fast and slow computers.
 * ===========================================================================
 */

// Bring in the whole Three.js library under the name THREE (e.g. THREE.Scene).
// 'three' is resolved by the import map in index.html to a CDN URL.
import * as THREE from 'three';
// OrbitControls is an "add-on" (extra file) that ships with Three.js.
// The { } curly braces mean "only import this one named thing".
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * createWorld(container)
 * Builds the 3D world inside a page element (the <div id="stage"> in index.html)
 * and returns an object full of the pieces other files need.
 * "export" lets main.js import and call this function.
 */
export function createWorld(container) {
  // The renderer draws the 3D world onto a <canvas>.
  // alpha: true = see-through background, so our CSS gradient shows behind it.
  // antialias: true = smooth the jagged "staircase" edges on slanted lines.
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  // devicePixelRatio is 2 or 3 on sharp "retina" screens. We cap it at 2 so
  // phones don't have to draw 9x the pixels (which would be slow).
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // renderer.domElement is the <canvas> element it draws on; we put it on the page.
  container.appendChild(renderer.domElement);

  // The Scene is the container (like a stage) that holds every 3D object and light.
  const scene = new THREE.Scene();

  // A camera that sees in perspective, like your eyes (45° field of view).
  // Arguments: field of view in degrees, aspect ratio (width/height, fixed in
  // resize() below), and the nearest (0.1) and farthest (500) distances it can see.
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  // Start position: x = 0 (centre), y = 10 (up high), z = 18 (back towards us).
  camera.position.set(0, 10, 18);

  // OrbitControls: drag to spin around, scroll/pinch to zoom.
  // It listens to mouse/touch events on the canvas and moves the camera
  // around a "target" point (controls.target, which starts at 0,0,0).
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; // smooth, floaty movement
  controls.maxPolarAngle = Math.PI * 0.49; // don't go below the floor
  // (Angles are in radians: Math.PI = 180°, so PI * 0.49 is just under 90°,
  //  i.e. the camera can look down from above but never from under the floor.)
  controls.minDistance = 4; // closest the visitor can zoom in (in world units, "metres")
  controls.maxDistance = 60; // farthest the visitor can zoom out

  // Soft lighting: light from the sky + one "sun" for shading.
  // HemisphereLight: white from above, soft lilac (0xd9d0f5) from below, brightness 1.8.
  // Colours are written as hex numbers: 0xRRGGBB, the same as CSS #RRGGBB.
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d0f5, 1.8));
  // DirectionalLight: parallel rays like the sun, giving objects a lit and a shaded side.
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(6, 12, 8); // up and to the front-right, shining towards the centre
  scene.add(sun); // nothing is visible/active until it is added to the scene

  // "Frame": how the view fits around the glass panels.
  //   zoom  > 1 pulls the camera back so everything fits in a smaller free space.
  //   shift moves the picture sideways (in pixels) to the middle of the free space.
  // main.js works out these two numbers in fitView() and hands them to setFrame().
  const frame = { zoom: 1, shift: 0 };

  // Apply the sideways "shift" to the camera's picture.
  // setViewOffset(fullWidth, fullHeight, x, y, width, height) says "pretend the
  // picture is this big and only show the window starting at x, y". Moving the
  // window left by `shift` pixels makes the scene appear shifted right.
  function applyShift() {
    const w = container.clientWidth; // current width of the stage element in pixels
    const h = container.clientHeight; // current height in pixels
    if (frame.shift) camera.setViewOffset(w, h, -frame.shift, 0, w, h);
    else camera.clearViewOffset(); // no shift: go back to the normal, centred picture
  }

  // Keep the drawing the right size when the window changes.
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    // Resize the canvas's drawing buffer. false = don't touch its CSS size
    // (style.css already stretches it to fill the stage).
    renderer.setSize(w, h, false);
    camera.aspect = w / h; // stop the picture looking squashed or stretched
    applyShift(); // the shift depends on the size, so redo it
    // The camera caches its maths (the "projection matrix"); after changing
    // aspect or view offset we must tell it to recalculate.
    camera.updateProjectionMatrix();
  }
  // Ask the browser to call resize() whenever the stage element changes size.
  new ResizeObserver(resize).observe(container);
  resize(); // and run it once now so the first picture is the right size

  // Smoothly fly the camera to a new spot (used when changing steps).
  let flight = null; // the trip in progress, or null when the camera isn't flying
  let lastShot = null; // the step's chosen camera spot, before zooming
  /**
   * flyTo(position, target, seconds)
   * position: [x, y, z] where the camera should end up.
   * target:   [x, y, z] the point it should look at.
   * seconds:  how long the trip takes (default 1.2 if not given).
   * This only PLANS the trip; update() below actually moves the camera a bit each frame.
   */
  function flyTo(position, target, seconds = 1.2) {
    // Remember the step's original spot so setFrame() can re-fly with a new zoom later.
    // ({ position, target } is shorthand for { position: position, target: target }.)
    lastShot = { position, target };
    // "...target" is the spread operator: it unpacks the array [x, y, z] into
    // three separate arguments, so this is new THREE.Vector3(x, y, z).
    const toTarget = new THREE.Vector3(...target);
    // Zoom out along the line from the target to the camera.
    // Step by step: position minus target = the arrow from target to camera;
    // multiply that arrow by zoom (e.g. 1.5 = 50% longer); add the target back on.
    const toPos = new THREE.Vector3(...position).sub(toTarget).multiplyScalar(frame.zoom).add(toTarget);
    flight = {
      fromPos: camera.position.clone(), // where the camera is now (clone = copy, not a link)
      fromTarget: controls.target.clone(), // what it is looking at now
      toPos, // where it is going
      toTarget, // what it will look at
      t: 0, // progress from 0 (start) to 1 (arrived)
      seconds, // how long the whole trip takes
    };
  }

  // Called when panels move, collapse, or the window resizes.
  // zoom and shift come from fitView() in main.js.
  function setFrame(zoom, shift) {
    // Only count it as a real change if it's bigger than a tiny wobble,
    // so we don't restart the camera flight for no visible reason.
    const changed = Math.abs(zoom - frame.zoom) > 0.02 || Math.abs(shift - frame.shift) > 2;
    frame.zoom = zoom; // store the new values...
    frame.shift = shift;
    applyShift(); // ...apply the sideways shift straight away...
    camera.updateProjectionMatrix(); // ...and make the camera recalculate.
    // If the zoom changed, glide (in 0.6 s) to the same step spot at the new zoom.
    if (changed && lastShot) flyTo(lastShot.position, lastShot.target, 0.6);
  }

  /**
   * update(dt)
   * Called by main.js once per frame. dt = seconds since the last frame.
   * Moves the camera along its flight (if any), then draws the picture.
   */
  function update(dt) {
    if (flight) {
      // Move progress forward by the fraction of the trip that dt represents.
      // Math.min(1, ...) stops it going past 1 (the end).
      flight.t = Math.min(1, flight.t + dt / flight.seconds);
      const k = 1 - Math.pow(1 - flight.t, 3); // ease-out: fast start, gentle stop
      // lerpVectors(a, b, k) sets the vector to the point k of the way from a to b.
      camera.position.lerpVectors(flight.fromPos, flight.toPos, k);
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, k);
      if (flight.t === 1) flight = null; // arrived: stop flying
    }
    // Let OrbitControls apply the visitor's dragging plus the smooth damping,
    // and point the camera at controls.target.
    controls.update();
    // Finally, draw the scene as seen by the camera onto the canvas.
    renderer.render(scene, camera);
  }

  // Hand back everything other files need, as one object.
  // ({ THREE, renderer, ... } is shorthand for { THREE: THREE, renderer: renderer, ... }.)
  // main.js stores this as `world`; steps use world.scene, world.camera, etc.
  return { THREE, renderer, scene, camera, controls, flyTo, setFrame, update };
}
