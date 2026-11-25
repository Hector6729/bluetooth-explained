/*
 * =====================================================================
 * STEP 3: Finding each other (advertising and scanning).
 *         (file: js/steps/3-discovery.js)
 * =====================================================================
 *
 * WHAT THIS STEP TEACHES
 *   - Before two Bluetooth gadgets can connect, the phone must DISCOVER them.
 *   - ADVERTISING: each gadget keeps "shouting" a tiny message (up to 31
 *     bytes: its name and what kind of thing it is). It shouts on 3 special
 *     channels, 37, 38 and 39, one right after another. (These are
 *     Bluetooth Low Energy channel numbers: BLE splits the 2.4 GHz band into
 *     40 lanes of 2 MHz, so the numbers differ from the 79 lanes in step 2.)
 *     Ch 37 = 2402 MHz, Ch 38 = 2426 MHz, Ch 39 = 2480 MHz: spread out and
 *     placed between the busiest Wi-Fi channels (1, 6 and 11).
 *   - The time between shouts is the "advertising interval" (real gadgets:
 *     20 ms to 10 s). Shouting often = found faster but drains the battery.
 *   - SCANNING: the phone listens on ONE of those 3 channels at a time,
 *     moving 37 -> 38 -> 39 -> 37 ... It also only listens for part of each
 *     turn and rests the rest of the time. That fraction is the DUTY CYCLE
 *     (e.g. 60% = listening 60% of the time, sleeping 40%). Less listening
 *     saves battery but misses more shouts.
 *   - A gadget is found only when its shout reaches the phone on the
 *     channel the phone is listening to, while it is listening.
 *   - Far-away gadgets are never heard: we reuse step 1's path-loss formula
 *     (signalStrength) to work out the dBm and the range.
 *
 * HOW THE SCENE IS BUILT (Three.js)
 *   - One THREE.Group holds everything (so stop() can delete it all at once).
 *   - A phone in the middle with a coloured "ear ring" on the floor around it
 *     showing which channel it is listening to (grey when resting).
 *   - 4 draggable gadgets (headphones, watch, speaker, bulb), each with a
 *     name label, a green "found" label and an invisible beam line to the phone.
 *   - Each shout is a coloured ring on the floor that grows outward from the
 *     gadget (purple = 37, teal = 38, pink = 39). When a ring's radius
 *     reaches the phone, we check whether the phone heard it.
 *
 * MAIN STATE
 *   shoutEvery   - seconds between a gadget's shouts (slider)
 *   listenShare  - duty cycle, 0.1 to 1 (slider)
 *   scanning     - is the phone scanning at all? (toggle)
 *   channelIndex - which of the 3 channels the phone is on (0, 1, 2)
 *   channelClock - seconds spent on the current channel
 *   time         - total seconds since the step started
 *   queued       - shouts waiting to be sent (each one slightly later)
 *   travelling   - shout rings currently growing across the floor
 *   heard/missed/allFoundAt/scanStart - numbers for the readouts
 *   g.found      - for each gadget: null, or {at, channel, dbm} once found
 *
 * HOW update() ANIMATES IT
 *   Each frame: move the phone's channel clock (switch channel every 1.2 s),
 *   update its label/ring, count down each gadget's shout timer (queue 3
 *   shouts when it hits 0), release queued shouts as rings, grow every ring,
 *   call arrive() when a ring reaches the phone, delete rings that are done.
 *
 * HOW CONTROLS CONNECT
 *   Sliders set shoutEvery / listenShare, the toggle sets scanning, and the
 *   button calls rescan() which forgets every gadget and restarts the timer.
 *   The "Nearby devices" list is plain HTML rebuilt by updateList().
 *
 * HOW IT TIES TO main.js
 *   main.js shows `info`, calls start(world, panel) when the step opens,
 *   update(dt) every frame and stop() when leaving.
 * =====================================================================
 */

// STEP 3: Finding each other (advertising and scanning).
// Gadgets "shout" short "I'm here!" messages on 3 special channels: 37, 38 and 39.
// The phone listens on ONE of those channels at a time, and only part of the time
// (to save battery). A gadget is found when its shout lands on the channel the
// phone happens to be listening to.

// The Three.js 3D library.
import * as THREE from 'three';
// Ready-made models and helpers from models.js.
import { makePhone, makeHeadphones, makeWatch, makeSpeaker, makeBulb, makeFloor, makeLabel, disposeGroup } from '../models.js';
// Dragging 3D objects on the floor.
import { makeObjectDraggable } from '../drag.js';
// Builders for panel controls.
import { addSlider, addToggle, addReadouts, addButton } from '../ui.js';
// Re-use step 1's path-loss formula so signal strength is the same everywhere.
import { signalStrength } from './1-waves.js';

// Text for the explanation panel + camera spot (read by main.js).
export const info = {
  title: 'How does my phone find my headphones?', // an everyday question
  answer: 'They keep shouting “I’m here!”', // the one-line answer
  // The visitor's challenge.
  tryThis: 'Drag a gadget away, then scan again.',
  detail: 'Gadgets shout their name on channels 37, 38 and 39. Your phone listens.', // shown under 'More detail'
  // Fact cards: [name, value]. 20 ms - 10 s is the real advertising interval range.
  facts: [
    ['Shout channels', '37, 38 and 39'],
    ['Shout every', '20 ms – 10 s'],
    ['Message size', 'up to 31 bytes'],
  ],
  // Camera spot [x, y, z] and the point it looks at.
  camera: { position: [0, 17, 21], target: [0, 0, 0] },
};

// The 3 advertising channels, their frequencies, and a colour for each.
// `color` is a number for Three.js; `css` is the same colour as text for HTML.
const AD_CHANNELS = [
  { number: 37, mhz: 2402, color: 0x8b6cf6, css: '#8b6cf6' },
  { number: 38, mhz: 2426, color: 0x3fbcb0, css: '#3fbcb0' },
  { number: 39, mhz: 2480, color: 0xf27bb0, css: '#f27bb0' },
];

const WAVE_SPEED = 7; // metres per second, hugely slowed down
const LISTEN_TIME_PER_CHANNEL = 1.2; // seconds the phone spends on each channel
// Rings never grow past 30 m.
const MAX_WAVE_RADIUS = 30;

/*
 * start(world, panel): called by main.js when this step opens.
 *   Builds the scene and controls and returns { update(dt), stop() }.
 */
export function start(world, panel) {
  // Group = invisible container for everything in this step.
  const group = new THREE.Group();
  // Put it in the scene so it's drawn.
  world.scene.add(group);
  // The round floor with rings every 5 m.
  group.add(makeFloor());

  // ----- The phone in the middle, with a ring showing which channel it hears -----
  // The phone sits at (0, 0, 0).
  const phone = makePhone();
  group.add(phone);

  // The "ear ring": a flat ring around the phone (inner radius 1.1, outer 1.4).
  // Mesh = Geometry (shape) + Material (look). No colour yet: update() sets it.
  // transparent: true lets us change its opacity; DoubleSide draws both faces.
  const earRing = new THREE.Mesh(
    new THREE.RingGeometry(1.1, 1.4, 64),
    new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide })
  );
  // Rings are made standing up; rotate -90 degrees around x to lay it flat.
  earRing.rotation.x = -Math.PI / 2;
  // Lift it 3 cm so it doesn't flicker against the floor.
  earRing.position.y = 0.03;
  group.add(earRing);

  // One label per state; we just show the right one.
  // Labels 0, 1, 2 = "Listening: Ch 37/38/39", each in its channel's colour.
  const phoneLabels = AD_CHANNELS.map((c) => makeLabel(`👂 Listening: Ch ${c.number}`, { color: c.css }));
  // Label 3 = resting (the "off" part of the duty cycle).
  phoneLabels.push(makeLabel('💤 Resting (saving battery)', { color: '#5d5970' }));
  // Label 4 = scanning switched off.
  phoneLabels.push(makeLabel('📵 Not scanning', { color: '#5d5970' }));
  // All 5 labels sit in the same spot above the phone; update() shows only one.
  for (const label of phoneLabels) {
    label.position.set(0, 2.4, 0);
    group.add(label);
  }

  // ----- The gadgets around the room (all draggable) -----
  // Each gadget: its name, an emoji for the list, its 3D model and start position [x, y, z].
  const gadgets = [
    { name: 'Headphones', icon: '🎧', model: makeHeadphones(), at: [5, 0, 4] },
    { name: 'Smartwatch', icon: '⌚', model: makeWatch(), at: [-6, 0, 3] },
    { name: 'Speaker', icon: '🔊', model: makeSpeaker(), at: [7, 0, -5] },
    { name: 'Smart bulb', icon: '💡', model: makeBulb(), at: [-4, 0, -7] },
  ];

  // The "stop dragging" functions, one per gadget, called in stop().
  const stopDrags = [];
  // Set up each gadget.
  for (const g of gadgets) {
    // ...g.at spreads [x, y, z] into set(x, y, z).
    g.model.position.set(...g.at);
    group.add(g.model);
    // Plain name label (shown until found).
    g.label = makeLabel(g.name, { size: 0.8 });
    // Green "✓ name" label (shown once found).
    g.foundLabel = makeLabel(`✓ ${g.name}`, { size: 0.8, color: '#22b07d' });
    // Put both labels above the gadget, attached to it so they move when dragged.
    for (const l of [g.label, g.foundLabel]) {
      l.position.set(0, 1.9, 0);
      g.model.add(l);
    }
    // A beam to the phone that flashes when a shout is heard
    // BufferGeometry with 2 points (moved in arrive()), starts invisible (opacity 0).
    g.beam = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ transparent: true, opacity: 0 })
    );
    group.add(g.beam);
    // Random start (0-2 s) so the gadgets don't all shout at the same moment.
    g.timer = Math.random() * 2; // when it will shout next
    // Make it draggable within 20 m, and keep its "stop" function.
    stopDrags.push(makeObjectDraggable(world, g.model, { limit: 20 }));
  }

  // Shouts waiting to go out, and shout-waves travelling across the floor
  const queued = [];
  const travelling = [];
  // One shared thin ring shape of radius 1; each shout ring scales it up.
  const ringShape = new THREE.RingGeometry(0.94, 1, 96);

  // ----- Settings and state -----
  let shoutEvery = 1.5; // seconds between shouts (slow-mo)
  let listenShare = 0.6; // how much of the time the phone actually listens
  // Phone starts scanning.
  let scanning = true;
  // Which advertising channel the phone is on: 0 = Ch 37, 1 = Ch 38, 2 = Ch 39.
  let channelIndex = 0;
  // Seconds spent on the current channel (0 up to 1.2).
  let channelClock = 0;
  // Total time since the step started.
  let time = 0;
  // When the current scan started (so we can say "found after X s").
  let scanStart = 0;
  // Counters of shouts heard and missed.
  let heard = 0;
  let missed = 0;
  // Time when every in-range gadget had been found (null = not yet).
  let allFoundAt = null;

  // ----- Controls -----
  // Slider: advertising interval. shoutSlider is kept in case code wants to .set() it.
  const shoutSlider = addSlider(panel, {
    label: 'Gadgets shout every',
    min: 0.3,
    max: 4,
    step: 0.1,
    value: shoutEvery,
    format: (v) => `${v.toFixed(1)} s (slow-mo)`,
    note: 'Faster shouting = found sooner, but a flatter battery.',
    onInput: (v) => {
      // Store it (the gadgets' timers use it)...
      shoutEvery = v;
      // ...and update the "battery use" box.
      updateReadouts();
    },
  });

  // Slider: the phone's duty cycle, shown as a percentage (10% - 100%).
  addSlider(panel, {
    label: 'Phone listens',
    min: 10,
    max: 100,
    step: 5,
    // Slider works in percent, our variable in 0-1, so multiply by 100.
    value: listenShare * 100,
    format: (v) => `${v}% of the time`,
    note: 'Listening all the time finds things faster but uses more power.',
    // Divide by 100 to get back to 0-1.
    onInput: (v) => (listenShare = v / 100),
  });

  // Switch: scanning on/off.
  addToggle(panel, {
    label: '📡 Phone is scanning',
    value: scanning,
    onChange: (v) => {
      scanning = v;
      // Turning it back on starts a fresh scan.
      if (v) rescan();
    },
  });

  // Live number boxes. show(key, html, mood) updates one box.
  const show = addReadouts(panel, [
    { key: 'channel', label: 'Phone hears', wide: true },
    { key: 'heard', label: 'Shouts heard' },
    { key: 'missed', label: 'Shouts missed' },
    { key: 'time', label: 'Found all in' },
    { key: 'battery', label: 'Gadget battery use' },
  ]);

  // A hand-made "Nearby devices" box, like the Bluetooth menu on a phone.
  const listBox = document.createElement('div');
  // Same style as the other controls.
  listBox.className = 'control';
  // A title and an empty .found-list area that updateList() fills.
  listBox.innerHTML = '<div class="control-label"><span>Nearby devices (like your phone’s Bluetooth menu)</span></div><div class="found-list"></div>';
  panel.appendChild(listBox);
  // Keep a handle on the empty list area.
  const list = listBox.querySelector('.found-list');

  // Button that forgets everything and starts a new scan.
  addButton(panel, { label: 'Forget all & scan again', onClick: rescan });

  /*
   * rescan(): forget every gadget and start counting again from now.
   */
  function rescan() {
    // null = "not found yet".
    for (const g of gadgets) g.found = null;
    // Reset the counters.
    heard = 0;
    missed = 0;
    // The new scan starts at the current time.
    scanStart = time;
    allFoundAt = null;
    // Redraw the list and number boxes.
    updateList();
    updateReadouts();
  }

  // newName = a gadget found just now (only that one gets the pop-in animation)
  /*
   * updateList(newName): rebuilds the "Nearby devices" HTML list.
   */
  function updateList(newName) {
    // Only found gadgets, ordered by when they were found (earliest first).
    const found = gadgets.filter((g) => g.found).sort((a, b) => a.found.at - b.found.at);
    // Nothing found yet: show a placeholder message and stop here.
    if (!found.length) {
      list.innerHTML = `<div class="found-empty">${scanning ? 'Searching…' : 'Turn on scanning to search.'}</div>`;
      return;
    }
    // Turn each found gadget into a row of HTML, then glue the rows together.
    list.innerHTML = found
      .map((g) => {
        // Signal bars from its dBm (same thresholds as step 1).
        const bars = g.found.dbm > -60 ? 4 : g.found.dbm > -70 ? 3 : g.found.dbm > -80 ? 2 : 1;
        // Four bar characters, the "missing" ones faded to 20%.
        const barHtml = '▂▄▆█'.split('').map((b, i) => `<span style="opacity:${i < bars ? 1 : 0.2}">${b}</span>`).join('');
        // The row: icon, name, how long it took and on which channel, bars and dBm.
        // The newly found one gets the extra CSS class "new" (pop-in animation).
        return `<div class="found-item${g.name === newName ? ' new' : ''}"><span class="icon">${g.icon}</span>
          <span class="name">${g.name}<small>found after ${(g.found.at - scanStart).toFixed(1)} s on Ch ${g.found.channel}</small></span>
          <span class="bars">${barHtml}<small>${g.found.dbm.toFixed(0)} dBm</small></span></div>`;
      })
      .join('');
  }

  /*
   * updateReadouts(): refreshes the number boxes.
   */
  function updateReadouts() {
    // Is the phone in its "listening" part of the duty cycle right now?
    const listening = isListening();
    // The channel info for the current channel.
    const c = AD_CHANNELS[channelIndex];
    // Show "Not scanning", "Resting", or the channel in its own colour.
    if (!scanning) show('channel', 'Not scanning');
    else if (!listening) show('channel', '💤 Resting');
    else show('channel', `<span style="color:${c.css}">Ch ${c.number} (${(c.mhz / 1000).toFixed(3)} GHz)</span>`);
    // Heard turns green once above 0; missed turns red.
    show('heard', heard, heard ? 'good' : '');
    show('missed', missed, missed ? 'bad' : '');
    // Time to find everyone, or "…" while still searching.
    show('time', allFoundAt !== null ? `${(allFoundAt - scanStart).toFixed(1)} s` : '…');
    // Battery cost guess from the advertising interval: [text, mood].
    const cost = shoutEvery < 1 ? ['High', 'bad'] : shoutEvery < 2.5 ? ['Medium', ''] : ['Low', 'good'];
    show('battery', cost[0], cost[1]);
  }

  /*
   * isListening(): the duty cycle. In each 1.2 s turn on a channel, the
   * phone listens for the first (1.2 * listenShare) seconds, then rests.
   * e.g. 60% -> listens 0.72 s, rests 0.48 s.
   */
  function isListening() {
    return scanning && channelClock < LISTEN_TIME_PER_CHANNEL * listenShare;
  }

  // A shout-wave reached the phone. Was the phone listening on that channel?
  function arrive(wave) {
    // Which gadget sent it.
    const g = wave.gadget;
    // Heard only if listening AND on the same channel as the shout.
    if (isListening() && channelIndex === wave.channel) {
      heard++;
      // The channel's info (number, colour).
      const c = AD_CHANNELS[wave.channel];
      // Signal strength at the phone: 0 dBm transmit, this distance, no wall.
      const dbm = signalStrength(0, wave.distance, false);
      // First time we've heard this gadget?
      const isNew = !g.found;
      // Record when, on which channel, and how strong.
      if (isNew) g.found = { at: time, channel: c.number, dbm };
      else g.found.dbm = dbm; // refresh signal strength
      // If this is the first moment that every gadget is either found or out of range, note the time.
      if (allFoundAt === null && gadgets.every((x) => x.found || !inRange(x))) allFoundAt = time;

      // flash a beam in the channel's colour
      // Point 0 = the gadget, point 1 = the phone.
      const p = g.beam.geometry.attributes.position;
      p.setXYZ(0, g.model.position.x, 1, g.model.position.z);
      p.setXYZ(1, 0, 1.2, 0);
      // Tell Three.js the points changed so it re-uploads them to the graphics card.
      p.needsUpdate = true;
      // Colour it like the channel and make it fully visible (update() fades it).
      g.beam.material.color.setHex(c.color);
      g.beam.material.opacity = 1;
      // Redraw the list; animate only the newly found gadget.
      updateList(isNew ? g.name : null);
    } else if (scanning) {
      // Scanning but resting, or on a different channel: the shout was missed.
      missed++;
    }
    updateReadouts();
  }

  /*
   * inRange(g): is the gadget close enough to ever be heard?
   * Same test as step 1: received signal must be above -90 dBm.
   */
  function inRange(g) {
    // Distance from the phone at (0, 0) on the floor.
    const d = Math.hypot(g.model.position.x, g.model.position.z);
    return signalStrength(0, d, false) > -90;
  }

  // Start with an empty list and fresh counters.
  rescan();

  // Hand main.js our per-frame and clean-up functions.
  return {
    // Runs every frame; dt = seconds since the last frame.
    update(dt) {
      // Total time.
      time += dt;

      // The phone moves to the next channel every LISTEN_TIME_PER_CHANNEL seconds.
      // Remember the state before this frame so we only redraw readouts when it changes.
      const wasListening = isListening();
      const oldChannel = channelIndex;
      if (scanning) {
        // Time on this channel grows.
        channelClock += dt;
        // Turn over? Subtract (instead of setting 0) so leftover time isn't lost.
        if (channelClock >= LISTEN_TIME_PER_CHANNEL) {
          channelClock -= LISTEN_TIME_PER_CHANNEL;
          // Next channel; % 3 wraps 2 back to 0 (37 -> 38 -> 39 -> 37...).
          channelIndex = (channelIndex + 1) % 3;
        }
      }
      // Listening or resting now?
      const listening = isListening();
      // Only update the number boxes if something actually changed.
      if (listening !== wasListening || oldChannel !== channelIndex) updateReadouts();

      // Show the right phone label and ring colour
      // 4 = not scanning, 3 = resting, otherwise 0/1/2 = the channel label.
      const which = !scanning ? 4 : !listening ? 3 : channelIndex;
      // Make exactly one label visible.
      phoneLabels.forEach((l, i) => (l.visible = i === which));
      // Ear ring: channel colour while listening, grey while resting.
      earRing.material.color.setHex(listening ? AD_CHANNELS[channelIndex].color : 0xb8b4c8);
      // Strong while listening, faint while resting.
      earRing.material.opacity = listening ? 0.85 : 0.3;
      // Gentle pulse (±5% size) while listening; still otherwise.
      earRing.scale.setScalar(listening ? 1 + Math.sin(time * 8) * 0.05 : 1);

      // Each gadget shouts on 37, then 38, then 39, one right after another.
      // Real gadgets add a tiny random delay so they don't all shout at once.
      for (const g of gadgets) {
        // Count down to the next shout.
        g.timer -= dt;
        if (g.timer <= 0) {
          // Reset the timer: the interval plus up to 0.3 s of random delay.
          g.timer = shoutEvery + Math.random() * 0.3;
          // Queue 3 shouts (channel index 0, 1, 2), each 0.15 s after the last.
          for (let ch = 0; ch < 3; ch++) queued.push({ gadget: g, channel: ch, at: time + ch * 0.15 });
        }
        // Show the name label until found, then the green "✓" label.
        g.label.visible = !g.found;
        // !! turns an object/null into true/false.
        g.foundLabel.visible = !!g.found;
        // Fade the beam out (gone in 0.4 s).
        g.beam.material.opacity = Math.max(0, g.beam.material.opacity - dt * 2.5);
      }

      // Send out queued shouts as expanding rings on the floor
      // Loop backwards so removing items doesn't skip any.
      for (let i = queued.length - 1; i >= 0; i--) {
        const q = queued[i];
        // Not its time yet? Skip it for now.
        if (time < q.at) continue;
        // Remove it from the queue.
        queued.splice(i, 1);
        // A new ring Mesh using the shared shape and its own material (own opacity),
        // coloured for its channel. depthWrite: false stops see-through rings hiding each other.
        const ring = new THREE.Mesh(
          ringShape,
          new THREE.MeshBasicMaterial({
            color: AD_CHANNELS[q.channel].color,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
        );
        // Lay it flat on the floor.
        ring.rotation.x = -Math.PI / 2;
        // Centre it on the gadget; each channel a tiny bit higher so they don't flicker together.
        ring.position.set(q.gadget.model.position.x, 0.04 + q.channel * 0.01, q.gadget.model.position.z);
        group.add(ring);
        // How far this gadget is from the phone (where the ring must reach).
        const distance = Math.hypot(q.gadget.model.position.x, q.gadget.model.position.z);
        // How far a 0 dBm shout can be heard: 10^(50/40) ≈ 17.8 m (see rangeFor in step 1).
        const reach = Math.min(MAX_WAVE_RADIUS, Math.pow(10, 50 / 40)); // same range as step 1 at 0 dBm
        // Start tracking the ring as it grows from 0.3 m.
        travelling.push({ ring, gadget: q.gadget, channel: q.channel, radius: 0.3, distance, reach, arrived: false });
      }

      // Grow the rings; check if they reach the phone
      for (let i = travelling.length - 1; i >= 0; i--) {
        const w = travelling[i];
        // Grow by speed x time.
        w.radius += WAVE_SPEED * dt;
        // The shape has radius 1, so scaling by radius makes it that big.
        w.ring.scale.setScalar(w.radius);
        // Fade out as it grows: 0.9 at the start down to 0 at its reach.
        w.ring.material.opacity = 0.9 * (1 - w.radius / w.reach);
        // First time the ring is big enough to touch the phone (and the phone is in range)?
        if (!w.arrived && w.radius >= w.distance && w.distance <= w.reach) {
          // Only count it once.
          w.arrived = true;
          // Did the phone hear it?
          arrive(w);
        }
        // Reached its maximum size: delete it.
        if (w.radius >= w.reach) {
          // Free its material (the shape is shared, so it's freed later in stop()).
          w.ring.material.dispose();
          // Take it out of the scene.
          w.ring.removeFromParent();
          // Stop tracking it.
          travelling.splice(i, 1);
        }
      }
    },
    // Runs when we leave this step.
    stop() {
      // Remove every gadget's drag listeners.
      stopDrags.forEach((s) => s());
      // Free materials of rings still growing.
      travelling.forEach((w) => w.ring.material.dispose());
      // Remove the whole step from the scene and free its graphics memory.
      disposeGroup(group);
    },
  };
}
