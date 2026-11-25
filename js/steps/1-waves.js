/*
 * =====================================================================
 * STEP 1: Bluetooth is invisible light.  (file: js/steps/1-waves.js)
 * =====================================================================
 *
 * WHAT THIS STEP TEACHES
 *   - Bluetooth is a radio wave. Radio waves are the same kind of thing
 *     as light (electromagnetic waves), just with a much longer wave
 *     length (about 12.5 cm at 2.4 GHz), so our eyes can't see them.
 *   - The waves spread out in every direction like a growing bubble.
 *     The same energy has to cover a bigger and bigger surface, so the
 *     signal gets weaker the further you go ("path loss").
 *   - Walls soak up part of the signal.
 *   - Signal strength is measured in dBm (decibels relative to 1 milliwatt).
 *     Decibels are a LOG scale: every +10 dB means 10x more power,
 *     every -10 dB means 10x less. 0 dBm = 1 mW, -10 dBm = 0.1 mW,
 *     -90 dBm = 0.000000001 mW. A log scale lets us write those tiny
 *     numbers as friendly numbers like -60 or -90.
 *
 * HOW THE SCENE IS BUILT (Three.js, the 3D library)
 *   - Everything for this step goes into one THREE.Group called `group`.
 *     A Group is an invisible "box" that holds other 3D objects, so we can
 *     add/remove/delete the whole step in one go.
 *   - A phone in the middle (0,0,0), headphones you can drag, and a glass
 *     wall you can slide left/right (only shown when the toggle is on).
 *   - 9 "waves": each is a see-through half-sphere (dome) plus a circle of
 *     dots on the floor. Every frame we make them bigger and fainter, then
 *     loop back to small. Dots the wall stands in front of (wallBlocks)
 *     are drawn faint, so you can SEE the wall weakening the signal.
 *   - A teal ring on the floor shows the maximum range of the signal.
 *   - A line from phone to headphones, coloured green/orange/red by strength.
 *
 * MAIN STATE (variables that change while you play)
 *   power  - transmit power in dBm (slider, -20 to 10)
 *   speed  - how fast the waves animate (slider)
 *   wallOn - is the wall switched on? (toggle)
 *   range  - how far (metres) the signal reaches with the current power
 *   clock  - a running timer that drives the wave animation
 *
 * HOW update() ANIMATES IT
 *   main.js calls update(dt) about 60 times a second; dt = seconds since
 *   the last frame. We push `clock` forward, and for each wave work out
 *   how far along its life it is (0 -> 1), set its size and fade it out.
 *
 * HOW CONTROLS CONNECT TO THE STATE
 *   The sliders/toggle (built with helpers from ui.js) change the
 *   variables above and then call updateSignal(), which recalculates the
 *   dBm, the signal bars and the readout boxes. Dragging the headphones or
 *   the wall (drag.js) also calls updateSignal() on every move.
 *
 * HOW IT TIES TO main.js
 *   main.js imports `info` (text for the explanation panel and the camera
 *   spot) and calls start(world, panel) when you open this step.
 *   start() returns { update, stop }. main.js calls update(dt) every frame,
 *   and stop() when you leave, which removes the drag listeners and frees
 *   the 3D objects' memory.
 * =====================================================================
 */

// STEP 1: Bluetooth is invisible light.
// A phone sends radio waves out in every direction (like ripples, but in 3D).
// Drag the headphones away and watch the signal get weaker. Add a wall to block it.

// Load the whole Three.js library under the name THREE (e.g. THREE.Mesh).
import * as THREE from 'three';
// Ready-made 3D models and helpers from our own models.js file.
import { makePhone, makeHeadphones, makeFloor, makeLabel, glassMaterial, disposeGroup } from '../models.js';
// Lets the user drag a 3D object across the floor with the mouse/finger.
import { makeObjectDraggable } from '../drag.js';
// Helpers that build the sliders, on/off switches and number boxes in the side panel.
import { addSlider, addToggle, addReadouts } from '../ui.js';
// Stops the background music when the headphones are out of reach.
import { setMusicConnected } from '../sound.js';

// `info` is read by main.js: the words shown in the explanation panel,
// plus where the camera should fly to for this step.
export const info = {
  title: 'How does music get through the air?', // an everyday question
  answer: 'Radio waves: light your eyes can’t see.', // the one-line answer
  // A small challenge for the visitor.
  tryThis: 'Drag the headphones away.',
  detail: 'Waves spread out and fade, so Bluetooth reaches about 10 m. Walls soak some up.', // shown under 'More detail'
  // Quick fact cards: [name, value].
  // 2.4 GHz = 2.4 billion waves per second. Wave length = speed / frequency
  // = 300,000,000 m/s / 2,400,000,000 per s = 0.125 m = 12.5 cm.
  facts: [
    ['Frequency', '2.4 GHz'],
    ['Wave length', '≈ 12.5 cm'],
    ['Speed', '300,000 km/s'],
  ],
  // Camera position [x, y, z] (up high and back) and the point it looks at.
  camera: { position: [0, 15, 24], target: [0, 0, 2] },
};

// A simple, realistic model of how signal strength fades (in dBm: bigger = stronger).
// This is the "log-distance path loss" model that engineers really use.
const LOSS_IN_FIRST_METRE = 40; // dB lost in the first metre at 2.4 GHz
const CLUTTER = 4; // how fast it fades: 2 = empty space, 4 = a busy home
const WALL_LOSS = 12; // dB soaked up by one wall
const WEAKEST_USABLE = -90; // below this, headphones can't hear the phone

/*
 * signalStrength(power, distance, throughWall)
 *   Returns how strong the signal is (in dBm) at the headphones.
 *
 *   received = power - 40 - 10 * CLUTTER * log10(distance) - wall
 *
 *   Why log10? In open space the power spreads over a sphere, so it drops
 *   like 1 / distance^2 (double the distance = a quarter of the power).
 *   Converting to decibels means taking 10 * log10(...) of it, and
 *   10 * log10(1 / d^2) = -20 * log10(d). So "2" (empty space) gives
 *   -20*log10(d) and "4" (cluttered home) gives -40*log10(d).
 *   Example with CLUTTER = 4: going from 1 m to 10 m costs 40 dB, i.e. the
 *   signal becomes 10,000x weaker.
 *   It's exported so other steps (or tests) can reuse the same formula.
 */
export function signalStrength(power, distance, throughWall) {
  // Never use a distance smaller than 0.3 m: log10(0) would be -Infinity.
  const d = Math.max(distance, 0.3);
  // Start power, minus first-metre loss, minus distance loss, minus 12 dB if a wall is in the way.
  return power - LOSS_IN_FIRST_METRE - 10 * CLUTTER * Math.log10(d) - (throughWall ? WALL_LOSS : 0);
}

// How far the signal reaches before it becomes too weak (no walls).
// This is the formula above solved backwards for distance:
//   -90 = power - 40 - 40*log10(d)   =>   d = 10 ^ ((power - 40 + 90) / 40)
// e.g. power 0 dBm gives 10^(50/40) ≈ 17.8 m.
function rangeFor(power) {
  return Math.pow(10, (power - LOSS_IN_FIRST_METRE - WEAKEST_USABLE) / (10 * CLUTTER));
}

/*
 * start(world, panel): called by main.js when this step opens.
 *   world - the shared 3D world from scene.js (scene, camera, renderer, controls...)
 *   panel - the HTML element of the "Play with it" panel where controls go
 *   Returns { update(dt), stop() }.
 */
export function start(world, panel) {
  // A Group = an invisible container. Everything in this step goes inside it.
  const group = new THREE.Group();
  // Put our group into the scene, so it gets drawn.
  world.scene.add(group);
  // The round see-through floor with faint rings every 5 m.
  group.add(makeFloor());

  // The phone sits in the middle; the headphones can be dragged.
  const phone = makePhone();
  // A new object starts at position (0, 0, 0): the centre of the floor.
  group.add(phone);
  // A text label that always turns to face the camera.
  const phoneLabel = makeLabel('Phone');
  // position.set(x, y, z): y is "up", so this floats 2.2 units above the phone.
  phoneLabel.position.set(0, 2.2, 0);
  // Adding the label to the phone (not the group) makes it move with the phone.
  phone.add(phoneLabel);

  // The headphones (a Group of meshes built in models.js).
  const headphones = makeHeadphones();
  // Start them 4 m to the right (x) and 5 m towards the camera (z), on the floor (y=0).
  headphones.position.set(4, 0, 5);
  group.add(headphones);
  // A "Drag me" label that rides along with the headphones.
  const headLabel = makeLabel('Drag me ✋');
  headLabel.position.set(0, 1.9, 0);
  headphones.add(headLabel);

  // A glass wall you can slide left and right.
  // The wall is a Group so the box and its label move together.
  const wall = new THREE.Group();
  // A Mesh = a Geometry (the shape) + a Material (how its surface looks).
  // BoxGeometry(0.3, 3, 8) = 0.3 thick, 3 tall, 8 long. Pink glass, 45% opaque.
  const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 8), glassMaterial(0xf6a5c8, 0.45));
  // Boxes are centred on their middle, so lift it by half its height to sit on the floor.
  wallMesh.position.y = 1.5;
  wall.add(wallMesh);
  // Label floating just above the wall.
  const wallLabel = makeLabel('Wall: drag me');
  wallLabel.position.set(0, 3.5, 0);
  wall.add(wallLabel);
  wall.position.x = 2.5; // starts between the phone and the headphones
  group.add(wall);

  // The waves: each one is a faint dome plus a circle of dots on the floor,
  // growing out from the phone.
  // Why dots? Each dot can check on its own "is the wall between me and the
  // phone?" and go faint if it is. That is how the wall visibly weakens waves.
  // 9 waves spaced evenly in time, so a new one starts every 1/9 of a loop.
  const WAVE_COUNT = 9;
  const DOTS_PER_WAVE = 160;
  // A sphere of radius 1, with 48 slices around and 24 from top to bottom.
  // The last 4 numbers cut it: full circle around (0 to 2*PI), but only the
  // top half from the top down (0 to PI/2), giving a dome sitting on the floor.
  const domeShape = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  // We'll keep each wave's pieces in this list to animate them later.
  const waves = [];
  for (let i = 0; i < WAVE_COUNT; i++) {
    // The dome. MeshBasicMaterial = flat colour, not affected by lights.
    //   transparent: true  -> allow see-through (we change .opacity every frame)
    //   side: DoubleSide   -> draw both the outside and inside of the dome
    //   depthWrite: false  -> don't let this see-through layer "hide" things
    //                         behind it; avoids glitchy overlapping bubbles
    const dome = new THREE.Mesh(
      domeShape,
      new THREE.MeshBasicMaterial({ color: 0x8b6cf6, transparent: true, side: THREE.DoubleSide, depthWrite: false })
    );
    // The circle of dots. Every dot stores:
    //   a position: x, y, z            (3 numbers per dot)
    //   a colour:   red, green, blue, and alpha = how solid it is (4 numbers per dot)
    // We start with all zeros / all ones; update() fills in the real values.
    const dots = new THREE.BufferGeometry();
    dots.setAttribute('position', new THREE.Float32BufferAttribute(new Array(DOTS_PER_WAVE * 3).fill(0), 3));
    dots.setAttribute('color', new THREE.Float32BufferAttribute(new Array(DOTS_PER_WAVE * 4).fill(1), 4));
    // THREE.Points draws one small square dot per position.
    // vertexColors: true = use each dot's own colour/alpha from above.
    const ring = new THREE.Points(
      dots,
      new THREE.PointsMaterial({ color: 0x6d4ff0, size: 0.35, vertexColors: true, transparent: true, depthWrite: false })
    );
    // Add both to the scene's group.
    group.add(dome, ring);
    // offset = where in its life this wave starts (0, 1/9, 2/9 ...), so they're spread out.
    waves.push({ dome, ring, offset: i / WAVE_COUNT });
  }

  // A dashed ring showing how far the signal can reach.
  // null for now; it gets made by drawRangeRing().
  let rangeRing = null;
  /*
   * drawRangeRing(radius): (re)builds the teal range ring at a new size.
   * A ring's thickness would get stretched if we just scaled it, so we
   * throw away the old one and make a fresh one each time power changes.
   */
  function drawRangeRing(radius) {
    // Free the old ring's memory (geometry + material) and remove it.
    if (rangeRing) disposeGroup(rangeRing);
    // A ring 0.16 thick centred on the range radius, 70% opaque teal.
    rangeRing = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.08, radius + 0.08, 128),
      new THREE.MeshBasicMaterial({ color: 0x3fbcb0, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
    );
    // Lay it flat on the floor.
    rangeRing.rotation.x = -Math.PI / 2;
    // Just above the waves' rings so it stays visible.
    rangeRing.position.y = 0.03;
    group.add(rangeRing);
  }

  // A line from phone to headphones, coloured by signal strength.
  // BufferGeometry = raw list of points stored in a fast GPU-friendly array.
  // setFromPoints fills it with 2 points (both at 0,0,0 for now; moved later).
  const linkGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  // THREE.Line draws straight lines between those points. Starts green.
  const link = new THREE.Line(linkGeometry, new THREE.LineBasicMaterial({ color: 0x22b07d, transparent: true }));
  group.add(link);

  // ----- Controls -----
  // Starting values: 0 dBm = 1 milliwatt, a typical Bluetooth power.
  let power = 0;
  // Normal wave speed.
  let speed = 1;
  // Wall starts switched off.
  let wallOn = false;
  // Work out the starting range from the starting power.
  let range = rangeFor(power);

  // Slider for transmit power, from -20 dBm (0.01 mW) to 10 dBm (10 mW).
  addSlider(panel, {
    label: 'Transmit power',
    min: -20,
    max: 10,
    value: power,
    // Text shown next to the slider, e.g. "0 dBm (1.0 mW)".
    format: (v) => `${v} dBm (${formatMilliwatts(v)})`,
    note: 'More power = waves reach further (but the battery drains faster).',
    // Runs every time the slider moves.
    onInput: (v) => {
      // Save the new power...
      power = v;
      // ...recalculate how far it reaches...
      range = rangeFor(power);
      // ...redraw the range ring (capped at 22 m, the edge of the floor)...
      drawRangeRing(Math.min(range, 22));
      // ...and refresh the signal numbers.
      updateSignal();
    },
  });

  // Slider for how fast the waves animate (just for looks).
  addSlider(panel, {
    label: 'Wave speed',
    min: 0.2,
    max: 3,
    step: 0.1,
    value: speed,
    // Show one decimal, e.g. "1.0×".
    format: (v) => `${v.toFixed(1)}×`,
    note: 'Slowed down about 10 billion times so you can see it!',
    // Just store the new speed; update() reads it every frame.
    onInput: (v) => (speed = v),
  });

  // On/off switch for the wall.
  addToggle(panel, {
    label: 'Put a wall in the way',
    value: wallOn,
    onChange: (v) => {
      // Remember the choice...
      wallOn = v;
      // ...show or hide the wall (.visible = false means Three.js skips drawing it)...
      wall.visible = v;
      // ...and recalculate the signal (the wall may now block it).
      updateSignal();
    },
  });

  // The grid of live number boxes. `show(key, html, mood)` updates one box.
  const show = addReadouts(panel, [
    { key: 'distance', label: 'Distance' },
    { key: 'signal', label: 'Signal' },
    { key: 'bars', label: 'Bars' },
    { key: 'range', label: 'Range' },
    { key: 'status', label: 'Headphones', wide: true },
  ]);

  // Is the wall between the phone and the spot (x, z) on the floor?
  // Used for the headphones AND for every wave dot.
  // The phone is at (0, 0). The wall is a line at x = wall.position.x
  // (8 long, so it spans 4 either side of its z position).
  function wallBlocks(x, z) {
    // No wall switched on = nothing blocks.
    if (!wallOn) return false;
    // Where the wall is along x.
    const wx = wall.position.x;
    // If the phone (x=0) and the spot are on the same side of the wall, no block.
    if (Math.sign(0 - wx) === Math.sign(x - wx)) return false; // same side
    // t = how far along the phone->spot line we are when we reach the wall (0 to 1).
    const t = wx / x;
    // z * t = the z where the line crosses the wall. Is it within 4 of the wall's centre?
    return Math.abs(z * t - wall.position.z) < 4; // crosses within the wall's width
  }

  /*
   * updateSignal(): recalculates everything that depends on where things are
   * and on the power. Called when a slider/toggle changes or something is dragged.
   */
  function updateSignal() {
    // Distance from the phone at (0,0) to the headphones, on the floor (Pythagoras).
    const distance = Math.hypot(headphones.position.x, headphones.position.z);
    // Is the wall in the way?
    const blocked = wallBlocks(headphones.position.x, headphones.position.z);
    // Signal strength at the headphones, using the path-loss formula.
    const dbm = signalStrength(power, distance, blocked);
    // Turn dBm into 0-4 bars, like a phone's signal icon. (Closer to 0 = stronger.)
    const bars = dbm > -60 ? 4 : dbm > -70 ? 3 : dbm > -80 ? 2 : dbm > WEAKEST_USABLE ? 1 : 0;
    // Any bars at all = still connected.
    const connected = bars > 0;
    // Out of reach: the music stops, just like real headphones.
    setMusicConnected(connected);
    // Pick a colour: green (3-4 bars), yellow (2), orange (1), red (0). Colours are hex like CSS.
    const color = bars >= 3 ? 0x22b07d : bars === 2 ? 0xf5a524 : bars === 1 ? 0xf08c2e : 0xe5484d;

    // Fill in the readout boxes.
    show('distance', `${distance.toFixed(1)} m`);
    show('signal', `${dbm.toFixed(0)} dBm`);
    // Four bar characters; the ones we "have" are solid, the rest faded to 20%.
    show('bars', '▂▄▆█'.split('').map((b, i) => `<span style="opacity:${i < bars ? 1 : 0.2}">${b}</span>`).join(''));
    // Range in metres (capped at 99 so the box doesn't overflow).
    show('range', `${Math.min(range, 99).toFixed(0)} m`);
    // Status message, with a green ('good') or red ('bad') style.
    show(
      'status',
      connected ? `🎵 Connected${blocked ? ' (wall is weakening it)' : ''}` : '🔇 Lost the signal!',
      connected ? 'good' : 'bad'
    );

    // Recolour the glowing ring under the headphones (models.js saved it in userData.glow).
    headphones.userData.glow.material.color.setHex(color);
    // Recolour the link line the same way.
    link.material.color.setHex(color);
    // Hide the line completely if the signal is lost.
    link.visible = connected;
    // The line's 2 points live in its geometry's "position" attribute
    // (a flat array of numbers: x0,y0,z0, x1,y1,z1).
    const pos = link.geometry.attributes.position;
    // Point 0: the phone, at height 1.2.
    pos.setXYZ(0, 0, 1.2, 0);
    // Point 1: the headphones, at height 1.
    pos.setXYZ(1, headphones.position.x, 1, headphones.position.z);
    // Tell Three.js the numbers changed so it re-sends them to the graphics card.
    pos.needsUpdate = true;
  }

  // Dragging
  // Headphones can move anywhere within 20 m; call updateSignal on each move.
  // Each call returns a "stop" function that removes the mouse listeners later.
  const stopDragHeadphones = makeObjectDraggable(world, headphones, { limit: 20, onMove: updateSignal });
  // The wall only slides along x (left/right), within 18 m.
  const stopDragWall = makeObjectDraggable(world, wall, { limit: 18, axis: 'x', onMove: updateSignal });

  // Starting state
  // Hide the wall until the toggle is switched on.
  wall.visible = wallOn;
  // Draw the first range ring.
  drawRangeRing(Math.min(range, 22));
  // Fill in the readouts for the first time.
  updateSignal();

  // ----- Animation -----
  // A timer that keeps counting up; it drives the waves.
  let clock = 0;
  // Hand main.js the two functions it needs.
  return {
    // Called every frame. dt = seconds since the last frame (about 0.016).
    update(dt) {
      // Move the clock forward. 0.15 makes one full wave loop take about 6.7 s at speed 1.
      clock += dt * speed * 0.15;
      // Waves grow up to the signal's range (but no bigger than the floor).
      const maxRadius = Math.min(range, 22);
      // Behind the wall the signal starts 12 dB weaker, so it runs out sooner.
      const rangeBehindWall = Math.min(rangeFor(power - WALL_LOSS), 22);
      // Animate each wave.
      for (const w of waves) {
        // % 1 keeps only the part after the decimal point, so it loops 0 -> 1 forever.
        const progress = (clock + w.offset) % 1; // 0 → 1, then starts again
        // Radius grows from 0.3 m to the max range.
        const r = 0.3 + progress * maxRadius;
        // Waves fade as they spread: the same energy covers a bigger bubble.
        // (1 - progress)^2 starts at 1 and curves down to 0.
        const strength = Math.pow(1 - progress, 2);
        // scale.setScalar(r) stretches x, y and z all by r. The dome has
        // radius 1, so this makes it radius r without new geometry.
        w.dome.scale.setScalar(r);
        // Domes are very faint (max 12%); the dots are stronger (max 80%).
        w.dome.material.opacity = 0.12 * strength;
        w.ring.material.opacity = 0.8 * strength;

        // Put every dot on a circle of radius r, and choose how solid it is.
        const positions = w.ring.geometry.attributes.position;
        const colors = w.ring.geometry.attributes.color;
        for (let j = 0; j < DOTS_PER_WAVE; j++) {
          // Spread the dots evenly around the circle (a full turn = 2 * PI).
          const angle = (j / DOTS_PER_WAVE) * Math.PI * 2;
          const x = Math.cos(angle) * r;
          const z = Math.sin(angle) * r;
          // y = 0.02: just above the floor so it doesn't flicker.
          positions.setXYZ(j, x, 0.02, z);
          // Behind the wall: faint (30%), and gone where the weaker signal runs out.
          let solid = 1;
          if (wallBlocks(x, z)) solid = r < rangeBehindWall ? 0.3 : 0;
          // setW sets the 4th number (alpha) of this dot's colour.
          colors.setW(j, solid);
        }
        // Tell Three.js the numbers changed so it re-sends them to the graphics card.
        positions.needsUpdate = true;
        colors.needsUpdate = true;
      }
      // Headphones gently bob when connected (they're "playing music").
      // children[0] is the headband; a sine wave moves it up and down by 3 cm.
      if (link.visible) headphones.children[0].position.y = 0.95 + Math.sin(performance.now() / 200) * 0.03;
    },
    // Called by main.js when we leave this step.
    stop() {
      // Remove the mouse/touch listeners for dragging.
      stopDragHeadphones();
      stopDragWall();
      // Take the whole group out of the scene and free all geometries/materials
      // (graphics memory isn't cleaned up automatically, so we "dispose" it).
      disposeGroup(group);
    },
  };
}

/*
 * formatMilliwatts(dbm): turns dBm into milliwatts for the slider label.
 *   mW = 10 ^ (dBm / 10). Examples: 0 dBm = 1 mW, 10 dBm = 10 mW,
 *   -10 dBm = 0.1 mW, -20 dBm = 0.01 mW.
 */
function formatMilliwatts(dbm) {
  // Undo the log: power in milliwatts.
  const mw = Math.pow(10, dbm / 10);
  // Small numbers get 2 decimals (0.01 mW), bigger ones get 1 (10.0 mW).
  return mw < 1 ? `${mw.toFixed(2)} mW` : `${mw.toFixed(1)} mW`;
}
