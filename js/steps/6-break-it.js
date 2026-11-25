// STEP 6: Break it! (and watch Bluetooth fight back)
// Everything from the earlier steps comes together:
//   - distance, walls and people weaken the signal (step 1)
//   - Wi-Fi and microwaves cause noise on some channels (step 2)
//   - noisy packets get lost (step 5)
// The headphones keep a little "buffer" of music. Lost packets drain it.
// When it runs dry, the music stutters. Bluetooth's defences fill it back up.
//
// ============================================================================
// BIG PICTURE OF THIS FILE (read this first in the judging interview)
// ============================================================================
// WHAT IT TEACHES
//   A small SIMULATION (a game-like model of the real thing) of a Bluetooth
//   music link in a messy room.
//   - SIGNAL STRENGTH in dBm. dBm is a logarithmic scale: every -10 dBm is
//     10 times weaker. 0 dBm = 1 milliwatt, -90 dBm is about a billionth of
//     that, near where Bluetooth gives up. We use Math.log10(distance), so
//     doubling the distance always costs the same number of dB.
//   - INTERFERENCE: Wi-Fi routers and microwaves use the same 2.4 GHz band.
//     Bluetooth has 79 channels; a Wi-Fi router blocks ~20 of them around its
//     own channel, a microwave blasts channels 48..73 while it pulses.
//   - PROBABILITY: every packet rolls dice with Math.random() (a number 0..1).
//     "Math.random() < 0.3" is true 30% of the time.
//   - BUFFER: a waiting area of music the headphones keep in reserve. Packets
//     fill it, playback drains it at a steady rate. If too many packets are
//     lost, it empties and the music STUTTERS (like a video buffering).
//   - DEFENCES: smart hopping (remember noisy channels and skip them for 6 s,
//     like real "adaptive frequency hopping"), resending (up to 3 tries), and
//     more transmit power.
//   - REAL SOUND with the Web Audio API, which only plays while the buffer
//     isn't empty, so you can HEAR the stutter.
//
// HOW THE 3D SCENE IS BUILT
//   `group` holds everything. Phone (fixed), headphones (draggable, with 5
//   equaliser bars), Wi-Fi routers (added/removed, draggable), a microwave,
//   two walls (draggable left/right only), three people. Routers and the
//   microwave carry a see-through dome showing how far their noise reaches.
//   Small orbs fly from phone to headphones: green = arrived, red = lost.
//   A Line joins phone and headphones and changes colour with link quality.
//
// MAIN STATE
//   settings: microwaveOn, wallsOn, crowdOn, smart, resend, power, soundOn
//   state:    buffer (0..45 packets), stuttering, stutters, packetTimer, time,
//             recent (last 30 results), badChannels (channel -> retry time)
//
// HOW update(dt) WORKS (main.js calls it every frame, dt = seconds)
//   1. Send packets at a steady 15 per second; good ones add to the buffer.
//   2. Drain the buffer at playback speed; empty = start stuttering.
//   3. Play a note every 0.2 s if sound is on and we're not stuttering.
//   4. Animate EQ bars, link line, flying orbs, microwave door.
//   5. Refresh the number boxes about 7 times a second.
//
// CONTROLS -> STATE
//   Each toggle/slider sets one setting variable (and shows/hides 3D objects).
//   "Chaos mode" and "Defend!" flip many controls at once using each control's
//   .set() method (which also runs its onChange, so 3D objects follow).
//
// main.js imports `info` and calls start(world, panel) -> { update, stop }.
// ============================================================================

// The Three.js 3D library.
import * as THREE from 'three';
// Our own models and helpers.
import { makePhone, makeHeadphones, makeFloor, makeLabel, glassMaterial, disposeGroup } from '../models.js';
// Drag 3D objects across the floor.
import { makeObjectDraggable } from '../drag.js';
// HTML controls for the side panel.
import { addSlider, addToggle, addReadouts, addButtonRow } from '../ui.js';

// `info` fills the explanation panel and sets the camera (read by main.js).
export const info = {
  title: 'Why does my music sometimes stutter?', // an everyday question
  answer: 'Too many packets got lost.', // the one-line answer
  // What to try first.
  tryThis: 'Press Chaos mode, then Defend.',
  detail: 'A small music backup covers a few lost packets. Lose too many and it stutters.', // shown under 'More detail'
  // Fact cards: [label, value].
  facts: [
    ['Audio packets', '≈ 50 per second'],
    ['Music buffer', 'a fraction of a second'],
    ['Defences', 'hop, resend, boost'],
  ],
  // Camera high up and back, looking at the centre of the room.
  camera: { position: [0, 16, 19], target: [0, 0, 0] },
};

const CHANNELS = 79; // classic Bluetooth hops over 79 channels, 1 MHz wide each
const PACKETS_PER_SECOND = 15; // slowed down so you can see each one
const BUFFER_MAX = 45; // 3 seconds of music
const WIFI_BANDS = [10, 35, 60, 35]; // centre channel of each router (Wi-Fi 1, 6, 11, 6)
const MICROWAVE_BAND = { from: 48, to: 73 }; // the Bluetooth channels a microwave messes up
const INTERFERENCE_REACH = 8; // metres

// ----- Simple models for this step -----
/*
 * makeRouter(): a white box with three thin antennas.
 * Group = container; Mesh = Geometry (shape) + Material (look).
 * BoxGeometry(width, height, depth); CylinderGeometry(top r, bottom r, height, sides).
 */
function makeRouter() {
  const router = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 0.8), glassMaterial(0xffffff));
  box.position.y = 0.35; // lift so it sits above the floor
  router.add(box);
  // Three antennas at x = -0.45, 0 and 0.45, near the back (z = -0.3).
  for (const x of [-0.45, 0, 0.45]) {
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.8, 8), glassMaterial(0x3fbcb0));
    antenna.position.set(x, 0.85, -0.3);
    router.add(antenna);
  }
  return router;
}

/*
 * makeMicrowave(): a box with a pink "door" panel on the front.
 * We save the door in userData (a free spot on every Three.js object for our
 * own data) so update() can flash its colour.
 */
function makeMicrowave() {
  const oven = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1), glassMaterial(0xf4f2f8));
  body.position.y = 0.45;
  oven.add(body);
  // PlaneGeometry = a flat rectangle. MeshBasicMaterial = flat colour, ignores lights.
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.6), new THREE.MeshBasicMaterial({ color: 0xf27bb0 }));
  // Just in front of the body's front face (body is 1 deep, so its face is at z = 0.5).
  door.position.set(-0.2, 0.45, 0.51);
  oven.add(door);
  oven.userData.door = door;
  return oven;
}

/*
 * makePerson(color): a capsule body with a sphere head, slightly see-through.
 * CapsuleGeometry(radius, length, capSegments, radialSegments) = a pill shape.
 */
function makePerson(color) {
  const person = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1, 8, 16), glassMaterial(color, 0.85));
  body.position.y = 0.85;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 12), glassMaterial(color, 0.85));
  head.position.y = 1.85;
  person.add(body, head); // add() can take several objects at once
  return person;
}

// A see-through dome showing how far an interferer's noise reaches.
// raycast = nothing, so you can't accidentally grab the dome instead of the gadget.
/*
 * The extra SphereGeometry numbers draw only part of a sphere:
 *   phi from 0 to 2π = all the way round, theta from 0 to π/2 = only the top half.
 * Opacity 0.06 = almost invisible; depthWrite: false so it doesn't hide things
 * behind it; DoubleSide so you can see it from inside too.
 * RAYCAST OVERRIDE: dragging works by firing a "ray" from the mouse and asking
 * each object "do you hit this ray?" via its raycast() method. Replacing that
 * method with an empty function means the dome never reports a hit, so clicks
 * go through it to the router or microwave inside.
 */
function makeNoiseDome(color) {
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(INTERFERENCE_REACH, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide })
  );
  dome.raycast = () => {};
  return dome;
}

/*
 * start(world, panel): called by main.js when the user arrives at step 6.
 * Builds the room and controls, then returns { update(dt), stop() }.
 */
export function start(world, panel) {
  // One container for everything in this step, plus the floor.
  const group = new THREE.Group();
  world.scene.add(group);
  group.add(makeFloor());

  // The phone stays put on the left.
  const phone = makePhone();
  phone.position.set(-5, 0, 0);
  group.add(phone);

  // The headphones, on the right; the user can drag them.
  const headphones = makeHeadphones();
  headphones.position.set(4, 0, 1);
  group.add(headphones);
  // A Sprite label (always faces the camera) attached to the headphones.
  const headLabel = makeLabel('Drag me ✋');
  headLabel.position.set(0, 1.9, 0);
  headphones.add(headLabel);

  // Equaliser bars above the headphones: they dance while music plays.
  const eqBars = [];
  for (let i = 0; i < 5; i++) {
    // A thin box 1 unit tall; update() changes its scale.y to change its height.
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1, 0.16), new THREE.MeshBasicMaterial({ color: 0x8b6cf6 }));
    // (i - 2) gives -2..2, so the 5 bars are centred above the headphones.
    bar.position.set((i - 2) * 0.24, 2.6, 0);
    headphones.add(bar); // child of the headphones, so it moves with them
    eqBars.push(bar);
  }

  // `stops` collects the "stop dragging" functions so stop() can call them all.
  const stops = [makeObjectDraggable(world, headphones, { limit: 18 })];

  // ----- Trouble makers -----
  const routers = []; // the routers currently in the room
  const routerSpots = [[0, -5], [-2, 5], [7, -4], [-8, -5]]; // [x, z] for router 1..4
  /*
   * addRouter(): put the next router in its spot (max 4).
   */
  function addRouter() {
    if (routers.length >= routerSpots.length) return; // already full
    const r = makeRouter();
    // The spread `...` turns the array [x, 0, z] into three arguments for set().
    r.position.set(...[routerSpots[routers.length][0], 0, routerSpots[routers.length][1]]);
    // Remember which Bluetooth channel this router's Wi-Fi is centred on.
    r.userData.band = WIFI_BANDS[routers.length];
    // Its label shows the matching Wi-Fi channel number (1, 6, 11, 6).
    const label = makeLabel(`📶 Wi-Fi ch ${[1, 6, 11, 6][routers.length]}`, { size: 0.7 });
    label.position.y = 1.8;
    // Attach the label and a teal noise dome to the router.
    r.add(label, makeNoiseDome(0x3fbcb0));
    group.add(r);
    // Each router is draggable; keep its stop function on the router itself.
    r.userData.stopDrag = makeObjectDraggable(world, r, { limit: 18 });
    routers.push(r);
    updateCounts(); // update the button's "(n)" counter
  }
  /*
   * removeRouter(): take the last router away and free its memory.
   */
  function removeRouter() {
    const r = routers.pop(); // remove from the end of the list
    if (!r) return; // the list was empty
    r.userData.stopDrag(); // stop listening for drags on it
    disposeGroup(r); // remove from the scene + free GPU memory
    updateCounts();
  }

  // The microwave, with a label and a pink noise dome, draggable.
  const microwave = makeMicrowave();
  microwave.position.set(1, 0, 4);
  const microwaveLabel = makeLabel('🍿 Microwave', { size: 0.7 });
  microwaveLabel.position.y = 1.5;
  microwave.add(microwaveLabel, makeNoiseDome(0xf27bb0));
  group.add(microwave);
  stops.push(makeObjectDraggable(world, microwave, { limit: 18 }));

  // Two walls, at x = -2 and x = 1.5. .map builds one wall per x and returns them.
  const walls = [-2, 1.5].map((x) => {
    const wall = new THREE.Group();
    // A thin (0.3), tall (3), long (9) pink see-through slab.
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 9), glassMaterial(0xf6a5c8, 0.4));
    mesh.position.y = 1.5; // half its height, so it stands on the floor
    wall.add(mesh);
    wall.position.x = x;
    group.add(wall);
    // axis: 'x' = can only slide left/right.
    stops.push(makeObjectDraggable(world, wall, { limit: 16, axis: 'x' }));
    return wall;
  });

  // Three people in three colours, spread out in a slight zig-zag.
  const crowd = [0xf5c542, 0x8b6cf6, 0x3fbcb0].map((c, i) => {
    const p = makePerson(c);
    // i % 2 is 0, 1, 0 => the middle person stands a bit further forward.
    p.position.set(-3 + i * 2.6, 0, 0.6 + (i % 2) * 0.6);
    group.add(p);
    return p;
  });

  // ----- Packets flying from the phone to the headphones -----
  // One shared sphere shape for all packet orbs (saves memory).
  const orbShape = new THREE.SphereGeometry(0.16, 16, 8);
  const flying = []; // orbs currently in the air
  /*
   * launchOrb(success): send off one green orb. Each orb gets its own material
   * so it can turn red and fade on its own.
   * userData: t = progress 0..1, success = will it arrive?,
   * failAt = where a lost one gives up (random, 30%..80% of the way),
   * fall = falling speed once lost.
   */
  function launchOrb(success) {
    const orb = new THREE.Mesh(orbShape, new THREE.MeshBasicMaterial({ color: 0x22b07d, transparent: true }));
    orb.userData = { t: 0, success, failAt: 0.3 + Math.random() * 0.5, fall: 0 };
    group.add(orb);
    flying.push(orb);
  }

  // The link line between phone and headphones
  // THREE.Line draws a line through points. We make a BufferGeometry from two
  // (0,0,0) points; update() moves them to the phone and headphones every frame.
  const link = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0x22b07d, transparent: true, opacity: 0.6 })
  );
  group.add(link);

  // ----- Settings -----
  let microwaveOn = false; // is the microwave running?
  let wallsOn = false; // are the walls there?
  let crowdOn = false; // are the people there?
  let smart = false; // defence: smart hopping
  let resend = false; // defence: resend lost packets
  let power = 0; // defence: transmit power in dBm (-20..10)
  let soundOn = false; // is the music switched on?

  // ----- State -----
  let buffer = BUFFER_MAX * 0.7; // start 70% full (measured in packets of music)
  let stuttering = false; // is the music currently cutting out?
  let stutters = 0; // how many times it has stuttered
  let packetTimer = 0; // time saved up towards the next packet
  let time = 0; // seconds since the step started
  const recent = []; // last 30 results (true/false)
  const badChannels = new Map(); // channel → time when we'll try it again

  // ----- Signal strength (like step 1, plus walls and people) -----
  /*
   * crossesWall(wall, to): does the straight line from the phone to `to`
   * (the headphones unless we say otherwise, e.g. a flying orb) go through this wall?
   *   1. Math.sign gives -1 / 0 / +1. If phone and headphones are on the SAME
   *      side of the wall's x, the line can't cross it.
   *   2. Otherwise find how far along the line (t, 0..1) it reaches the wall's x,
   *      and the line's z at that point (a + (b - a) * t is a lerp).
   *   3. The wall is 9 long, so it only blocks if that z is within ±4.5.
   */
  function crossesWall(wall, to = headphones.position) {
    const a = phone.position;
    const b = to;
    const wx = wall.position.x;
    if (Math.sign(a.x - wx) === Math.sign(b.x - wx)) return false;
    const t = (wx - a.x) / (b.x - a.x);
    return Math.abs(a.z + (b.z - a.z) * t) < 4.5;
  }

  /*
   * signal(): received signal strength at the headphones, in dBm.
   *   dBm = power - 40 - 30 * log10(distance)
   *   log10(d) = "how many times do I multiply 10 to get d": log10(1) = 0,
   *   log10(10) = 1, log10(100) = 2. So every 10x more distance costs 30 dB.
   *   (In empty space it would be 20 dB per 10x; rooms are lossier.)
   *   Walls and people then subtract their own losses.
   */
  function signal() {
    // Fades a bit more gently than step 1: this is an open-plan room.
    // distanceTo = straight-line distance; at least 0.3 so log10 never sees 0.
    const d = Math.max(0.3, phone.position.distanceTo(headphones.position));
    let dbm = power - 40 - 30 * Math.log10(d);
    if (wallsOn) dbm -= 6 * walls.filter((w) => crossesWall(w)).length; // an indoor wall: about 6 dB
    if (crowdOn) dbm -= 3 * crowd.length; // each person soaks up about 3 dB
    return dbm;
  }

  // Chance that noise ruins a packet on this channel, near the headphones.
  /*
   * noiseOn(ch): a probability 0..0.95 that a packet on channel `ch` is ruined.
   *   near(obj): 0.95 (capped) when the noisy thing is right next to the
   *   headphones, falling to 0 at INTERFERENCE_REACH metres (the dome's edge).
   *   The worst noise source wins (Math.max), we don't add them up.
   */
  function noiseOn(ch) {
    let chance = 0;
    const near = (obj) => Math.max(0, Math.min(0.95, 1.2 - obj.position.distanceTo(headphones.position) / INTERFERENCE_REACH * 1.2));
    for (const r of routers) {
      // A Wi-Fi channel is about 20 MHz wide = 10 Bluetooth channels each side of its centre.
      if (Math.abs(ch - r.userData.band) <= 10) chance = Math.max(chance, near(r));
    }
    // A microwave pulses on and off 50 times a second (we show it slower).
    // time % 0.4 = time within the current 0.4 s cycle; on for the first half.
    const microwavePulse = time % 0.4 < 0.2;
    if (microwaveOn && microwavePulse && ch >= MICROWAVE_BAND.from && ch <= MICROWAVE_BAND.to) {
      chance = Math.max(chance, near(microwave));
    }
    return chance;
  }

  /*
   * pickChannel(): the next hop.
   *   Normal hopping: any of the 79 channels at random.
   *   Smart hopping: list only channels NOT on the "bad until" list (or whose
   *   ban has expired) and pick randomly from those. If all are banned, fall
   *   back to the random one.
   */
  function pickChannel() {
    // Math.random() * 79 gives 0..78.999; Math.floor makes it a whole number 0..78.
    const ch = Math.floor(Math.random() * CHANNELS);
    if (!smart) return ch;
    const good = [];
    // badChannels.get(c) is undefined for never-bad channels; `undefined > time` is false, so they count as good.
    for (let c = 0; c < CHANNELS; c++) if (!(badChannels.get(c) > time)) good.push(c);
    return good.length ? good[Math.floor(Math.random() * good.length)] : ch;
  }

  // Try to deliver one audio packet. With resending, up to 3 tries (each on a new hop).
  /*
   * sendPacket(): returns true if the packet arrives.
   *   Two ways to lose it, each a dice roll:
   *   - too weak: below -82 dBm it starts failing, at -90 dBm it always fails
   *     ((-82 - dbm) / 8 grows from 0 to 1 over those 8 dB; clamped to 0..1).
   *   - noise on the chosen channel (noiseOn).
   */
  function sendPacket() {
    const dbm = signal();
    const weakChance = Math.max(0, Math.min(1, (-82 - dbm) / 8)); // too weak = lost
    const tries = resend ? 3 : 1;
    for (let i = 0; i < tries; i++) {
      const ch = pickChannel(); // every try hops to a new channel
      const noisy = Math.random() < noiseOn(ch);
      if (noisy && smart) badChannels.set(ch, time + 6); // learn: avoid for 6 s
      // Success needs no noise AND passing the weak-signal roll.
      if (!noisy && Math.random() >= weakChance) return true;
    }
    return false; // every try failed
  }

  // ----- Sound: a little tune made with the Web Audio API -----
  /*
   * WEB AUDIO in one paragraph: you build a little "node graph" like plugging
   * guitar pedals together.
   *   AudioContext   the sound engine; it has a clock (currentTime, in seconds)
   *                  and a destination (your speakers).
   *   OscillatorNode makes a pure tone at a frequency (Hz = vibrations/second).
   *   GainNode       a volume knob. gain 1 = unchanged, 0.0001 = almost silent.
   *   Our graph for each note:  oscillator -> note gain -> master gain -> speakers.
   * The ENVELOPE: a note that starts/stops instantly makes a click, so we ramp
   * the volume up in 0.02 s (attack) then fade it down by 0.22 s (decay).
   * Exponential ramps can't reach exactly 0, so we use 0.0001 instead.
   */
  let audio = null; // the AudioContext (made on first use)
  let master = null; // the master volume GainNode
  let noteTimer = 0; // seconds until the next note
  let noteIndex = 0; // which note of the tune is next
  // The tune as frequencies in Hz. 523 = C5, 659 = E5, 784 = G5, 1047 = C6...
  const TUNE = [523, 659, 784, 659, 587, 698, 880, 698, 523, 659, 784, 1047, 988, 784, 659, 587];
  /*
   * playNote(freq): play one short note now.
   */
  function playNote(freq) {
    const t = audio.currentTime; // "now" on the audio clock
    const osc = audio.createOscillator(); // the tone maker
    const gain = audio.createGain(); // this note's own volume knob
    osc.type = 'triangle'; // a soft, flute-like wave shape
    osc.frequency.value = freq; // the pitch
    // Envelope: start silent...
    gain.gain.setValueAtTime(0.0001, t);
    // ...rise to full volume in 0.02 s...
    gain.gain.exponentialRampToValueAtTime(1, t + 0.02);
    // ...and fade away by 0.22 s.
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    // Wire it up: connect() returns the node you connected to, so we can chain.
    osc.connect(gain).connect(master);
    osc.start(t); // start now
    osc.stop(t + 0.25); // and stop after the fade (the browser then frees it)
  }

  // ----- Controls -----
  // The challenge text at the top of the panel.
  const caption = document.createElement('div');
  caption.className = 'caption';
  caption.innerHTML = '<b>Challenge:</b> make the music stutter, then fix it using only Bluetooth’s defences.';
  panel.appendChild(caption);

  // The two big buttons. chaos and defend are defined further down; that's fine
  // because `function` declarations are "hoisted" (usable anywhere in their scope).
  addButtonRow(panel, [
    { label: '😈 Chaos mode', onClick: chaos },
    { label: '🛡️ Defend!', onClick: defend, primary: true },
  ]);

  // The music switch.
  const musicSwitch = addToggle(panel, {
    label: '🔊 Play music',
    value: soundOn,
    onChange: (v) => {
      soundOn = v;
      // Browsers only allow sound after the user clicks something, so we create
      // the AudioContext here (inside a click), once.
      if (v && !audio) {
        audio = new AudioContext();
        master = audio.createGain(); // the master volume
        master.gain.value = 0.12; // quite quiet, so it isn't annoying
        master.connect(audio.destination); // master -> speakers
      }
      // On = resume the audio engine, off = pause it.
      if (audio) (v ? audio.resume() : audio.suspend());
    },
  });

  // Live number boxes; show(key, html, mood) updates one ('good' = green, 'bad' = red).
  const show = addReadouts(panel, [
    { key: 'music', label: 'Music', wide: true },
    { key: 'buffer', label: 'Music buffer', wide: true },
    { key: 'signal', label: 'Signal' },
    { key: 'ok', label: 'Packets OK' },
    { key: 'stutters', label: 'Stutters' },
    { key: 'avoided', label: 'Channels avoided' },
  ]);

  // A small heading for the "trouble" controls.
  const troubleTitle = document.createElement('div');
  troubleTitle.className = 'section-title';
  troubleTitle.textContent = '😈 Make trouble';
  panel.appendChild(troubleTitle);

  // Add/remove router buttons. We keep the row to update the first button's text.
  const routerRow = addButtonRow(panel, [
    { label: '+ Wi-Fi router', onClick: addRouter },
    { label: '− Remove', onClick: removeRouter },
  ]);
  // Each switch stores its setting AND shows/hides the matching 3D objects (.visible).
  const microwaveSwitch = addToggle(panel, { label: '🍿 Microwave on', value: microwaveOn, onChange: (v) => { microwaveOn = v; microwave.visible = v; } });
  const wallsSwitch = addToggle(panel, { label: '🧱 Walls', value: wallsOn, onChange: (v) => { wallsOn = v; walls.forEach((w) => (w.visible = v)); } });
  const crowdSwitch = addToggle(panel, { label: '🧍 A crowd of people', value: crowdOn, onChange: (v) => { crowdOn = v; crowd.forEach((p) => (p.visible = v)); } });

  // A heading for the defence controls.
  const defendTitle = document.createElement('div');
  defendTitle.className = 'section-title';
  defendTitle.textContent = '🛡️ Bluetooth fights back';
  panel.appendChild(defendTitle);

  // Smart hopping switch; turning it off forgets all the learned bad channels.
  const smartSwitch = addToggle(panel, { label: '🧠 Smart hopping (avoid noisy channels)', value: smart, onChange: (v) => { smart = v; if (!v) badChannels.clear(); } });
  // Resend switch.
  const resendSwitch = addToggle(panel, { label: '🔁 Resend lost packets', value: resend, onChange: (v) => (resend = v) });
  // Transmit power slider in dBm: +10 dBm is 10 mW, -20 dBm is 0.01 mW.
  const powerSlider = addSlider(panel, {
    label: '📶 Transmit power',
    min: -20,
    max: 10,
    value: power,
    format: (v) => `${v} dBm`,
    onInput: (v) => (power = v),
  });

  /*
   * chaos(): turn on every problem and switch off every defence.
   * The switches' .set() also runs their onChange, so the 3D objects appear.
   */
  function chaos() {
    while (routers.length < 3) addRouter(); // at least 3 routers
    microwaveSwitch.set(true);
    wallsSwitch.set(true);
    crowdSwitch.set(true);
    smartSwitch.set(false);
    resendSwitch.set(false);
    power = 0;
    powerSlider.set(power); // move the slider knob to match
  }

  /*
   * defend(): switch on all of Bluetooth's defences and max out the power.
   */
  function defend() {
    smartSwitch.set(true);
    resendSwitch.set(true);
    power = 10;
    powerSlider.set(power);
  }

  // Show how many routers there are on the "+ Wi-Fi router" button.
  function updateCounts() {
    routerRow.firstChild.textContent = `+ Wi-Fi router (${routers.length})`;
  }

  // Starting state
  // Make the 3D objects match the starting settings (all off), and add one router.
  microwave.visible = microwaveOn;
  walls.forEach((w) => (w.visible = wallsOn));
  crowd.forEach((p) => (p.visible = crowdOn));
  addRouter();

  // The text boxes are updated a few times a second, not every frame.
  let readoutTimer = 0;
  /*
   * updateReadouts(): rewrite all the number boxes.
   */
  function updateReadouts() {
    const dbm = signal();
    // Share of the last 30 packets that arrived (1 = 100% if we have none yet).
    const okRate = recent.length ? recent.filter(Boolean).length / recent.length : 1;
    // How many channels are still banned right now.
    const avoided = [...badChannels.values()].filter((t) => t > time).length;
    // Buffer as a whole-number percentage.
    const pct = Math.round((buffer / BUFFER_MAX) * 100);

    // Music status: disconnected beats stuttering beats fine.
    if (dbm < -90) show('music', '🔇 Disconnected: too far or too blocked', 'bad');
    else if (stuttering) show('music', '⚠️ Stuttering!', 'bad');
    else show('music', '🎵 Playing smoothly', 'good');
    // Buffer percentage plus a little bar (CSS class "low" turns it red under 25%).
    show('buffer', `${pct}%<div class="meter${pct < 25 ? ' low' : ''}"><i style="width:${pct}%"></i></div>`);
    // toFixed(0) rounds to a whole number for display.
    show('signal', `${dbm.toFixed(0)} dBm`, dbm < -85 ? 'bad' : '');
    // Green above 90%, red below 70%, plain in between.
    show('ok', `${Math.round(okRate * 100)}%`, okRate > 0.9 ? 'good' : okRate < 0.7 ? 'bad' : '');
    show('stutters', stutters, stutters ? 'bad' : '');
    show('avoided', smart ? `${avoided} of 79` : 'off');
  }

  return {
    /*
     * update(dt): called by main.js every frame. dt = seconds since last frame.
     */
    update(dt) {
      time += dt;

      // Send packets at a steady rate; play music from the buffer.
      // packetTimer saves up time; every 1/15 s saved = one packet. The `while`
      // catches up if a frame was slow (e.g. two packets in one long frame).
      packetTimer += dt;
      while (packetTimer >= 1 / PACKETS_PER_SECOND) {
        packetTimer -= 1 / PACKETS_PER_SECOND;
        const ok = sendPacket(); // roll the dice for this packet
        recent.push(ok); // remember the result...
        if (recent.length > 30) recent.shift(); // ...keeping only the last 30
        // Devices send a little faster than the music plays, so a full-ish buffer can refill.
        if (ok) buffer = Math.min(BUFFER_MAX, buffer + 1.25);
        launchOrb(ok); // show it flying
      }
      // Playback eats 15 packets' worth of music per second, never below 0.
      buffer = Math.max(0, buffer - PACKETS_PER_SECOND * dt);
      // Buffer empty: start stuttering and count it once.
      if (!stuttering && buffer <= 0) {
        stuttering = true;
        stutters++;
      }
      if (stuttering && buffer >= 6) stuttering = false; // enough saved up to play again

      // Music notes (only when not stuttering)
      noteTimer -= dt;
      if (noteTimer <= 0) {
        noteTimer = 0.2; // 5 notes per second
        // noteIndex++ uses the current value then adds 1; % TUNE.length loops the tune.
        if (soundOn && audio && !stuttering) playNote(TUNE[noteIndex++ % TUNE.length]);
      }

      // Equaliser bars dance when playing, go flat and red when stuttering
      eqBars.forEach((bar, i) => {
        // abs(sin(...)) bounces 0..1; i * 1.7 makes each bar out of step with the others.
        const h = stuttering ? 0.08 : 0.2 + Math.abs(Math.sin(time * 9 + i * 1.7)) * 0.7;
        bar.scale.y = h; // stretch the 1-tall box to height h
        bar.position.y = 2.3 + h / 2; // keep its bottom at 2.3 so it grows upwards
        bar.material.color.setHex(stuttering ? 0xe5484d : 0x8b6cf6);
      });

      // Link line colour by how many packets get through
      const okRate = recent.length ? recent.filter(Boolean).length / recent.length : 1;
      // Green > 90%, orange > 70%, else red.
      link.material.color.setHex(okRate > 0.9 ? 0x22b07d : okRate > 0.7 ? 0xf5a524 : 0xe5484d);
      // The glowing ring under the headphones copies the same colour.
      headphones.userData.glow.material.color.copy(link.material.color);
      // Move the line's two end points (BufferGeometry position attribute).
      const p = link.geometry.attributes.position;
      p.setXYZ(0, phone.position.x, 1.2, phone.position.z);
      p.setXYZ(1, headphones.position.x, 1, headphones.position.z);
      // Tell Three.js the points changed so it re-sends them to the graphics card.
      p.needsUpdate = true;

      // Move packet orbs; lost ones turn red and drop
      // Loop BACKWARDS so removing an item with splice doesn't skip the next one.
      for (let i = flying.length - 1; i >= 0; i--) {
        const orb = flying[i];
        const u = orb.userData;
        // Walls soak up signal: the orb shrinks a bit for every wall it has gone through.
        const wallsPassed = wallsOn ? walls.filter((w) => crossesWall(w, orb.position)).length : 0;
        orb.scale.setScalar(1 - 0.35 * wallsPassed);
        if (u.success || u.t < u.failAt) {
          // Still flying: progress goes up (a full trip takes ~0.6 s).
          u.t += dt * 1.6;
          // lerpVectors(a, b, t) puts the orb t of the way from phone to headphones.
          orb.position.lerpVectors(phone.position, headphones.position, Math.min(1, u.t));
          // A little arc: sin goes 0 -> 1 -> 0 over the trip.
          orb.position.y = 1.1 + Math.sin(Math.min(1, u.t) * Math.PI) * 0.8;
        } else {
          // Lost: turn red, fall faster and faster (like gravity), and fade out.
          orb.material.color.setHex(0xe5484d);
          u.fall += dt * 6;
          orb.position.y -= u.fall * dt;
          orb.material.opacity -= dt * 1.5;
        }
        // Arrived or faded away: free its material, remove it, drop it from the list.
        // (The shared orbShape is kept; disposeGroup frees it in stop().)
        if (u.t >= 1 || orb.material.opacity <= 0) {
          orb.material.dispose();
          orb.removeFromParent();
          flying.splice(i, 1);
        }
      }

      // Microwave door flashes while it pulses
      microwave.userData.door.material.color.setHex(time % 0.4 < 0.2 ? 0xf27bb0 : 0xf8d3e3);

      // Refresh the text boxes every 0.15 s (rewriting HTML every frame is wasteful).
      readoutTimer -= dt;
      if (readoutTimer <= 0) {
        readoutTimer = 0.15;
        updateReadouts();
      }
    },
    /*
     * stop(): called by main.js when leaving the step. Clean up everything:
     * stop all drag listeners, free the flying orbs' materials, close the
     * audio engine, and dispose (free GPU memory of) the whole group.
     */
    stop() {
      stops.forEach((s) => s());
      routers.forEach((r) => r.userData.stopDrag());
      flying.forEach((o) => o.material.dispose());
      if (audio) audio.close();
      disposeGroup(group);
    },
  };
}
