/*
 * =====================================================================
 * STEP 2: Frequency hopping.  (file: js/steps/2-hopping.js)
 * =====================================================================
 *
 * WHAT THIS STEP TEACHES
 *   - FREQUENCY = how many times per second a wave wiggles, measured in
 *     hertz (Hz). 1 MHz = 1 million per second, 1 GHz = 1 billion.
 *     Bluetooth uses the 2.4 GHz band: 2402 MHz up to 2480 MHz.
 *   - CHANNEL = a narrow slice ("lane") of that band. Classic Bluetooth
 *     cuts the band into 79 channels, each 1 MHz wide:
 *     channel 0 = 2402 MHz, channel 1 = 2403 MHz ... channel 78 = 2480 MHz.
 *   - FREQUENCY HOPPING: instead of staying on one lane, Bluetooth jumps
 *     to a new channel 1,600 times a second. If one lane is noisy, only
 *     the few hops that land there get lost; the rest get through.
 *   - Wi-Fi and microwave ovens make noise in the same 2.4 GHz band.
 *     A Wi-Fi channel is about 20 MHz wide, so it covers ~20 Bluetooth lanes.
 *   - AFH (Adaptive Frequency Hopping, "Smart hopping"): Bluetooth notices
 *     which channels keep losing packets, marks them "bad", and stops
 *     hopping onto them.
 *   - How do phone and headphones land on the SAME channel each time
 *     without talking about it? They both run the same pseudo-random
 *     number generator (PRNG) started from the same "seed" number
 *     (in real Bluetooth this comes from the phone's address and clock).
 *     Same seed in = same list of "random" channels out. We call it the
 *     "hop recipe".
 *
 * HOW THE SCENE IS BUILT (Three.js)
 *   - One THREE.Group holds everything, so stop() can delete it in one go.
 *   - 79 white glass bars in a row (one per channel) on a glass base.
 *   - A phone (left) and headphones (right) behind the bars.
 *   - A see-through teal box = Wi-Fi noise (drag it left/right; it snaps to
 *     real Wi-Fi channels 1-13). A pink box = microwave noise.
 *   - A purple ball = the data packet. It arcs from channel to channel.
 *   - A green line ("beam") flashes when a packet arrives safely; lost
 *     packets turn red and fall through the floor.
 *
 * MAIN STATE
 *   hopsPerSecond, wifiOn, wifiChannel, microwaveOn, smart - set by controls
 *   recipe   - the seeded random-number function (the hop recipe)
 *   upcoming - the next 6 random numbers, shown as "next hops"
 *   from/to  - the channel the packet left and the one it's flying to
 *   hopTimer - seconds since the last hop
 *   sent/lost - packet counters
 *   bar.userData.flash - per-bar flash amount (+1 purple, -1 red, fades to 0)
 *   bar.userData.bad   - per-bar "AFH learned this channel is noisy"
 *
 * HOW update() ANIMATES IT
 *   Every frame: add dt to hopTimer. When it passes 1/hopsPerSecond the
 *   packet "lands" (land() decides with a dice roll whether the noise on
 *   that channel destroyed it) and the next channel is taken from the
 *   recipe. Between hops the packet is moved along an arc with lerp.
 *   Bars grow and change colour while flashing, then fade back. Fallen
 *   packets drop with gravity and fade out, then get deleted.
 *
 * HOW CONTROLS CONNECT
 *   Sliders/toggles (from ui.js) just set the state variables above (and
 *   show/hide/move the noise boxes). update() and land() read them.
 *
 * HOW IT TIES TO main.js
 *   main.js shows `info`, calls start(world, panel) when the step opens,
 *   then update(dt) every frame and stop() when leaving.
 * =====================================================================
 */

// STEP 2: Frequency hopping.
// Bluetooth splits its radio band into 79 channels (lanes) and jumps between
// them 1,600 times a second. If Wi-Fi or a microwave is noisy on some lanes,
// only the hops that land there get lost. "Smart hopping" learns to avoid them.

// The Three.js 3D library, used as THREE.Something.
import * as THREE from 'three';
// Our ready-made 3D models and helpers (models.js).
import { makePhone, makeHeadphones, makeLabel, glassMaterial, disposeGroup } from '../models.js';
// Mouse/finger dragging of 3D objects (drag.js).
import { makeObjectDraggable } from '../drag.js';
// Builders for sliders, switches, number boxes and buttons in the side panel (ui.js).
import { addSlider, addToggle, addReadouts, addButton } from '../ui.js';

// Text for the explanation panel + camera spot. main.js reads this.
export const info = {
  title: 'Why doesn’t Wi-Fi drown it out?', // an everyday question
  answer: 'It hops between 79 channels.', // the one-line answer
  // The challenge for the visitor.
  tryThis: 'Turn on Smart hopping.',
  detail: 'It jumps channel 1,600 times a second to dodge Wi-Fi and microwaves.', // shown under 'More detail'
  // Fact cards: [name, value]. 1,600 hops/s means each hop lasts 625 microseconds.
  facts: [
    ['Channels', '79 × 1 MHz'],
    ['Hops', '1,600 per second'],
    ['Band', '2.402–2.480 GHz'],
  ],
  // Camera position [x, y, z] and the point it looks at.
  camera: { position: [0, 11, 21], target: [0, 0.5, -1] },
};

// Number of Bluetooth Classic channels.
const CHANNELS = 79;
const GAP = 0.25; // space between channel bars in the 3D world
// Channel number -> x position in 3D. (CHANNELS - 1) / 2 = 39 is the middle
// channel, so channel 39 sits at x = 0, channel 0 at the far left, 78 at the right.
const channelX = (ch) => (ch - (CHANNELS - 1) / 2) * GAP;
// Channel number -> its frequency in MHz (channel 0 = 2402 MHz, 1 MHz apart).
const channelMHz = (ch) => 2402 + ch;

// Wi-Fi channel n is centred on 2412 + 5(n − 1) MHz and is about 20 MHz wide.
// To turn MHz into a Bluetooth channel we subtract 2402, so 2412 -> channel 10.
const wifiCentre = (n) => 10 + 5 * (n - 1); // as a Bluetooth channel number
// Wi-Fi covers 10 Bluetooth channels either side of its centre (20 MHz total).
const WIFI_HALF_WIDTH = 10;
// Microwave ovens leak noise around 2450–2475 MHz.
// As Bluetooth channels: 2450 - 2402 = 48, 2475 - 2402 = 73.
const MICROWAVE = { from: 48, to: 73 };

// A tiny random-number maker that gives the SAME numbers every time for the
// same "seed". That's how both devices know the hop list without talking.
/*
 * makeHopRecipe(seed) -> a function next() that returns a number from 0 up to
 * (but not including) 1, like Math.random(). But Math.random() is different
 * every time; this one is "pseudo-random": the numbers look random, but they
 * are fully decided by the seed. Two devices with the same seed get exactly
 * the same sequence, so they hop to the same channels in the same order.
 *
 * This is a well-known small generator called "mulberry32". It works on
 * 32-bit whole numbers and scrambles their bits. The operators, in plain words:
 *   x | 0     "OR with 0": forces x to be a whole 32-bit integer.
 *   a ^ b     XOR: compares the bits of a and b and flips the ones that differ.
 *             Great for mixing two numbers together.
 *   x >>> n   shift all bits n places to the right (filling with zeros), so
 *             the high bits get mixed down into the low bits.
 *   Math.imul(a, b)  multiply as 32-bit integers, throwing away overflow
 *             (like a car odometer rolling over). This keeps numbers small
 *             and scrambles them well.
 *   1 | x     sets the lowest bit, i.e. makes x odd (odd multipliers mix better).
 *   >>> 0     reads the result as an UNSIGNED number: 0 to 4,294,967,295.
 *   / 4294967296   divides by 2^32 to get a decimal from 0 to just under 1.
 * `seed` lives on inside the returned function (a "closure"), so each call
 * moves it forward one step and the next call gives the next number.
 */
function makeHopRecipe(seed) {
  return function next() {
    // Make sure seed is a 32-bit integer.
    seed |= 0;
    // Step the seed forward by a fixed big odd number (0x6d2b79f5), wrapping at 32 bits.
    seed = (seed + 0x6d2b79f5) | 0;
    // Scramble: mix seed with a shifted copy of itself, then multiply (32-bit).
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    // Scramble again with different shift/multiply amounts.
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    // Final mix, make it unsigned, and squash into the range 0 to 1.
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/*
 * start(world, panel): called by main.js when this step opens.
 *   world = the shared 3D world (scene, camera...), panel = the controls panel.
 *   Builds everything and returns { update(dt), stop() }.
 */
export function start(world, panel) {
  // A Group = invisible container that holds all of this step's 3D objects.
  const group = new THREE.Group();
  // Add it to the scene so it's drawn.
  world.scene.add(group);

  // ----- The 79 channel bars -----
  // We keep all bars in an array so bars[ch] gives channel ch's bar.
  const bars = [];
  // One shared box shape for all bars: 0.18 wide, 0.3 tall, 1.4 deep.
  const barShape = new THREE.BoxGeometry(0.18, 0.3, 1.4);
  // Make one bar per channel.
  for (let ch = 0; ch < CHANNELS; ch++) {
    // Mesh = shape (geometry) + surface look (material). Each bar gets its OWN
    // white glass material so we can recolour bars one at a time.
    const bar = new THREE.Mesh(barShape, glassMaterial(0xffffff));
    // Put it at its channel's x; y = 0.15 (half its height) so it sits on y = 0.
    bar.position.set(channelX(ch), 0.15, 0);
    // userData = a free spot Three.js gives us to store our own info.
    // flash: how lit-up the bar is; bad: has AFH marked it noisy?
    bar.userData = { flash: 0, bad: false };
    group.add(bar);
    bars.push(bar);
  }
  // Labels under the two ends showing the lowest and highest frequency.
  const lowLabel = makeLabel('2.402 GHz', { size: 0.8 });
  lowLabel.position.set(channelX(0), -0.5, 1.2);
  const highLabel = makeLabel('2.480 GHz', { size: 0.8 });
  highLabel.position.set(channelX(CHANNELS - 1), -0.5, 1.2);
  // .add can take several objects at once.
  group.add(lowLabel, highLabel);

  // Glass base under the bars
  // Wide enough for all bars plus a bit of margin, thin (0.1), 60% opaque lilac.
  const base = new THREE.Mesh(new THREE.BoxGeometry(CHANNELS * GAP + 1, 0.1, 2.2), glassMaterial(0xe9e3ff, 0.6));
  // Move it down by half its thickness so its top is at y = 0.
  base.position.y = -0.05;
  group.add(base);

  // ----- The two devices at either end -----
  // (they sit behind the band, so the side panels don't cover them)
  // Phone on the left (x = -4), 4 units back (z = -4).
  const phone = makePhone();
  phone.position.set(-4, 0, -4);
  // Headphones on the right.
  const headphones = makeHeadphones();
  headphones.position.set(4, 0, -4);
  group.add(phone, headphones);

  // ----- Interference: Wi-Fi (draggable) and a microwave -----
  // Wi-Fi is a Group (box + label) so they move together when dragged.
  const wifi = new THREE.Group();
  // The box is as wide as 20 channels (WIFI_HALF_WIDTH * 2 bars), 2.6 tall,
  // in 30%-opaque teal glass.
  const wifiBox = new THREE.Mesh(
    new THREE.BoxGeometry(WIFI_HALF_WIDTH * 2 * GAP, 2.6, 1.8),
    glassMaterial(0x5fd0c5, 0.3)
  );
  // Lift by half its height to sit on the floor.
  wifiBox.position.y = 1.3;
  wifi.add(wifiBox);
  // Label floating above the box.
  const wifiLabel = makeLabel('Wi-Fi: drag me', { size: 0.9 });
  wifiLabel.position.y = 3.1;
  wifi.add(wifiLabel);
  group.add(wifi);

  // The microwave's noise zone (not draggable: it's always 2450-2475 MHz).
  const microwave = new THREE.Group();
  // Width = number of channels it covers (73 - 48 = 25) times the bar spacing. Pink glass.
  const microwaveBox = new THREE.Mesh(
    new THREE.BoxGeometry((MICROWAVE.to - MICROWAVE.from) * GAP, 2, 1.8),
    glassMaterial(0xf6a5c8, 0.3)
  );
  // Centre it halfway between its first and last channel; y = 1 = half of its 2 height.
  microwaveBox.position.set((channelX(MICROWAVE.from) + channelX(MICROWAVE.to)) / 2, 1, 0);
  microwave.add(microwaveBox);
  // Label above the middle of the box.
  const microwaveLabel = makeLabel('Microwave', { size: 0.9 });
  microwaveLabel.position.set(microwaveBox.position.x, 2.5, 0);
  microwave.add(microwaveLabel);
  group.add(microwave);

  // ----- The data packet that hops between channels -----
  // A small solid purple ball (radius 0.2; 24 x 16 segments make it look round).
  const packet = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x6d4ff0 })
  );
  // A bigger, 25%-opaque ball around it as a soft glow.
  // depthWrite: false = this see-through ball won't hide things behind it.
  const packetGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x8b6cf6, transparent: true, opacity: 0.25, depthWrite: false })
  );
  // Attach the glow to the packet so it moves with it.
  packet.add(packetGlow);
  group.add(packet);

  // Beam from the channel to the headphones when a packet arrives safely.
  // A BufferGeometry holding 2 points (we move them in land()).
  const beamGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  // Green line, starts fully invisible (opacity 0); it flashes to 1 then fades.
  const beam = new THREE.Line(beamGeometry, new THREE.LineBasicMaterial({ color: 0x22b07d, transparent: true, opacity: 0 }));
  group.add(beam);

  // Lost packets fall through the floor.
  // This list holds the red balls that are currently falling.
  const falling = [];

  // ----- Settings the controls change -----
  // Slowed down: 4 hops per second so you can follow it (real: 1,600).
  let hopsPerSecond = 4;
  // Wi-Fi starts on, on channel 6 (a very common router channel).
  let wifiOn = true;
  let wifiChannel = 6;
  // Microwave starts off.
  let microwaveOn = false;
  // Smart hopping (AFH) starts off.
  let smart = false;

  // ----- Hop state -----
  // The shared hop recipe, seeded with the number 0xb1e7 (hex for 45543).
  // Any device using this seed would produce the very same hops.
  const recipe = makeHopRecipe(0xb1e7);
  // Get the next 6 random numbers ahead of time, to show as "Next hops".
  const upcoming = [recipe(), recipe(), recipe(), recipe(), recipe(), recipe()];
  // The packet starts sitting on channel 39 (the middle).
  let from = 39;
  let to = 39;
  // Time since the last hop, in seconds.
  let hopTimer = 0;
  // Counters for the readouts.
  let sent = 0;
  let lost = 0;
  // Total time, used for the shimmering noise boxes.
  let clock = 0;

  // With smart hopping, bad channels are swapped for good ones.
  /*
   * pickChannel(random): turns a random number (0 to 1) into a channel.
   * Normal hopping: just scale it to 0-78. With AFH: if that channel is
   * marked bad, pick from the list of good channels instead. Because it
   * only uses the shared random number, both devices still agree.
   */
  function pickChannel(random) {
    // 0..1 times 79, rounded down = a channel number 0..78.
    const raw = Math.floor(random * CHANNELS);
    // Smart hopping off, or this channel is fine? Use it.
    if (!smart || !bars[raw].userData.bad) return raw;
    // Otherwise make a list of channel numbers (0..78) whose bar isn't marked bad.
    const good = bars.map((_, ch) => ch).filter((ch) => !bars[ch].userData.bad);
    // Pick one of the good ones using the same random number (if any are left).
    return good.length ? good[Math.floor(random * good.length)] : raw;
  }

  // How likely is a packet on this channel to get lost?
  // Returns a chance from 0 (never) to 1 (always).
  function noiseOn(ch) {
    // Start with no noise.
    let chance = 0;
    // Inside the Wi-Fi's 20 MHz? 85% chance of losing the packet.
    if (wifiOn && Math.abs(ch - wifiCentre(wifiChannel)) <= WIFI_HALF_WIDTH) chance = 0.85;
    // Inside the microwave's range? 60% chance (keep the bigger one if both).
    if (microwaveOn && ch >= MICROWAVE.from && ch <= MICROWAVE.to) chance = Math.max(chance, 0.6);
    return chance;
  }

  // ----- Controls -----
  // Slider: hops per second (1 to 30). (hopSlider is kept in case we want to
  // change it from code later with hopSlider.set(...).)
  const hopSlider = addSlider(panel, {
    label: 'Hops per second',
    min: 1,
    max: 30,
    value: hopsPerSecond,
    format: (v) => `${v} (slow-mo)`,
    note: 'Real Bluetooth hops 1,600 times every second!',
    // Store the new value; update() uses it to time hops.
    onInput: (v) => (hopsPerSecond = v),
  });

  // Switch: Wi-Fi router on/off.
  addToggle(panel, {
    label: '📶 Wi-Fi router',
    value: wifiOn,
    onChange: (v) => {
      // Remember it (noiseOn reads this)...
      wifiOn = v;
      // ...and show/hide the teal box.
      wifi.visible = v;
    },
  });

  // Slider: which Wi-Fi channel (1-13). We keep the returned object so
  // dragging the box can move the slider too (wifiSlider.set).
  const wifiSlider = addSlider(panel, {
    label: 'Wi-Fi channel',
    min: 1,
    max: 13,
    value: wifiChannel,
    // Show the channel and its centre frequency, e.g. "6 (2437 MHz)".
    format: (v) => `${v} (${2412 + 5 * (v - 1)} MHz)`,
    onInput: (v) => {
      // Remember the channel...
      wifiChannel = v;
      // ...and slide the teal box over the matching Bluetooth channels.
      wifi.position.x = channelX(wifiCentre(v));
    },
  });

  // Switch: microwave oven on/off.
  addToggle(panel, {
    label: '🍿 Microwave oven',
    value: microwaveOn,
    onChange: (v) => {
      microwaveOn = v;
      microwave.visible = v;
    },
  });

  // Switch: smart hopping (AFH). smartSwitch is kept so code could flip it later.
  const smartSwitch = addToggle(panel, {
    label: '🧠 Smart hopping (AFH)',
    value: smart,
    onChange: (v) => {
      smart = v;
      // Turning it off wipes the "bad channel" marks from every bar.
      if (!v) bars.forEach((b) => (b.userData.bad = false)); // forget what it learned
    },
  });

  // Live number boxes. show(key, text, mood) updates one; mood 'good'/'bad' colours it.
  const show = addReadouts(panel, [
    { key: 'now', label: 'Channel now', wide: true },
    { key: 'sent', label: 'Packets sent' },
    { key: 'lost', label: 'Packets lost' },
    { key: 'rate', label: 'Got through', wide: true },
  ]);

  // A hand-made panel box that lists the next few hops as little "chips".
  const nextBox = document.createElement('div');
  // Same CSS style as the other controls.
  nextBox.className = 'control';
  // A title, plus an empty .chips area we fill in updateReadouts().
  nextBox.innerHTML = '<div class="control-label"><span>Next hops (both devices know these)</span></div><div class="chips"></div>';
  panel.appendChild(nextBox);
  // Grab the empty .chips element so we can fill it later.
  const chipsEl = nextBox.querySelector('.chips');

  // Button that zeroes the counters.
  addButton(panel, {
    label: 'Reset counters',
    onClick: () => {
      sent = 0;
      lost = 0;
      updateReadouts();
    },
  });

  /*
   * updateReadouts(): rewrites all the number boxes and the "next hops" chips.
   */
  function updateReadouts() {
    // Current channel and its frequency in GHz (MHz / 1000, 3 decimals).
    show('now', `Ch ${to} (${(channelMHz(to) / 1000).toFixed(3)} GHz)`);
    show('sent', sent);
    // Lost count shows red once anything is lost.
    show('lost', lost, lost ? 'bad' : '');
    // Percentage that got through (100% before anything is sent, to avoid dividing by 0).
    const rate = sent ? Math.round(((sent - lost) / sent) * 100) : 100;
    // Green at 95%+, red under 80%, plain in between.
    show('rate', `${rate}%`, rate >= 95 ? 'good' : rate < 80 ? 'bad' : '');
    // Turn each upcoming random number into a channel and show it as a <span> chip.
    chipsEl.innerHTML = upcoming.map((r) => `<span>${pickChannel(r)}</span>`).join('');
  }

  // Drag the Wi-Fi box along the band. It snaps to real Wi-Fi channels.
  // axis 'x' = only left/right; limit 12 = can't go past x = ±12.
  const stopDrag = makeObjectDraggable(world, wifi, {
    limit: 12,
    axis: 'x',
    // Runs on every mouse move while dragging, with the box's new position.
    onMove: (pos) => {
      // Undo channelX(): turn the x position back into a Bluetooth channel.
      const ch = Math.round(pos.x / GAP + (CHANNELS - 1) / 2);
      // Undo wifiCentre(): turn it into the nearest Wi-Fi channel, kept within 1-13.
      const n = Math.max(1, Math.min(13, Math.round((ch - 10) / 5) + 1));
      // Remember it...
      wifiChannel = n;
      // ...snap the box exactly onto that Wi-Fi channel...
      wifi.position.x = channelX(wifiCentre(n));
      // ...and move the slider to match.
      wifiSlider.set(n);
    },
  });

  // When a packet lands on its channel: did it survive the noise?
  function land(ch) {
    // Count it as sent.
    sent++;
    // The bar for this channel.
    const bar = bars[ch];
    // Roll a dice (0 to 1). If it's under the noise chance, the packet is destroyed.
    if (Math.random() < noiseOn(ch)) {
      // Count it as lost.
      lost++;
      bar.userData.flash = -1; // red flash
      if (smart) bar.userData.bad = true; // remember: this channel is noisy
      // Make a red copy of the packet ball (re-using its geometry) that will fall.
      const drop = new THREE.Mesh(packet.geometry, new THREE.MeshBasicMaterial({ color: 0xe5484d, transparent: true }));
      // Start it exactly where the packet is now.
      drop.position.copy(packet.position);
      // Falling speed starts at 0; update() speeds it up like gravity.
      drop.userData.speed = 0;
      group.add(drop);
      falling.push(drop);
    } else {
      bar.userData.flash = 1; // purple flash
      // Move the green beam's 2 points: from the top of the bar to the headphones.
      const p = beam.geometry.attributes.position;
      p.setXYZ(0, channelX(ch), 0.6, 0);
      p.setXYZ(1, headphones.position.x, 1, headphones.position.z);
      // Tell Three.js the points changed so it re-uploads them to the graphics card.
      p.needsUpdate = true;
      // Make the beam fully visible; update() fades it out.
      beam.material.opacity = 1;
    }
    // Refresh the counters.
    updateReadouts();
  }

  // Starting state
  // Show/hide and place the Wi-Fi box to match the starting settings.
  wifi.visible = wifiOn;
  wifi.position.x = channelX(wifiCentre(wifiChannel));
  // Hide the microwave box (it starts off).
  microwave.visible = microwaveOn;
  // First fill of the readouts.
  updateReadouts();

  // Give main.js our per-frame and clean-up functions.
  return {
    // Runs every frame; dt = seconds since the last frame.
    update(dt) {
      // Total time keeps counting up.
      clock += dt;
      // How long one hop lasts, e.g. 4 hops/s -> 0.25 s each.
      const hopTime = 1 / hopsPerSecond;
      // Time since the last hop grows.
      hopTimer += dt;

      // Time for the next hop?
      if (hopTimer >= hopTime) {
        // Restart the hop timer.
        hopTimer = 0;
        // The packet arrives on its channel: survive or get lost?
        land(to);
        // The old destination is now where we start from...
        from = to;
        // ...and the next destination comes from the front of the recipe list.
        // .shift() removes and returns the first item.
        to = pickChannel(upcoming.shift());
        // Top up the list with a fresh number from the recipe so there are always 6.
        upcoming.push(recipe());
        // Show the new current channel and chips.
        updateReadouts();
      }

      // Move the packet in an arc from the old channel to the new one.
      // k goes 0 -> 1 during the first 70% of the hop, then stays at 1 (rests on the bar).
      const k = Math.min(1, hopTimer / (hopTime * 0.7));
      // lerp = "linear interpolation": the point k of the way from a to b.
      // lerp(a, b, 0) = a, lerp(a, b, 1) = b, lerp(a, b, 0.5) = halfway.
      const x = THREE.MathUtils.lerp(channelX(from), channelX(to), k);
      // sin(0..PI) goes 0 -> 1 -> 0, giving a hump: up to 2 units high in the middle.
      const arc = Math.sin(k * Math.PI) * 2;
      packet.position.set(x, 0.55 + arc, 0);

      // Bars: flash when used, slowly fade back. Bad channels stay pink-red.
      for (const bar of bars) {
        // flash: +1 = just hit (purple), -1 = just lost (red), 0 = calm.
        const f = bar.userData.flash;
        // Flashing bars grow taller: from 0.3 up to 1.5.
        const height = 0.3 + Math.abs(f) * 1.2;
        // The shape is 0.3 tall, so stretch it by height / 0.3 on the y axis only.
        bar.scale.y = height / 0.3;
        // Scaling stretches around the centre, so raise the centre to keep the bottom on the floor.
        bar.position.y = height / 2;
        // The bar's colour object (red, green, blue each 0 to 1).
        const color = bar.material.color;
        // Positive flash: blend from white towards purple (lower red and green).
        if (f > 0) color.setRGB(1 - 0.45 * f, 1 - 0.58 * f, 1 - 0.06 * f);
        // Negative flash: blend from white towards red (lower green and blue).
        else if (f < 0) color.setRGB(1, 1 + 0.72 * f, 1 + 0.7 * f);
        // Calm: pink if AFH marked it bad, otherwise white.
        else color.setHex(bar.userData.bad && smart ? 0xf8c6cc : 0xffffff);
        // Move flash back towards 0 by 2 per second (so a flash lasts half a second).
        bar.userData.flash = f > 0 ? Math.max(0, f - dt * 2) : Math.min(0, f + dt * 2);
      }

      // Fade the green beam out quickly (fully gone in 1/3 s), never below 0.
      beam.material.opacity = Math.max(0, beam.material.opacity - dt * 3);

      // Lost packets fall and fade.
      // Loop backwards so removing an item doesn't skip the next one.
      for (let i = falling.length - 1; i >= 0; i--) {
        const d = falling[i];
        // Gravity: speed grows by 9 units/s every second.
        d.userData.speed += dt * 9;
        // Move down by speed * time.
        d.position.y -= d.userData.speed * dt;
        // Fade out (gone in under a second).
        d.material.opacity -= dt * 1.2;
        // Once invisible, clean it up.
        if (d.material.opacity <= 0) {
          // Free its material (the geometry is shared with the packet, so we keep that).
          d.material.dispose();
          // Take it out of the scene.
          d.removeFromParent();
          // Remove it from our list.
          falling.splice(i, 1);
        }
      }

      // Noise boxes shimmer; the microwave flickers like a real one.
      // Wi-Fi: opacity gently waves between 0.20 and 0.30.
      wifiBox.material.opacity = 0.25 + Math.sin(clock * 3) * 0.05;
      // Microwave: snaps between 0.2 and 0.35 quickly (sin > 0 half the time).
      microwaveBox.material.opacity = 0.2 + (Math.sin(clock * 20) > 0 ? 0.15 : 0);
    },
    // Runs when we leave this step.
    stop() {
      // Remove the Wi-Fi drag listeners.
      stopDrag();
      // Free the materials of any packets still falling.
      falling.forEach((d) => d.material.dispose());
      // Remove the whole step from the scene and free its graphics memory.
      disposeGroup(group);
    },
  };
}
