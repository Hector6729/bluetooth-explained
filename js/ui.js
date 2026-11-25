// ui.js: small helpers that build glass sliders, switches and number boxes
// inside the "Play with it" panel. Each step uses these to make its controls.

/*
 * ===========================================================================
 *  ui.js  -  LEGO BRICKS FOR THE CONTROLS PANEL
 * ===========================================================================
 *
 *  WHAT THIS FILE DOES
 *  -------------------
 *  Every step has a "Play with it" panel full of sliders, on/off switches,
 *  live number boxes ("readouts"), text boxes and buttons. Instead of each
 *  step writing that HTML by hand, they call the helper functions here:
 *    addSlider      - a range slider with a label and its current value
 *    addToggle      - an on/off switch
 *    addReadouts    - a grid of live numbers, plus a function to update them
 *    addTextInput   - a single-line text box
 *    addButtonRow   - several buttons side by side
 *    addButton      - one button
 *    paintSlider    - colours a slider's track up to its knob
 *  Each helper creates the HTML elements, wires up the event listeners,
 *  puts them inside `parent`, and (sometimes) returns a small object or
 *  function so the step can change the control from code later.
 *
 *  HOW IT FITS WITH THE OTHER FILES
 *  --------------------------------
 *  - Step files (js/steps/*.js) import these helpers and call them inside
 *    their start(world, panel) function, with `panel` as the parent.
 *  - main.js only imports paintSlider, to colour the big step slider at the top.
 *  - main.js empties the panel (controls.innerHTML = '') when the step
 *    changes, which removes all these controls (and their listeners) at once.
 *  - The looks (glass, colours, sizes) come from the class names, styled in style.css.
 *
 *  KEY IDEAS USED HERE
 *  -------------------
 *  - The DOM (Document Object Model): the browser's tree of objects, one
 *    per HTML tag. JavaScript can create, change and remove them.
 *  - document.createElement('div') makes a new element (not on the page yet);
 *    parent.appendChild(child) puts it inside another element, so it appears.
 *  - el.className = 'a b' sets the CSS classes; el.textContent = 'hi' sets
 *    plain text (safe: no HTML is interpreted); el.innerHTML = '<b>hi</b>'
 *    sets HTML that the browser parses into elements.
 *  - el.querySelector('css selector') finds the first matching element inside el.
 *  - Events: 'input' fires every time a slider/text box value changes,
 *    'click' on a click/tap, 'keydown' when a key is pressed.
 *  - Destructuring in parameters: function f(parent, { label, min }) means
 *    "the 2nd argument is an object; pull out its label and min properties".
 *    Default values like `step = 1` are used when that property is missing.
 *  - Arrow functions: (v) => v is a tiny function that returns its input.
 *  - Template literals: `<span>${label}</span>` inserts label into the string.
 *  - Closures: inner functions (show, flip, ...) remember the variables of
 *    the function that created them, even after it has returned.
 *  - ARIA attributes (role, aria-checked) tell screen readers what a custom
 *    element is, so blind visitors also know it's a switch and whether it's on.
 * ===========================================================================
 */

// Colour the left part of a slider's track up to the knob.
// It works out how far along the knob is (0-100%) and stores it in the CSS
// variable --fill, which style.css uses to paint a gradient on the track.
// "export" makes it importable by main.js and the steps.
export function paintSlider(input) {
  // e.g. value 30 on a 0..60 slider = 50%. (input.value etc. are strings, but
  // subtraction/division automatically turn them into numbers.)
  const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--fill', pct + '%'); // e.g. --fill: 50%
}

// A slider with a label and the current value shown on the right.
/**
 * addSlider(parent, options)
 * parent: the element to put the slider in (the controls panel).
 * options: label (text), min, max, step (default 1), value (starting value),
 *          format (turns the number into display text; default shows it as-is),
 *          note (optional small help text underneath),
 *          onInput (called with the new number whenever the visitor moves it).
 * Returns { set(v) } so the step can move the slider from code.
 */
export function addSlider(parent, { label, min, max, step = 1, value, format = (v) => v, note, onInput }) {
  // The outer box that holds label, slider and note.
  const box = document.createElement('div');
  box.className = 'control';
  // Label row: the name on the left, an empty <span> on the right for the value.
  box.innerHTML = `<div class="control-label"><span>${label}</span><span></span></div>`;
  // Grab that second (last) span so we can write the value into it.
  const valueText = box.querySelector('.control-label span:last-child');

  // The slider itself: an <input type="range">.
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min; // smallest value
  input.max = max; // largest value
  input.step = step; // how much one notch changes the value
  input.value = value; // where the knob starts
  box.appendChild(input);

  // Optional small grey note under the slider (only if the step gave one).
  if (note) {
    const p = document.createElement('div');
    p.className = 'control-note';
    p.textContent = note;
    box.appendChild(p);
  }

  // Update the number on the right and the coloured track.
  function show() {
    // input.value is always a string, so Number(...) converts it before formatting.
    valueText.textContent = format(Number(input.value));
    paintSlider(input);
  }
  // Every time the visitor moves the knob: refresh the display and tell the step.
  input.addEventListener('input', () => {
    show();
    onInput(Number(input.value));
  });
  parent.appendChild(box); // now it appears on the page
  show(); // the step sets its own starting state, so we don't call onInput here

  // Lets the step change the slider from code (e.g. when you drag a 3D object).
  // We return an object with one method, set(v). It does NOT call onInput,
  // to avoid a loop (object moves -> slider moves -> object moves...).
  return {
    set(v) {
      input.value = v;
      valueText.textContent = format(Number(input.value));
      paintSlider(input);
    },
  };
}

// An on/off switch.
/**
 * addToggle(parent, options)
 * options: label (text), value (true = starts on), onChange (called with true/false).
 * Returns { set(v) } so a step can flip it from code.
 */
export function addToggle(parent, { label, value, onChange }) {
  const row = document.createElement('div');
  // Add the class 'on' if it starts switched on (style.css slides the knob right).
  row.className = 'toggle' + (value ? ' on' : '');
  row.setAttribute('role', 'switch'); // accessibility: "this div is a switch"
  row.setAttribute('aria-checked', value); // accessibility: is it on?
  row.tabIndex = 0; // lets keyboard users reach it with the Tab key
  // The label text plus an empty span that CSS draws as the switch graphic.
  row.innerHTML = `<span>${label}</span><span class="switch"></span>`;

  // Make the looks match the current value.
  function paint() {
    // classList.toggle('on', value) adds 'on' if value is true, removes it if false.
    row.classList.toggle('on', value);
    row.setAttribute('aria-checked', value);
  }
  // Switch to the opposite state, repaint, and tell the step.
  function flip() {
    value = !value; // ! means "not": true becomes false and vice versa
    paint();
    onChange(value);
  }
  row.addEventListener('click', flip); // click/tap anywhere on the row flips it
  // Keyboard support: Space or Enter also flips it (like a real switch control).
  row.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault(); // stop Space from scrolling the page
      flip();
    }
  });
  parent.appendChild(row);

  // Lets a step flip the switch from code (also runs onChange).
  return {
    set(v) {
      if (v !== value) flip(); // only flip if it's not already in that state
    },
  };
}

// A grid of live number boxes. Returns a function to update one by name.
/**
 * addReadouts(parent, items)
 * items: an array like [{ key: 'rssi', label: 'Signal', wide: true }, ...].
 * Returns update(key, html, mood):
 *   key  - which box to change
 *   html - what to show (may include HTML like <small>)
 *   mood - optional CSS class such as 'good' or 'bad' to colour it
 */
export function addReadouts(parent, items) {
  const grid = document.createElement('div');
  grid.className = 'readouts';
  const boxes = {}; // a lookup table: key -> the <b> element showing that value
  // for...of loops over the array; { key, label, wide } destructures each item.
  for (const { key, label, wide } of items) {
    const box = document.createElement('div');
    // 'wide' boxes span the full width of the grid.
    box.className = 'readout' + (wide ? ' wide' : '');
    // Small label on top, big bold value underneath (starts as a dash).
    box.innerHTML = `<small>${label}</small><b>–</b>`;
    grid.appendChild(box);
    boxes[key] = box.querySelector('b'); // remember the <b> so we can update it fast
  }
  parent.appendChild(grid);

  // The update function the step will call many times a second.
  return (key, html, mood) => {
    boxes[key].innerHTML = html;
    boxes[key].className = mood || ''; // || '' means "if mood is missing, use no class"
  };
}

// A text box. onInput gets called with the text every time it changes.
/**
 * addTextInput(parent, options)
 * options: label, value (starting text), maxLength (default 40 characters), onInput.
 */
export function addTextInput(parent, { label, value, maxLength = 40, onInput }) {
  const box = document.createElement('div');
  box.className = 'control';
  box.innerHTML = `<div class="control-label"><span>${label}</span></div>`;
  const input = document.createElement('input');
  input.type = 'text'; // a normal one-line text field
  input.className = 'text-input';
  input.value = value; // starting text
  input.maxLength = maxLength; // the browser stops typing beyond this many characters
  // Every keystroke (or paste) fires 'input'; pass the current text to the step.
  input.addEventListener('input', () => onInput(input.value));
  box.appendChild(input);
  parent.appendChild(box);
}

// A row of buttons side by side. Returns the row so a step can show/hide it.
/**
 * addButtonRow(parent, buttons)
 * buttons: an array like [{ label: 'Send', onClick: fn, primary: true }, ...].
 * primary buttons are filled with colour; the others are see-through "ghost" pills.
 */
export function addButtonRow(parent, buttons) {
  const row = document.createElement('div');
  row.className = 'button-row';
  for (const { label, onClick, primary } of buttons) {
    const button = document.createElement('button');
    button.className = 'pill ' + (primary ? 'pill-primary' : 'pill-ghost');
    button.textContent = label;
    button.addEventListener('click', onClick); // run the step's function when clicked
    row.appendChild(button);
  }
  parent.appendChild(row);
  return row;
}

// A plain pill button.
/**
 * addButton(parent, options)
 * options: label (text on the button), onClick (function to run when clicked).
 * Returns the button so a step can change its text or disable it later.
 */
export function addButton(parent, { label, onClick }) {
  const button = document.createElement('button');
  button.className = 'pill pill-ghost';
  button.textContent = label;
  button.addEventListener('click', onClick);
  parent.appendChild(button);
  return button;
}
