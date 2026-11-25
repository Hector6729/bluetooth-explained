// STEP 4: Pairing — making a shared secret key while a spy listens.
//
// Real Bluetooth uses maths called Diffie–Hellman (on "elliptic curves").
// We show it with the famous PAINT-MIXING version:
//   - mixing paint is easy, but UN-mixing it is practically impossible.
//   - both sides start with the same public colour, add their own secret colour,
//     swap the mixtures, then add their secret again. Both end up with the SAME
//     colour (the key), but the spy, who only saw public things, can't make it.
// Then both screens show a 6-digit number made from the key. If the numbers
// match, nobody is secretly sitting in the middle.
//
// ============================================================================
// BIG PICTURE OF THIS FILE (read this first in the judging interview)
// ============================================================================
// WHAT IT TEACHES
//   1. Why pairing exists: radio is public, anyone nearby can "hear" every
//      message. So two devices must invent a secret key in public.
//   2. Diffie–Hellman (DH) key exchange, shown as paint mixing:
//        Phone key      = Public + PhoneSecret + HeadSecret
//        Headphones key = Public + HeadSecret + PhoneSecret   (same three paints!)
//      The spy only ever sees Public, (Public+PhoneSecret) and
//      (Public+HeadSecret). Mixing those two mixtures gives a colour with TWO
//      helpings of Public in it, so it is the wrong shade. To get it right the
//      spy would need to "un-mix" a secret out of a mixture, which is the hard
//      part. Real Bluetooth (LE Secure Connections) uses Elliptic-Curve DH:
//      "mixing" is multiplying a point on a curve by a secret number, which is
//      easy forwards and practically impossible to undo.
//   3. Man-in-the-middle (MITM): a spy that pretends to be the headphones to
//      the phone AND the phone to the headphones. It ends up with a different
//      key with each side. Both screens then show a 6-digit number made from
//      their key; different keys give different numbers, so the human spots it.
//      That is exactly the "Do these numbers match?" box on a real phone.
//   4. Encryption after pairing: a toy XOR scrambler (real Bluetooth uses AES-128).
//
// HOW THE 3D SCENE IS BUILT
//   - A THREE.Group called `group` holds everything for this step, so we can
//     throw it all away in one go in stop().
//   - Three "characters": phone, headphones (from models.js) and a spy
//     (built here from spheres and cylinders). The spy is draggable.
//   - "Orbs": glass balls coloured like paint. Each orb has a start slot and an
//     end slot (positions above a device) and the stage at which it appears.
//   - Sprite labels (flat pictures of text that always face the camera) show
//     names and the 6-digit codes.
//
// MAIN STATE (plain variables inside start())
//   stage          which of the 7 explanation stages we are on (0..6)
//   publicHue / phoneHue / headHue   paint colours, as hue angles 0..359
//   spyInMiddle    is the man-in-the-middle attack switched on?
//   answer         what the user clicked: 'match', 'nomatch' or null
//   message        the text typed in stage 6
//
// HOW IT ANIMATES
//   update(dt) is called by main.js every frame (dt = seconds since last frame,
//   about 0.016). It slides every orb a
//   little closer to where it should be ("lerp" = smooth glide) and grows or
//   shrinks it. Colours are NOT set in update(); they are set in refresh().
//
// HOW CONTROLS CONNECT
//   Every slider/button/toggle changes one variable, then calls refresh().
//   refresh() recomputes all colours from scratch (colours()), rewrites the
//   text boxes, recolours the orbs and redraws the number labels.
//
// HOW IT TIES TO main.js
//   main.js imports `info` (title, text, camera position) and calls
//   start(world, panel). `world` holds the Three.js scene/camera/renderer,
//   `panel` is the HTML box for controls. start() returns { update, stop }.
// ============================================================================

// Load the whole Three.js library under the name THREE (THREE.Mesh, THREE.Color...).
import * as THREE from 'three';
// Ready-made models and helpers from our own models.js file.
import { makePhone, makeHeadphones, makeFloor, makeLabel, glassMaterial, disposeGroup } from '../models.js';
// Lets the user drag a 3D object across the floor with mouse or finger.
import { makeObjectDraggable } from '../drag.js';
// Helpers that build HTML controls (sliders, switches, readout boxes, buttons, text box).
import { addSlider, addToggle, addReadouts, addButtonRow, addTextInput } from '../ui.js';

// `info` is read by main.js to fill the explanation panel and to fly the camera.
export const info = {
  title: 'Why do I have to pair?', // an everyday question
  answer: 'Pairing makes a shared secret key.', // the one-line answer
  // `tryThis` suggests what to play with first.
  tryThis: 'Press Next stage, then add the spy.',
  detail: 'Like mixing paint: easy to mix, impossible to un-mix. Matching numbers mean no spy.', // shown under 'More detail'
  // Little fact cards: [label, value] pairs.
  facts: [
    ['Key maths', 'Elliptic-curve Diffie–Hellman'],
    ['Number check', '6 digits'],
    ['Scrambling', 'AES-128'],
  ],
  // Where the camera sits (x, y, z) and the point it looks at. y is "up".
  camera: { position: [0, 10, 21], target: [0, 2.2, 0] },
};

// The caption text for each stage, index 0..6. It contains a little HTML (<b>)
// because it is put on the page with innerHTML. The stage slider picks one.
const STAGES = [
  'Ready. The phone and headphones want to pair. The spy can hear everything sent through the air.',
  '<b>Stage 1: Agree on a public colour.</b> The phone sends a paint colour openly. The headphones get it, and so does the spy.',
  '<b>Stage 2: Pick secret colours 🔒.</b> Each side picks its own secret colour and never sends it anywhere.',
  '<b>Stage 3: Mix and swap.</b> Each side mixes the public colour with its secret, then sends the mixture. The spy copies both mixtures.',
  '<b>Stage 4: Add your secret again.</b> Each side adds its own secret to the mixture it received. Both get the SAME colour: the shared key 🔑. The spy can’t un-mix paint, so its best guess is wrong.',
  '<b>Stage 5: Check the numbers.</b> Both screens show a 6-digit number made from the key. Do they match? (Turn on the spy-in-the-middle to see them NOT match.)',
  '<b>Stage 6: Talk in secret.</b> Everything sent now is scrambled with the key. Type a message below and see what the air (and the spy) gets.',
];

// ----- Paint maths: a mixture is "how much of each colour, added together" -----
/*
 * paint(hue, sat, light): make a THREE.Color from a hue angle.
 *   THREE.Color stores a colour as three numbers r, g, b, each from 0 to 1.
 *   setHSL sets it from Hue (which colour on the rainbow wheel, 0..1),
 *   Saturation (how strong, 0 = grey) and Lightness (0 = black, 1 = white).
 *   Our sliders give hue in degrees 0..359, so we divide by 360 to get 0..1.
 *   `sat = 0.85` means "use 0.85 if no value is given" (default parameter).
 */
const paint = (hue, sat = 0.85, light = 0.55) => new THREE.Color().setHSL(hue / 360, sat, light);
/*
 * mix(...colours): average any number of colours, like stirring equal cans of paint.
 *   `...colours` collects all arguments into an array.
 *   We start from black (0,0,0), add each colour's r,g,b with Color.add(),
 *   then multiplyScalar(1 / n) divides every channel by n => the average.
 *   KEY IDEA: averaging doesn't care about order, so mix(P, B, A) and
 *   mix(P, A, B) are exactly the same colour. That's why both devices end up
 *   with the same key even though they added the paints in a different order.
 *   And mixing the spy's two mixtures, mix(mix(P,A), mix(P,B)), equals
 *   (2P + A + B) / 4, which has too much public paint: the wrong colour.
 */
function mix(...colours) {
  // A fresh colour that starts as black, our "empty bucket".
  const result = new THREE.Color(0, 0, 0);
  // Pour each colour in: adds r to r, g to g, b to b.
  for (const c of colours) result.add(c);
  // Divide by how many we poured in to get the average (and return it).
  return result.multiplyScalar(1 / colours.length);
}
// A 6-digit number made from a colour (a tiny "hash").
/*
 * A HASH is a function that turns any input into a short, fixed-size
 * "fingerprint". Same input => always the same output. Tiny change in input
 * => a totally different output. You can't easily go backwards.
 * Real Bluetooth's "numeric comparison" makes its 6 digits with a proper
 * cryptographic function (built on AES-CMAC); ours is a toy that behaves alike.
 */
function sixDigits(colour) {
  // Turn r, g, b (0..1) into whole numbers 0..255 (one byte each) and glue them
  // into one 24-bit number: r is the "hundreds", g the "tens", b the "units",
  // but in base 256 (65536 = 256 * 256). This is the same as the hex code #RRGGBB.
  const n = Math.round(colour.r * 255) * 65536 + Math.round(colour.g * 255) * 256 + Math.round(colour.b * 255);
  // Scramble it: ^ is XOR with a fixed pattern, Math.imul multiplies as 32-bit
  // integers (overflow wraps around, which mixes the bits well), `>>> 0` makes it
  // a positive whole number, % 1000000 keeps the last 6 digits, and padStart
  // adds leading zeros so it is always 6 characters (e.g. "004217").
  return String((Math.imul(n ^ 0x5bd1e995, 2654435761) >>> 0) % 1000000).padStart(6, '0');
}
// Turns a THREE.Color into a CSS colour string like "#ff8800" for the HTML swatches.
const css = (c) => '#' + c.getHexString();

// Toy scrambling: mix each letter with numbers from a key-seeded random list.
/*
 * scramble(text, keyNumber) returns the message as it would travel through
 * the air: hex bytes like "a3 07 5f ...".
 *
 *  - BYTES and BITS: a bit is a 0 or 1. A byte is 8 bits, so 0..255.
 *    TextEncoder turns text into bytes using UTF-8: normal letters are 1 byte,
 *    emoji are 4 bytes.
 *  - HEX: base 16, digits 0-9 then a-f. One byte is always exactly 2 hex digits
 *    (00..ff), which is why programmers like it.
 *  - XOR (^): compares two numbers bit by bit; the result bit is 1 when the
 *    bits are DIFFERENT. Its magic: (x ^ k) ^ k === x. XOR with the same key
 *    twice gives the original back, so the receiver, who knows the key, can
 *    unscramble. Without the key the bytes look random.
 *  - The "key stream": a simple pseudo-random number generator (an LCG:
 *    seed = seed * a + c) started from the key. Same key => same list of random
 *    numbers on both sides. This is a toy; real Bluetooth uses AES-128.
 */
function scramble(text, keyNumber) {
  // Start the random generator from the 6-digit key (or 1 if that isn't a number).
  let seed = Number(keyNumber) || 1;
  // Text => array of bytes (a Uint8Array), using UTF-8.
  const bytes = new TextEncoder().encode(text);
  // Array.from(bytes, fn) runs fn on every byte and collects the results.
  return Array.from(bytes, (b) => {
    // Next random number: multiply and add (32-bit maths), keep it positive.
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    // Take the top 8 bits of the seed (a number 0..255), XOR it with the byte,
    // and write the result as 2 hex digits.
    return (b ^ (seed >>> 24)).toString(16).padStart(2, '0');
  }).join(' '); // put spaces between the bytes
}

/*
 * makeSpy(): builds the spy character out of simple shapes.
 * THREE.js building blocks used here:
 *   - Group: an empty container. Moving the group moves everything inside it.
 *   - Mesh = Geometry (the shape) + Material (the look: colour, shininess).
 *   - SphereGeometry(radius, widthSegments, heightSegments): more segments = rounder.
 *   - CylinderGeometry(topRadius, bottomRadius, height, segments).
 *   - MeshBasicMaterial: flat colour that ignores lights (good for glowing eyes).
 *   - glassMaterial (from models.js): a shiny material that reacts to light.
 *   - .position.y = height above the floor (y is up in Three.js).
 */
function makeSpy() {
  // The container for all the spy's parts.
  const spy = new THREE.Group();
  // The round dark body.
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.6, 32, 16), glassMaterial(0x2a2633));
  body.position.y = 0.95; // lift it up so it sits on the stand
  spy.add(body); // put it inside the spy group
  // Two eyes: side = -1 (left) then +1 (right).
  for (const side of [-1, 1]) {
    // A small white sphere.
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    // x = left/right, y = height, z = forward so it pokes out of the body.
    eye.position.set(side * 0.22, 1.05, 0.52);
    spy.add(eye);
  }
  // The hat brim: a very flat, wide cylinder.
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.06, 32), glassMaterial(0x2a2633));
  hat.position.y = 1.45;
  spy.add(hat);
  // The top of the hat: a short cylinder sitting on the brim.
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 0.4, 32), glassMaterial(0x2a2633));
  top.position.y = 1.66;
  spy.add(top);
  // A white stand like the phone and headphones have.
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.2, 32), glassMaterial(0xffffff));
  stand.position.y = 0.1;
  spy.add(stand);
  // Give the finished spy back to whoever called us.
  return spy;
}

/*
 * start(world, panel): called by main.js when the user arrives at step 4.
 *   world = { scene, camera, renderer, controls, ... } from scene.js
 *   panel = the HTML element where our controls go.
 * Returns { update(dt), stop() }.
 */
export function start(world, panel) {
  // One container for this whole step, added to the 3D scene.
  const group = new THREE.Group();
  world.scene.add(group);
  // The round glassy floor with rings.
  group.add(makeFloor());

  // ----- The three characters -----
  // An object holding the three models, so we can loop over them by name.
  const devices = {
    phone: makePhone(),
    head: makeHeadphones(),
    spy: makeSpy(),
  };
  // Place them: phone on the left (x = -4.5), headphones on the right,
  // spy in front (z = 4 is closer to the camera).
  devices.phone.position.set(-4.5, 0, -1);
  devices.head.position.set(4.5, 0, -1);
  devices.spy.position.set(0, 0, 4);
  // The name shown under each character.
  const names = { phone: 'Phone', head: 'Headphones', spy: '🕵️ Spy (drag me)' };
  // For each key ('phone', 'head', 'spy') ...
  for (const key in devices) {
    // ... add the model to our group ...
    group.add(devices[key]);
    // ... make a Sprite label (text drawn on a canvas, always facing the camera) ...
    const label = makeLabel(names[key], { size: 0.8 });
    // ... put it a bit below and in front of the model ...
    label.position.set(0, -0.4, 1);
    // ... and attach it TO the model, so it moves when the model moves.
    devices[key].add(label);
  }
  // Make the spy draggable on the floor, but no further than 12 units from the
  // centre. It gives back a function that switches dragging off again.
  const stopDrag = makeObjectDraggable(world, devices.spy, { limit: 12 });

  // ----- Settings -----
  let stage = 0; // which stage caption we are on (0..6)
  let publicHue = 50; // yellow
  let phoneHue = 330; // pink
  let headHue = 190; // blue
  const spyHue = 120; // the spy's own secret (green), used in the middle attack
  let spyInMiddle = false; // is the man-in-the-middle attack switched on?
  let answer = null; // 'match' | 'nomatch' | null
  let message = 'Play my song 🎵'; // the message typed in stage 6

  // All the colours, worked out from the settings.
  /*
   * colours(): recomputes every paint colour from the current hues.
   *   P = public, A = phone's secret, B = headphones' secret, S = spy's secret.
   *   mixA, mixB, mixS = public + that secret (the mixtures sent over the air).
   */
  function colours() {
    const P = paint(publicHue, 0.9, 0.6); // public colour, a bit brighter
    const A = paint(phoneHue); // phone's secret
    const B = paint(headHue); // headphones' secret
    const S = paint(spyHue); // spy's secret
    const mixA = mix(P, A); // what the phone sends
    const mixB = mix(P, B); // what the headphones send
    const mixS = mix(P, S); // what the spy sends when it is in the middle
    // Without the spy: phone gets mixB, headphones get mixA.
    // With the spy in the middle: both get the spy's mixture instead.
    // (The `? :` is a short if/else: condition ? valueIfTrue : valueIfFalse.)
    // Normal case: P+B+A and P+A+B are the same three paints => same key.
    // Attack case: phone has P+S+A, headphones have P+S+B => different keys,
    // and the spy knows both, because it knows S and saw mixA and mixB.
    const keyPhone = spyInMiddle ? mix(P, S, A) : mix(P, B, A);
    const keyHead = spyInMiddle ? mix(P, S, B) : mix(P, A, B);
    // The spy's best guess when NOT in the middle: mix the two mixtures it saw.
    // In the middle, the spy really has the key, so we just show the phone's key.
    const spyGuess = spyInMiddle ? keyPhone : mix(mixA, mixB);
    // Return everything as one object (shorthand for { P: P, A: A, ... }).
    return { P, A, B, S, mixA, mixB, mixS, keyPhone, keyHead, spyGuess };
  }

  // ----- Paint orbs -----
  // Each orb starts at one device ("from") and flies to a spot ("to").
  // It shows up when the stage slider reaches "stage". Slots are positions above a device.
  // One shared sphere shape for every orb: geometry can be reused by many meshes,
  // which saves memory.
  const orbShape = new THREE.SphereGeometry(0.32, 32, 16);
  // The list of all orbs; update() loops over it every frame.
  const orbs = [];
  /*
   * orb(key, stageShown, from, to, colourOf, options)
   *   key        a name, just for us humans reading the code
   *   stageShown the stage at which this orb appears
   *   from / to  [device, column] slots (see slotPosition below)
   *   colourOf   a little function that picks this orb's colour from colours()
   *   big        true for the final key orbs (drawn larger, gently pulsing)
   *   lock       true to show a 🔒 above it (a secret that never leaves)
   *   only       'normal' = only without the spy-in-the-middle,
   *              'middle' = only with it, undefined = always
   * The `= {}` at the end means the options object is optional.
   */
  function orb(key, stageShown, from, to, colourOf, { big = false, lock = false, only } = {}) {
    // A new mesh using the shared shape and its own material (so each orb can
    // have its own colour). White for now; refresh() colours it.
    const mesh = new THREE.Mesh(orbShape, glassMaterial(0xffffff));
    // Start almost invisible (scale 0.001); update() grows it when it is shown.
    mesh.scale.setScalar(0.001);
    group.add(mesh);
    if (lock) {
      // A small padlock label floating above the orb.
      const l = makeLabel('🔒', { size: 0.6 });
      l.position.set(0, 0.6, 0);
      // Children are scaled with their parent, so for big orbs we shrink the
      // label to cancel that out and keep the padlock the same size.
      l.scale.multiplyScalar(1 / (big ? 1.7 : 1));
      mesh.add(l);
    }
    // Remember everything about this orb for update() and refresh().
    orbs.push({ key, mesh, stageShown, from, to, colourOf, big, only });
  }
  // slot: [device, column]; column 'key' = the big key spot on top.
  // Stage 1: the public colour appears at the phone and flies to everyone.
  orb('pubPhone', 1, ['phone', 0], ['phone', 0], (c) => c.P);
  orb('pubHead', 1, ['phone', 0], ['head', 0], (c) => c.P);
  orb('pubSpy', 1, ['phone', 0], ['spy', 0], (c) => c.P);
  // Stage 2: each side's secret appears and stays put (it is never sent).
  orb('secPhone', 2, ['phone', 1], ['phone', 1], (c) => c.A, { lock: true });
  orb('secHead', 2, ['head', 1], ['head', 1], (c) => c.B, { lock: true });
  orb('secSpy', 2, ['spy', 1], ['spy', 1], (c) => c.S, { lock: true, only: 'middle' });
  // Stage 3: each side makes its mixture (public + secret).
  orb('mixPhone', 3, ['phone', 2], ['phone', 2], (c) => c.mixA);
  orb('mixHead', 3, ['head', 2], ['head', 2], (c) => c.mixB);
  // Mixtures crossing the air: normally phone ↔ headphones, spy copies them.
  orb('mixAtoHead', 3, ['phone', 2], ['head', 3], (c) => c.mixA, { only: 'normal' });
  orb('mixBtoPhone', 3, ['head', 2], ['phone', 3], (c) => c.mixB, { only: 'normal' });
  // The spy can't stop itself hearing: it always copies both mixtures.
  orb('spyCopyA', 3, ['phone', 2], ['spy', 2], (c) => c.mixA);
  orb('spyCopyB', 3, ['head', 2], ['spy', 3], (c) => c.mixB);
  // Spy in the middle: it blocks the real mixtures and sends its own to both.
  orb('mixStoHead', 3, ['spy', 1], ['head', 3], (c) => c.mixS, { only: 'middle' });
  orb('mixStoPhone', 3, ['spy', 1], ['phone', 3], (c) => c.mixS, { only: 'middle' });
  // The keys
  // Stage 4: each side's final key rises to the big spot on top of it.
  orb('keyPhone', 4, ['phone', 3], ['phone', 'key'], (c) => c.keyPhone, { big: true });
  orb('keyHead', 4, ['head', 3], ['head', 'key'], (c) => c.keyHead, { big: true });
  orb('spyGuess', 4, ['spy', 3], ['spy', 'key'], (c) => c.spyGuess, { big: true });

  /*
   * slotPosition([device, column], out): where in 3D a slot is.
   *   Columns 0..3 are a row of 4 spots at height 2.7 above the device,
   *   0.85 apart and centred ((column - 1.5) gives -1.5, -0.5, 0.5, 1.5).
   *   'key' is one spot higher up at height 4.2.
   *   It writes into `out` (a THREE.Vector3 = x, y, z) instead of making a new
   *   vector, so we don't create garbage every frame. It uses the device's
   *   CURRENT position, so orbs follow the spy when you drag it.
   */
  const slotPosition = ([device, column], out) => {
    const base = devices[device].position;
    if (column === 'key') return out.set(base.x, 4.2, base.z);
    return out.set(base.x + (column - 1.5) * 0.85, 2.7, base.z);
  };

  // Number labels above phone and headphones (stage 5+)
  // We keep them in an array so we can delete them before drawing new ones.
  let codeLabels = [];
  /*
   * drawCodes(c): throws away the old number labels and makes new ones.
   * Green if both numbers are the same, red if they differ.
   */
  function drawCodes(c) {
    // Remove old labels from the scene and free their GPU memory.
    codeLabels.forEach((l) => disposeGroup(l));
    // Do the two keys give the same 6 digits?
    const same = sixDigits(c.keyPhone) === sixDigits(c.keyHead);
    // .map turns ['phone','head'] into an array of two new labels.
    codeLabels = ['phone', 'head'].map((d) => {
      // Pick this device's key and make its 6-digit code.
      const code = sixDigits(d === 'phone' ? c.keyPhone : c.keyHead);
      // Show it as "123 456" (easier to read), in green or red.
      const l = makeLabel(`${code.slice(0, 3)} ${code.slice(3)}`, { size: 1.3, color: same ? '#22b07d' : '#e5484d' });
      // Float it high above that device.
      l.position.set(devices[d].position.x, 5.4, devices[d].position.z);
      group.add(l);
      return l;
    });
  }

  // ----- Controls -----
  // A plain HTML <div> for the stage caption text at the top of the panel.
  const caption = document.createElement('div');
  caption.className = 'caption';
  panel.appendChild(caption);

  // The stage slider. We keep its handle so code can move it (stageSlider.set).
  const stageSlider = addSlider(panel, {
    label: 'Stage',
    min: 0,
    max: STAGES.length - 1,
    value: stage,
    // What is written next to the slider, e.g. "3 of 6".
    format: (v) => `${v} of ${STAGES.length - 1}`,
    onInput: (v) => setStage(v),
  });

  // Back / Next buttons do the same as nudging the slider.
  addButtonRow(panel, [
    { label: 'Back', onClick: () => setStage(stage - 1) },
    { label: 'Next stage', onClick: () => setStage(stage + 1), primary: true },
  ]);

  // Three colour sliders (hue 0..359). Each stores the new hue and calls refresh().
  // hueName turns the number into a word like "blue" for the label.
  addSlider(panel, { label: 'Public colour', min: 0, max: 359, value: publicHue, format: hueName, onInput: (v) => { publicHue = v; refresh(); } });
  addSlider(panel, { label: 'Phone’s secret 🔒', min: 0, max: 359, value: phoneHue, format: hueName, onInput: (v) => { phoneHue = v; refresh(); } });
  addSlider(panel, { label: 'Headphones’ secret 🔒', min: 0, max: 359, value: headHue, format: hueName, onInput: (v) => { headHue = v; refresh(); } });

  // The man-in-the-middle switch.
  addToggle(panel, {
    label: '😈 Spy in the middle (pretends to be both)',
    value: spyInMiddle,
    onChange: (v) => {
      spyInMiddle = v; // remember the new setting
      answer = null; // the old "numbers match?" answer no longer counts
      refresh(); // redraw everything
    },
  });

  // Four readout boxes. `show(key, html, mood)` updates one; mood 'good'/'bad'
  // colours it green/red.
  const show = addReadouts(panel, [
    { key: 'keyPhone', label: 'Phone’s key' },
    { key: 'keyHead', label: 'Headphones’ key' },
    { key: 'spy', label: 'Spy’s key', wide: true },
    { key: 'result', label: 'Pairing', wide: true },
  ]);

  // The "Do these numbers match?" buttons, like on a real phone. We keep the row
  // so refresh() can hide it before stage 5.
  const matchRow = addButtonRow(panel, [
    { label: '✅ Numbers match', onClick: () => { answer = 'match'; refresh(); }, primary: true },
    { label: '❌ They don’t', onClick: () => { answer = 'nomatch'; refresh(); } },
  ]);

  // A box for the stage-6 "send a secret message" part (hidden until then).
  const messageBox = document.createElement('div');
  panel.appendChild(messageBox);
  // A text input; every keystroke stores the text and redraws.
  addTextInput(messageBox, { label: 'Send a message', value: message, onInput: (v) => { message = v; refresh(); } });
  // Three readouts: the scrambled bytes, what the headphones read, what the spy reads.
  const showMessage = addReadouts(messageBox, [
    { key: 'air', label: 'What travels through the air', wide: true },
    { key: 'head', label: 'Headphones read', wide: true },
    { key: 'spy', label: 'Spy reads', wide: true },
  ]);


  /*
   * setStage(s): go to stage s (the slider and Back / Next buttons call it).
   */
  function setStage(s) {
    // Clamp s into 0..6 so Back on stage 0 or Next on stage 6 is harmless.
    stage = Math.max(0, Math.min(STAGES.length - 1, s));
    // Move the slider knob to match (needed when the buttons changed it).
    stageSlider.set(stage);
    // Going back before the number check forgets the old answer.
    if (stage < 5) answer = null;
    refresh();
  }

  /*
   * refresh(): the one function that makes the screen match the state.
   * Called whenever any setting changes. It recomputes colours, updates all
   * text boxes, shows/hides parts of the panel, recolours orbs and redraws labels.
   */
  function refresh() {
    // Fresh colours from the current hues and spy setting.
    const c = colours();
    // Show the caption for the current stage.
    caption.innerHTML = STAGES[stage];

    // Little helper: HTML for a coloured square followed by some text.
    const swatch = (col, text) => `<span class="swatch" style="background:${css(col)}"></span>${text}`;
    // Keys only exist from stage 4 on.
    const ready = stage >= 4;
    // Each key box: colour swatch + its 6-digit code, or a dash if not ready.
    show('keyPhone', ready ? swatch(c.keyPhone, sixDigits(c.keyPhone)) : '–');
    show('keyHead', ready ? swatch(c.keyHead, sixDigits(c.keyHead)) : '–');
    // The spy box: nothing yet / knows both keys (bad) / wrong guess (good).
    if (!ready) show('spy', '–');
    else if (spyInMiddle) show('spy', swatch(c.spyGuess, 'Knows BOTH keys 😈'), 'bad');
    else show('spy', swatch(c.spyGuess, `${sixDigits(c.spyGuess)} — wrong guess!`), 'good');

    // Pairing result
    // The user only "paired" if they clicked "Numbers match".
    const paired = answer === 'match';
    // Four outcomes: safe pair, let the spy in, caught the spy, or wrongly cancelled.
    if (stage < 5) show('result', 'Not finished yet');
    else if (answer === null) show('result', 'Look at the two numbers in 3D, then answer ↓');
    else if (paired && !spyInMiddle) show('result', '🔐 Paired safely!', 'good');
    else if (paired && spyInMiddle) show('result', '😱 You let the spy in! The numbers were different.', 'bad');
    else if (spyInMiddle) show('result', '🛡️ Good catch! Pairing cancelled.', 'good');
    else show('result', 'They did match. Look again!', 'bad');
    // Only show the match buttons from stage 5 (CSS display 'none' hides it).
    matchRow.style.display = stage >= 5 ? 'flex' : 'none';

    // Secret messages (stage 6)
    messageBox.style.display = stage >= 6 ? 'block' : 'none';
    if (stage >= 6) {
      if (!paired) {
        // No key agreed yet, so nothing can be sent secretly.
        showMessage('air', 'Not paired: confirm the numbers first (stage 5).');
        showMessage('head', '–');
        showMessage('spy', '–');
      } else {
        // What a radio listener sees: scrambled hex bytes (|| '–' if the message is empty).
        showMessage('air', `<span class="mono">${scramble(message, sixDigits(c.keyPhone)) || '–'}</span>`);
        // The headphones know the key, so they unscramble it back to the message.
        showMessage('head', message || '–', 'good');
        // A spy in the middle has the key too, so it reads everything.
        if (spyInMiddle) showMessage('spy', `${message} 😈 (it has the key!)`, 'bad');
        // A normal spy only sees nonsense.
        else showMessage('spy', `<span class="mono">${gibberish(message)}</span> 🤷`, 'good');
      }
    }

    // 3D: colours of the orbs and the number labels
    // Each orb asks colourOf(c) for its colour; .copy() writes it into the
    // orb's material colour, and Three.js uses it on the next frame.
    for (const o of orbs) o.mesh.material.color.copy(o.colourOf(c));
    // Draw the number labels from stage 5; otherwise remove any old ones.
    if (stage >= 5) drawCodes(c);
    else {
      codeLabels.forEach((l) => disposeGroup(l));
      codeLabels = [];
    }
  }

  // Draw everything once at the start.
  refresh();

  // ----- Animation: orbs glide to where they should be -----
  // A reusable vector for slot positions (avoids making new objects each frame).
  const target = new THREE.Vector3();
  // Total seconds since the step started; used for the key orbs' gentle pulse.
  let clock = 0;
  // Hand main.js the two functions it needs.
  return {
    /*
     * update(dt): called every animation frame by main.js.
     * dt = seconds since the previous frame.
     */
    update(dt) {
      clock += dt;
      // How far to move this frame (0..1). Using exp() makes the speed the same
      // whatever the frame rate: each second covers the same share of the gap.
      // Moving a fraction of the remaining gap gives a smooth slow-down at the end.
      const ease = 1 - Math.exp(-dt * 3.5);
      for (const o of orbs) {
        // Is this orb allowed in the current mode? No `only` = always allowed.
        // Otherwise: 'middle' orbs need spyInMiddle true, 'normal' ones need false.
        const allowed = !o.only || (o.only === 'middle') === spyInMiddle;
        // Visible if allowed and we've reached its stage.
        const shown = allowed && stage >= o.stageShown;
        // Work out where it should be heading (writes into `target`).
        slotPosition(shown ? o.to : o.from, target);
        if (!shown) o.mesh.position.copy(slotPosition(o.from, target)); // wait at the start
        // LERP = "linear interpolation": move `ease` of the way from where it is
        // towards the target. Repeated each frame, it glides in smoothly.
        else o.mesh.position.lerp(target, ease);
        // Wanted size: hidden = 0.001; normal = 1; big key orbs = 1.7 and they
        // breathe slightly (sin wave between 0.95 and 1.05).
        const size = shown ? (o.big ? 1.7 : 1) * (o.big ? 1 + Math.sin(clock * 3) * 0.05 : 1) : 0.001;
        // Smoothly grow/shrink towards that size (MathUtils.lerp is lerp for plain numbers).
        o.mesh.scale.setScalar(THREE.MathUtils.lerp(o.mesh.scale.x, size, ease));
      }
      // Keep the number labels above their devices
      if (codeLabels.length) {
        codeLabels[0].position.x = devices.phone.position.x;
        codeLabels[1].position.x = devices.head.position.x;
      }
    },
    /*
     * stop(): called by main.js when we leave this step. Clean up everything:
     * stop listening for drags, and "dispose" (free) all geometries, materials
     * and textures. The GPU memory is not freed automatically, so skipping this
     * would leak memory every time you visit the step.
     */
    stop() {
      stopDrag();
      codeLabels.forEach((l) => disposeGroup(l));
      disposeGroup(group);
    },
  };
}

/*
 * hueName(h): turns a hue angle into a colour word. The wheel is split into
 * 12 slices of 30 degrees; Math.round(h / 30) picks the nearest slice and
 * % 12 wraps 360 back round to 0 (red).
 */
function hueName(h) {
  const names = ['red', 'orange', 'yellow', 'lime', 'green', 'teal', 'cyan', 'blue', 'indigo', 'purple', 'pink', 'rose'];
  return names[Math.round(h / 30) % 12];
}

// What a spy without the key sees: random-looking symbols.
/*
 * Each character's code number (charCodeAt) and position i are mixed with
 * a bit of maths and % picks one of the 10 symbols. Just for show: it always
 * gives the same nonsense for the same text.
 */
function gibberish(text) {
  const symbols = '#%&@$*?!~^';
  return Array.from(text, (ch, i) => symbols[(ch.charCodeAt(0) * 7 + i * 13) % symbols.length]).join('');
}
