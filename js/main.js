// main.js: starts the 3D world and switches between steps.

/*
 * ===========================================================================
 *  main.js  -  THE CONDUCTOR (the file that starts everything)
 * ===========================================================================
 *
 *  WHAT THIS FILE DOES
 *  -------------------
 *  index.html loads this file with <script type="module" src="js/main.js">.
 *  It is the only script the page loads directly; everything else is pulled
 *  in through "import". It:
 *    1. creates the 3D world (using scene.js)
 *    2. finds the page elements it needs (titles, text, buttons, panels)
 *    3. shows a step: fills in the text, builds its controls, starts its 3D
 *    4. lets you change step (Back/Next buttons, the slider, arrow keys,
 *       swiping on phones) and hide the panels with the H key
 *    5. makes the glass panels draggable and collapsible (using drag.js)
 *    6. fits the 3D picture into the free gap between the panels
 *    7. runs the welcome screen and the final summary screen
 *    8. runs the animation loop that redraws everything ~60 times a second
 *
 *  HOW IT FITS WITH THE OTHER FILES
 *  --------------------------------
 *  - scene.js  -> createWorld() gives us `world` (scene, camera, flyTo, ...).
 *  - drag.js   -> makeGlassDraggable() for the panels.
 *  - ui.js     -> paintSlider() to colour the step slider.
 *  - js/steps/*.js -> the six lessons. Each step file exports:
 *       info   : the texts, facts and camera spot for that step
 *       start(world, panel) : builds the step's 3D objects and controls,
 *                and returns an object with update(dt) and stop().
 *    So every step looks the same from here, and main.js doesn't need to
 *    know what is inside them.
 *
 *  KEY BROWSER / JAVASCRIPT IDEAS USED HERE
 *  ----------------------------------------
 *  - ES modules: `import { x } from './file.js'` takes the exported x;
 *    `import * as waves from ...` takes ALL exports as one object (waves.info).
 *  - The DOM: document.getElementById('stage') finds the HTML element with
 *    id="stage". document.querySelectorAll('.floating') finds ALL elements
 *    with that CSS class. el.textContent sets plain text; el.innerHTML sets HTML.
 *  - classList.add/remove/toggle/contains: change an element's CSS classes,
 *    which is how we trigger styles and animations defined in style.css.
 *  - Events: addEventListener('click', fn) runs fn when it happens. We use
 *    'click', 'input' (slider moved), 'keydown' (key pressed), 'pointerdown'
 *    / 'pointerup' (finger or mouse down/up), 'resize' (window size changed)
 *    and our own 'panelmoved' event sent by drag.js.
 *  - setTimeout(fn, ms): run fn once, ms milliseconds later.
 *  - requestAnimationFrame(fn): asks the browser to call fn just before it
 *    paints the next screen frame (about 60 times a second). Calling it again
 *    inside fn creates the ANIMATION LOOP. fn receives a timestamp in ms.
 *  - dt (delta time): seconds between two frames. Steps multiply speeds by
 *    dt so motion looks the same on a 60 Hz laptop and a 120 Hz phone.
 *  - Arrow functions: () => showStep(0) is a short function with no name.
 *  - Template literals: `Step ${index + 1}` builds a string with values inside.
 *  - Destructuring: const { info } = steps[index] means info = steps[index].info.
 * ===========================================================================
 */

// Bring in the helpers from our other files (the ./ means "same folder as this file").
import { createWorld } from './scene.js'; // builds the 3D world
import { makeGlassDraggable } from './drag.js'; // makes HTML panels draggable
import { paintSlider } from './ui.js'; // colours a slider's track
import { sfx, startAudio, playMusicFor, toggleMute } from './sound.js'; // music + sound effects
// Each step file is imported as one object holding everything it exports (info, start).
import * as waves from './steps/1-waves.js';
import * as hopping from './steps/2-hopping.js';
import * as discovery from './steps/3-discovery.js';
import * as pairing from './steps/4-pairing.js';
import * as data from './steps/5-data.js';
import * as breakIt from './steps/6-break-it.js';

// To add a step: make a new file in js/steps/ and add it to this list.
// The order here is the order the visitor sees them.
const steps = [waves, hopping, discovery, pairing, data, breakIt];

// Create the 3D world inside <div id="stage">. `world` holds scene, camera, etc.
const world = createWorld(document.getElementById('stage'));

// Find the page elements we will fill in or listen to (they all have ids in index.html).
const stepSlider = document.getElementById('step-slider'); // the slider to jump between steps
const stepCount = document.getElementById('step-count'); // "Step 1 of 6"
const stepTitle = document.getElementById('step-title'); // the step's question
const stepAnswer = document.getElementById('step-answer'); // the one-line answer
const stepTry = document.getElementById('step-try'); // the "Try this" instruction
const stepDetail = document.getElementById('step-detail'); // the "More detail" text
const facts = document.getElementById('facts'); // the little fact chips
const controls = document.getElementById('controls'); // the "Play with it" panel body (not OrbitControls!)
const backButton = document.getElementById('back');
const nextButton = document.getElementById('next');
const infoPanel = document.getElementById('info-panel'); // the explanation panel (for swiping)

let index = 0; // which step we are on (0 = the first one, like a Python list index)
let current = null; // the running step (has update() and stop())

/**
 * showStep(i)
 * Switches to step number i (0-based): stops the old step, fills in the new
 * texts, updates the buttons and slider, flies the camera and starts the step.
 */
function showStep(i) {
  // Keep i inside 0 .. last step, so pressing Back on step 1 can't go to step -1.
  index = Math.max(0, Math.min(steps.length - 1, i));
  // Destructuring: take the `info` object out of the step module.
  const { info } = steps[index];

  if (current) current.stop(); // clean up the old step's 3D objects
  controls.innerHTML = ''; // empty the controls panel (removes the old sliders/buttons)

  // Replay the fade-in animation on both panels' contents.
  for (const el of [document.getElementById('info-body'), controls]) {
    el.classList.remove('step-change'); // take the animation class off...
    void el.offsetWidth; // forces the browser to notice, so the animation restarts
    // (Reading offsetWidth makes the browser recalculate layout right now;
    //  `void` just means "we don't need the value".)
    el.classList.add('step-change'); // ...and put it back on, so the CSS animation plays again
  }

  // Fill in the texts. textContent is safe plain text (no HTML is run).
  stepCount.textContent = `Step ${index + 1} of ${steps.length}`;
  stepTitle.textContent = info.title;
  stepAnswer.textContent = info.answer;
  stepTry.textContent = info.tryThis;
  stepDetail.textContent = info.detail;
  // info.facts is a list of [label, value] pairs. .map turns each pair into an
  // HTML string (destructuring the pair into label and value), and .join('')
  // glues them into one string with nothing between them.
  facts.innerHTML = info.facts.map(([label, value]) => `<span class="fact">${label}: <strong>${value}</strong></span>`).join('');

  // Keep the step slider in sync with the current step.
  stepSlider.max = steps.length - 1;
  stepSlider.value = index;
  paintSlider(stepSlider); // recolour its track up to the knob
  backButton.disabled = index === 0; // greyed out on the first step
  // On the last step, the Next button becomes Finish (shows the summary).
  // (condition ? a : b is the "ternary" operator: a if true, otherwise b.)
  nextButton.textContent = index === steps.length - 1 ? 'Finish' : 'Next →';

  // Glide the camera to this step's chosen viewpoint.
  world.flyTo(info.camera.position, info.camera.target);
  // Start the step: it adds its 3D objects and controls and gives back { update, stop }.
  current = steps[index].start(world, controls);
  // Sound: a whoosh, and this step's own background tune.
  sfx.whoosh();
  playMusicFor(index);
}

// ----- Ways to change step -----
// Back button: go one step back.
backButton.addEventListener('click', () => showStep(index - 1));
// Next button: on the last step show the summary, otherwise go one step forward.
nextButton.addEventListener('click', () => (index === steps.length - 1 ? showSummary() : showStep(index + 1)));

// Sound effects for every button, switch and slider on the page (including the
// ones the steps build), caught in one place instead of in every file.
document.addEventListener('click', (e) => {
  if (e.target.closest('button, summary, input[type=checkbox]')) sfx.click();
});
document.addEventListener('input', (e) => {
  if (e.target.type === 'range') sfx.tick();
});

// The 🔊 button in the top bar mutes everything.
const muteButton = document.getElementById('mute');
muteButton.addEventListener('click', () => {
  const muted = toggleMute();
  muteButton.textContent = muted ? '🔇' : '🔊';
  muteButton.setAttribute('aria-label', muted ? 'Turn sound on' : 'Mute');
});
// Step slider: jump straight to the step under the knob (value is a string, so convert it).
stepSlider.addEventListener('input', () => showStep(Number(stepSlider.value)));

// Keyboard: arrows change step, H hides/shows the panels.
// (Not while typing or using a slider, which use these keys themselves.)
// 'keydown' fires when a key is pressed; e.key is its name, e.g. 'ArrowRight' or 'h'.
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return; // e.target = the element that had focus
  if (e.key === 'ArrowRight') showStep(index + 1);
  if (e.key === 'ArrowLeft') showStep(index - 1);
  if (e.key === 'h' || e.key === 'H') {
    // Adding/removing this class on <body> lets style.css hide all panels at once.
    document.body.classList.toggle('panels-hidden');
    fitView(); // the free space changed, so re-fit the 3D picture
  }
});

// Swipe left/right on the explanation panel (phones only: on bigger
// screens, pulling the glass moves it instead).
let swipeStartX = null; // where the finger went down, or null if no swipe is in progress
infoPanel.addEventListener('pointerdown', (e) => {
  // Only on small screens, and not when pressing a button (so buttons still work).
  if (window.innerWidth <= 860 && !e.target.closest('button')) swipeStartX = e.clientX;
});
infoPanel.addEventListener('pointerup', (e) => {
  if (swipeStartX === null) return; // no swipe started
  const dx = e.clientX - swipeStartX; // how far the finger travelled sideways (pixels)
  if (dx < -60) showStep(index + 1); // swiped left by more than 60px: next step
  if (dx > 60) showStep(index - 1); // swiped right: previous step
  swipeStartX = null; // reset for the next swipe
});

// ----- Movable liquid glass -----
// The panels, the top bar, the hint and the welcome card can all be dragged.
// The two side panels (info and controls) have the class "floating".
const panels = document.querySelectorAll('.floating');
// querySelectorAll returns a list; .forEach calls makeGlassDraggable(el) on each element.
document.querySelectorAll('.floating, .topbar, .hint, .welcome-card').forEach(makeGlassDraggable);

// Panels can also shrink to a small pill.
panels.forEach((panel) => {
  const button = panel.querySelector('.collapse-btn'); // the little – / + button in the panel
  button.addEventListener('click', () => {
    // toggle adds the class if missing, removes it if present, and returns true if now added.
    const collapsed = panel.classList.toggle('collapsed');
    button.textContent = collapsed ? '+' : '–'; // + to open again, – to shrink
    // Accessibility: tell screen readers whether the panel is open and what the button does.
    button.setAttribute('aria-expanded', !collapsed);
    button.setAttribute('aria-label', collapsed ? 'Open this panel' : 'Shrink this panel');
    fitView(); // more free space now, so re-fit the 3D picture
  });
});
// Wait for the glass to finish wobbling back into shape, then re-fit the 3D view.
// 'panelmoved' is our own event fired by drag.js; it "bubbles" up to document.
document.addEventListener('panelmoved', () => setTimeout(fitView, 520));
// The browser window changed size: the panels moved, so re-fit.
window.addEventListener('resize', fitView);

// ----- Fit the 3D view into the space the panels leave free -----
// Look at where the open panels are, find the free gap between them,
// then zoom the camera out and slide the picture so the scene sits in that gap.
const DESIGN_GAP = 640; // the steps' cameras were set up for a gap about this wide

/**
 * fitView()
 * Measures the free space between the left and right panels and tells the
 * world (scene.js setFrame) how much to zoom out and how far to slide sideways.
 */
function fitView() {
  const width = window.innerWidth; // width of the browser window in pixels
  if (width <= 860 || document.body.classList.contains('panels-hidden')) {
    world.setFrame(1, 0); // phones stack panels below the 3D, so no fitting needed
    return;
  }
  // Start by assuming the whole window is free, then shrink it panel by panel.
  let left = 0; // left edge of the free gap
  let right = width; // right edge of the free gap
  for (const panel of panels) {
    if (panel.classList.contains('collapsed')) continue; // a shrunk panel barely covers anything
    // getBoundingClientRect gives the panel's on-screen box (left, right, top, ...) in pixels,
    // including any drag offset, so it works wherever the visitor moved it.
    const box = panel.getBoundingClientRect();
    const middle = (box.left + box.right) / 2; // the panel's centre
    // A panel on the left half pushes the gap's left edge right;
    // a panel on the right half pushes the gap's right edge left.
    if (middle < width / 2) left = Math.max(left, box.right);
    else right = Math.min(right, box.left);
  }
  const gap = Math.max(200, right - left); // free width, never treated as less than 200px
  // A smaller gap than designed means zoom out more: e.g. 640 / 400 = 1.6.
  // Kept between 1 (never zoom in) and 1.9 (never too far away).
  const zoom = Math.min(1.9, Math.max(1, DESIGN_GAP / gap));
  // How far the gap's centre is from the window's centre (pixels, + = to the right).
  const shift = (left + right) / 2 - width / 2;
  world.setFrame(zoom, shift);
}

// ----- Welcome screen -----
const welcome = document.getElementById('welcome');
document.getElementById('start').addEventListener('click', () => {
  welcome.classList.add('gone'); // style.css fades it out
  startAudio(); // browsers only allow sound after a click
  playMusicFor(index);
  sfx.start();
  setTimeout(() => welcome.remove(), 500); // after the 0.5 s fade, delete it from the page
});

// ----- Summary: Bluetooth in six lines (after the last step) -----
const summary = document.getElementById('summary');
function showSummary() {
  sfx.finish();
  summary.hidden = false; // un-hide it (it still has the 'gone' class, so it's invisible)
  // Wait one frame so the browser draws it first, then remove 'gone' so the fade-in plays.
  requestAnimationFrame(() => summary.classList.remove('gone'));
}
function hideSummary() {
  summary.classList.add('gone'); // start the fade-out
  // After the 0.4 s fade, hide it completely so it can't be clicked.
  setTimeout(() => (summary.hidden = true), 400);
}
// "Start again" button on the summary: close it and go back to step 1.
document.getElementById('summary-again').addEventListener('click', () => {
  hideSummary();
  showStep(0);
});
// Close (×) button on the summary.
document.getElementById('summary-close').addEventListener('click', hideSummary);

// ----- The animation loop: runs about 60 times a second -----
// performance.now() = a very precise clock in milliseconds since the page opened.
let last = performance.now();
/**
 * frame(now)
 * Called by the browser before each screen refresh. `now` is the time in ms.
 * Works out dt, lets the current step animate, then lets the world redraw.
 */
function frame(now) {
  // Divide by 1000 to turn ms into seconds. Capped at 0.05 s so that if the tab
  // was hidden for a while, things don't jump a huge distance in one frame.
  const dt = Math.min(0.05, (now - last) / 1000); // seconds since last frame (capped)
  last = now;
  current.update(dt); // move the step's own things (waves, packets, ...)
  world.update(dt); // move the camera and draw the picture
  requestAnimationFrame(frame); // ask to be called again next frame: this makes the loop
}

// ----- Start everything -----
fitView(); // fit the 3D view around the panels' starting positions
showStep(0); // show the first step
requestAnimationFrame(frame); // kick off the animation loop
