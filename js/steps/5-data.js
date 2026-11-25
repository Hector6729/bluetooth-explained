// STEP 5: Sending data as 1s and 0s.
// The radio can't send letters. It sends bits by nudging its frequency:
// a tiny bit higher for 1, a tiny bit lower for 0 (called GFSK).
// Bits are packed into a packet: wake-up pattern, address, header, your data, check code.
// Noise can flip bits. The check code (CRC) catches it, and the packet is sent again.
//
// ============================================================================
// BIG PICTURE OF THIS FILE (read this first in the judging interview)
// ============================================================================
// WHAT IT TEACHES
//   1. Text -> bytes -> bits. A bit is a 0 or a 1; a byte is 8 bits (0..255).
//      TextEncoder turns text into bytes with UTF-8: normal letters are 1 byte,
//      an emoji like 🎧 is 4 bytes. Each byte becomes 8 bits.
//   2. A Bluetooth Low Energy packet, in order:
//        preamble (8 bits)   10101010: a "wake up, bits are coming" pattern so
//                            the receiver can lock onto the rhythm
//        access address (32) which connection this packet belongs to
//        header (16)         packet type + how many data bytes follow
//        payload             your actual data
//        CRC (24)            a check code calculated from header + payload
//   3. GFSK (Gaussian Frequency-Shift Keying): the radio sends 1 as a slightly
//      higher frequency and 0 as slightly lower. We draw it hugely exaggerated:
//      a 1 wiggles 3 times per bit, a 0 wiggles 1.5 times.
//   4. Noise can flip bits. The CRC catches the damage, the headphones throw
//      the packet away and it is sent again (a "retry"). A good packet is
//      answered with a green "OK!" ball (an ACK, acknowledgement).
//
// HOW THE 3D SCENE IS BUILT
//   - `group` (a THREE.Group) holds everything so stop() can remove it in one go.
//   - A glass runway, a phone on the left, headphones on the right.
//   - The WAVE: a thin ribbon made from our own BufferGeometry (a list of
//     corner points we fill in ourselves). Its 600 sample points are
//     recalculated every frame, with a colour per point.
//   - The BIT BLOCKS: one InstancedMesh = one box shape drawn many times in one
//     go, each copy with its own position, height and colour. Tall = 1, short = 0.
//   - A red see-through noise cloud at x = 0, and the green ACK ball.
//
// MAIN STATE
//   packet         { bits, sectionOf, headerLength, payloadLength } from buildPacket()
//   travelled      how far (in 3D units) the front of the packet has moved
//   flipped[i]     undefined = bit i hasn't reached the cloud yet,
//                  true/false = it got flipped / it survived
//   phaseSent / phaseReceived   wave phase at the start of each bit (see below)
//   status         'sending' | 'ok' | 'bad'
//   tries, resendTimer, arrivedCount, ackProgress
//
// HOW update(dt) ANIMATES (main.js calls it every frame; dt = seconds)
//   1. Move the packet forward (speed slider = bits per second).
//   2. Roll the dice for each bit that just crossed the cloud (Math.random()).
//   3. Count bits that reached the headphones; when all have, check the CRC.
//   4. If damaged, wait 1.2 s and re-send.
//   5. Rebuild the wave ribbon and the bit blocks, wobble the cloud,
//      fly the ACK ball.
//
// CONTROLS -> STATE
//   message box -> message + send(); speed -> bitsPerSecond;
//   noise -> noise (chance a bit flips); toggle -> autoResend;
//   "Send again" -> send().
//
// main.js imports `info` and calls start(world, panel), which returns
// { update(dt), stop() }.
// ============================================================================

// The whole Three.js 3D library, used as THREE.Something.
import * as THREE from 'three';
// Ready-made models and helpers from our own models.js.
import { makePhone, makeHeadphones, makeLabel, glassMaterial, disposeGroup } from '../models.js';
// Helpers that build the HTML controls in the side panel.
import { addSlider, addToggle, addReadouts, addButtonRow, addTextInput } from '../ui.js';

// `info` is read by main.js to fill the explanation panel and place the camera.
export const info = {
  title: 'What actually travels through the air?', // an everyday question
  answer: 'Your music, as 1s and 0s.', // the one-line answer
  // What to try first.
  tryThis: 'Turn up the noise.',
  detail: 'Bits travel in packets with a check code. Broken packets get sent again.', // shown under 'More detail'
  // Fact cards: [label, value].
  facts: [
    ['Speed', '1–2 million bits/s'],
    ['One bit lasts', '1 millionth of a second'],
    ['Max data per packet', '251 bytes'],
  ],
  // Camera position (x, y, z) and the point it looks at.
  camera: { position: [0, 4.5, 15.5], target: [0, 1.7, 0] },
};

// The parts of a packet, in order, with a colour for each.
// name = what we show the user, css = its colour on screen and in 3D.
const SECTIONS = {
  preamble: { name: 'Wake-up pattern', css: '#8b6cf6' },
  address: { name: 'Address', css: '#3fbcb0' },
  header: { name: 'Header', css: '#f5a524' },
  payload: { name: 'Your data', css: '#f27bb0' },
  crc: { name: 'Check code (CRC)', css: '#22b07d' },
};
// Red is used for anything damaged by noise.
const RED = '#e5484d';

const START_X = -6; // where bits leave the phone
const END_X = 6; // where they reach the headphones
const BIT_LENGTH = 0.4; // how long one bit is in the 3D world
const WAVE_Y = 1.2; // the height of the wave's centre line
const WAVE_HEIGHT = 0.45; // how far the wave swings up and down (its amplitude)
const WIGGLES = { 1: 3, 0: 1.5 }; // wiggles per bit: 1 = faster, 0 = slower
const SAMPLES = 600; // how many points we calculate along the wave (more = smoother)

// ----- Building the packet -----
/*
 * toBits(number, count): write `number` as `count` bits, most important bit first.
 *   e.g. toBits(5, 4) -> [0, 1, 0, 1].
 *   Array.from({ length: count }, fn) makes an array of `count` items by calling fn(_, i).
 *   `number >>> k` shifts the bits right by k places (dropping the right ones),
 *   and `& 1` keeps only the last bit. So we read bit number (count-1-i).
 */
const toBits = (number, count) => Array.from({ length: count }, (_, i) => (number >>> (count - 1 - i)) & 1);
// bytesToBits: each byte -> 8 bits; flatMap joins all the little arrays into one long one.
const bytesToBits = (bytes) => Array.from(bytes).flatMap((b) => toBits(b, 8));

// CRC-24, the same kind of check code Bluetooth Low Energy uses.
// It's like a super-powered checksum: change any bit and it changes.
/*
 * HOW A CRC WORKS, in plain words:
 *   Think of `crc` as a row of 24 boxes, each holding a 0 or 1 (a "shift register").
 *   For every bit of the message:
 *     1. Look at the leftmost box (bit 23) and XOR it with the new message bit.
 *        (XOR: 1 if the two bits differ, 0 if they are the same.)
 *     2. Slide all boxes one place left (<< 1). `& 0xffffff` throws away
 *        anything that falls off the 24-box edge.
 *     3. If the bit from step 1 was 1, flip a fixed set of boxes by XOR-ing with
 *        the "polynomial" 0x00065b (Bluetooth's chosen pattern).
 *   After all bits, the 24 boxes ARE the check code. Mathematically this is the
 *   remainder of dividing the message by the polynomial (like long division,
 *   but with XOR instead of subtraction). Any single flipped bit, and nearly any
 *   bunch of flipped bits, gives a different remainder, so damage is noticed.
 *   0x555555 (0101...01) is the starting value Bluetooth uses for advertising packets.
 *   The sender puts the code at the end; the receiver recalculates it and compares.
 */
function crc24(bits) {
  // Fill the 24 boxes with the starting pattern.
  let crc = 0x555555;
  for (const bit of bits) {
    // Step 1: leftmost box XOR the incoming bit.
    const top = ((crc >>> 23) & 1) ^ bit;
    // Step 2: shift left, keep only 24 bits.
    crc = (crc << 1) & 0xffffff;
    // Step 3: if `top` was 1, flip the polynomial's boxes.
    if (top) crc ^= 0x00065b;
  }
  // The final 24-bit check code (a number 0..16777215).
  return crc;
}

/*
 * buildPacket(text): turns a message into the full list of bits, plus a
 * parallel list saying which packet part each bit belongs to.
 */
function buildPacket(text) {
  // Text -> UTF-8 bytes (a Uint8Array).
  const data = new TextEncoder().encode(text);
  // The `...` (spread) pours the elements of one array into another.
  const header = [...toBits(0x02, 8), ...toBits(data.length, 8)]; // type + length
  // The payload: our message's bytes as bits.
  const payload = bytesToBits(data);
  // The CRC is calculated over header + payload, then written as 24 bits.
  const crc = toBits(crc24([...header, ...payload]), 24);
  // The five parts in order. 0b10101010 is binary for the alternating preamble;
  // 0x8e89bed6 is the real fixed address Bluetooth uses for advertising packets.
  const parts = [
    ['preamble', toBits(0b10101010, 8)],
    ['address', toBits(0x8e89bed6, 32)],
    ['header', header],
    ['payload', payload],
    ['crc', crc],
  ];
  const bits = []; // every bit, in sending order
  const sectionOf = []; // sectionOf[i] = which part bit i belongs to (for colouring)
  // Flatten the parts into the two lists.
  for (const [section, sectionBits] of parts) {
    for (const b of sectionBits) {
      bits.push(b);
      sectionOf.push(section);
    }
  }
  // headerLength / payloadLength let the receiver find where each part starts.
  return { bits, sectionOf, headerLength: header.length, payloadLength: payload.length };
}

/*
 * start(world, panel): called by main.js when the user arrives at step 5.
 * Builds the scene and controls, then returns { update(dt), stop() }.
 */
export function start(world, panel) {
  // One container for everything in this step.
  const group = new THREE.Group();
  world.scene.add(group);

  // Glass "runway" under the wave
  // A Mesh = Geometry (shape) + Material (look). BoxGeometry(width, height, depth).
  // glassMaterial(colour, 0.55) = shiny and 55% see-through.
  const runway = new THREE.Mesh(new THREE.BoxGeometry(END_X - START_X + 2, 0.08, 2), glassMaterial(0xe9e3ff, 0.55));
  runway.position.y = -0.04; // so its top surface is at height 0
  group.add(runway);

  // The sender, a bit left of where the wave starts.
  const phone = makePhone();
  phone.position.set(START_X - 1.3, 0, 0);
  // The receiver, a bit right of where the wave ends.
  const headphones = makeHeadphones();
  headphones.position.set(END_X + 1.3, 0, 0);
  group.add(phone, headphones);

  // ----- The wave: a flat ribbon whose shape we recalculate every frame -----
  /*
   * BufferGeometry is Three.js's raw shape format: big flat arrays of numbers
   * that go straight to the graphics card.
   *   positions: for each of the 600 samples we make 2 corner points (top and
   *              bottom edge of the ribbon), each with x, y, z => 600*2*3 numbers.
   *   colours:   the same layout, but r, g, b per corner point.
   *   indices:   which 3 corner points make each triangle. Between sample i and
   *              i+1 there are 4 points (a, a+1 on the left, a+2, a+3 on the
   *              right), and two triangles fill that little rectangle.
   * Float32Array is a fixed-size array of decimal numbers, fast for the GPU.
   */
  const positions = new Float32Array(SAMPLES * 2 * 3);
  const colours = new Float32Array(SAMPLES * 2 * 3);
  const indices = [];
  for (let i = 0; i < SAMPLES - 1; i++) {
    const a = i * 2; // index of this sample's top point (a+1 is its bottom point)
    // Two triangles: (top, bottom, nextTop) and (bottom, nextBottom, nextTop).
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  // Create the empty geometry and attach our arrays as "attributes".
  const ribbonGeometry = new THREE.BufferGeometry();
  // The 3 means "read these numbers in groups of 3" (x,y,z or r,g,b).
  ribbonGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  ribbonGeometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  ribbonGeometry.setIndex(indices);
  // vertexColors: true = use our per-point colours. DoubleSide = visible from behind too.
  // MeshBasicMaterial ignores lighting, so the colours stay bright.
  const ribbon = new THREE.Mesh(ribbonGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  group.add(ribbon);

  // ----- Little blocks above the wave: tall = 1, short = 0 -----
  // The most blocks that can fit between phone and headphones at once (+2 spare).
  const MAX_BLOCKS = Math.ceil((END_X - START_X) / BIT_LENGTH) + 2;
  /*
   * InstancedMesh(geometry, material, count): draws the SAME shape up to
   * `count` times in a single draw call (very fast), where each copy
   * ("instance") gets its own transform matrix (position/rotation/scale)
   * and its own colour. We set those in update() with setMatrixAt/setColorAt.
   * MeshStandardMaterial reacts to the scene's lights; roughness 0.3 = fairly shiny.
   */
  const blocks = new THREE.InstancedMesh(
    new THREE.BoxGeometry(BIT_LENGTH * 0.75, 1, 0.3),
    new THREE.MeshStandardMaterial({ roughness: 0.3 }),
    MAX_BLOCKS
  );
  group.add(blocks);
  // A Sprite label (text picture that always faces the camera) explaining the blocks.
  const oneLabel = makeLabel('tall block = 1, short = 0', { size: 0.7 });
  oneLabel.position.set(0, 3.6, 0);
  group.add(oneLabel);

  // ----- The noise cloud in the middle -----
  // A red sphere, only 15% opaque. depthWrite: false stops it hiding things
  // behind it in the depth check, so the wave stays visible "inside" it.
  const cloud = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0xe5484d, transparent: true, opacity: 0.15, depthWrite: false })
  );
  cloud.position.set(0, WAVE_Y, 0); // centred on the wave at x = 0
  group.add(cloud);
  // Its label, just below and in front.
  const cloudLabel = makeLabel('⚡ Radio noise', { size: 0.7, color: RED });
  cloudLabel.position.set(0, -0.3, 1.2);
  group.add(cloudLabel);

  // A green "OK!" ball the headphones send back when a packet arrives safely
  const ack = new THREE.Mesh(new THREE.SphereGeometry(0.25, 24, 12), new THREE.MeshBasicMaterial({ color: 0x22b07d }));
  ack.visible = false; // hidden until a packet passes the CRC check
  group.add(ack);

  // ----- Settings -----
  let message = 'Hi 🎧'; // the text being sent
  let bitsPerSecond = 8; // slow motion! Real Bluetooth does about 1,000,000
  let noise = 0; // chance (0–0.3) that a bit passing through the cloud gets flipped
  let autoResend = true; // re-send damaged packets automatically?

  // ----- One packet's journey -----
  let packet = null; // filled in by send()
  let travelled = 0; // how far the front of the packet has moved
  let flipped = []; // for each bit: true/false once it has passed the noise
  let phaseSent = []; // wave phase at the start of each bit (as sent)
  let phaseReceived = []; // ... and after noise
  let tries = 0; // how many times this packet has been sent
  let status = 'sending'; // 'sending' | 'ok' | 'bad'
  let resendTimer = 0; // seconds to wait before re-sending a bad packet
  let arrivedCount = 0; // how many bits have reached the headphones
  let ackProgress = -1; // -1 = no ACK flying; 0..1 = how far the ACK has flown

  /*
   * computePhases(useFlips): where in its up-and-down cycle the wave is at the
   * START of each bit.
   *   PHASE is the angle fed into sin(): 0 to 2π is one full wiggle.
   *   A 1 adds 3 wiggles (3 * 2π), a 0 adds 1.5 wiggles (1.5 * 2π).
   *   Because a 0 is 1.5 wiggles, it ends halfway through a cycle. If the next
   *   bit started again from phase 0 the wave would JUMP (a sudden break).
   *   So each bit starts at the phase where the previous one ended: a running
   *   total. This "continuous phase" is how real FSK radios behave too: they
   *   change speed smoothly instead of jumping, which keeps the signal clean.
   *   useFlips = true uses the bits AFTER noise (for the right half of the wave).
   */
  function computePhases(useFlips) {
    const phases = [0]; // bit 0 starts at phase 0
    for (let i = 0; i < packet.bits.length; i++) {
      // The bit as it really is here: flipped if noise hit it (1 - 0 = 1, 1 - 1 = 0).
      const bit = useFlips && flipped[i] ? 1 - packet.bits[i] : packet.bits[i];
      // Next bit's start = this bit's start + this bit's wiggles.
      phases.push(phases[i] + 2 * Math.PI * WIGGLES[bit]);
    }
    return phases;
  }

  /*
   * send({ newTry }): start sending a (new or repeated) packet from the phone.
   * newTry = true means it's a retry, so we add 1 to `tries` instead of resetting it.
   */
  function send({ newTry = false } = {}) {
    // Build from the message (a space if the box is empty, so there is always data).
    packet = buildPacket(message || ' ');
    travelled = 0; // back at the phone
    // One entry per bit, all undefined = "not judged by the noise yet".
    flipped = new Array(packet.bits.length).fill(undefined);
    phaseSent = computePhases(false);
    phaseReceived = phaseSent.slice(); // a copy, until some bit gets flipped
    arrivedCount = 0;
    status = 'sending';
    tries = newTry ? tries + 1 : 1;
    ack.visible = false; // hide any old ACK ball
    ackProgress = -1;
    drawBitStrip(); // redraw the 1s and 0s in the panel
    updateReadouts(); // and the number boxes
  }

  // ----- Controls -----
  // Typing a new message re-sends straight away (max 12 characters).
  addTextInput(panel, {
    label: 'Message to send',
    value: message,
    maxLength: 12,
    onInput: (v) => {
      message = v;
      send();
    },
  });

  // Speed slider: bits per second.
  const speedSlider = addSlider(panel, {
    label: 'Speed',
    min: 2,
    max: 60,
    value: bitsPerSecond,
    format: (v) => `${v} bits/s (slow-mo)`,
    note: 'Real Bluetooth: 1–2 million bits per second!',
    onInput: (v) => (bitsPerSecond = v),
  });

  // Noise slider: 0..30 percent, stored as a probability 0..0.3.
  const noiseSlider = addSlider(panel, {
    label: '⚡ Radio noise',
    min: 0,
    max: 30,
    value: noise * 100,
    format: (v) => (v === 0 ? 'none' : `${v}% of bits flipped`),
    note: 'Bits passing through the red cloud can get flipped.',
    onInput: (v) => (noise = v / 100),
  });

  // On/off switch for automatic retries.
  addToggle(panel, {
    label: '🔁 Ask again if damaged',
    value: autoResend,
    onChange: (v) => (autoResend = v),
  });

  // A manual re-send button.
  addButtonRow(panel, [{ label: 'Send again', onClick: () => send(), primary: true }]);

  // The live number boxes. show(key, html, mood) updates one.
  const show = addReadouts(panel, [
    { key: 'part', label: 'Now sending', wide: true },
    { key: 'progress', label: 'Bits arrived' },
    { key: 'tries', label: 'Tries' },
    { key: 'status', label: 'Check code says', wide: true },
    { key: 'received', label: 'Headphones received', wide: true },
  ]);

  // The full packet as coloured 1s and 0s
  // A box with a title, a colour legend (built from SECTIONS) and an empty strip.
  const stripBox = document.createElement('div');
  stripBox.className = 'control';
  stripBox.innerHTML = `<div class="control-label"><span>The whole packet</span></div>
    <div class="legend">${Object.values(SECTIONS).map((s) => `<span><i style="background:${s.css}"></i>${s.name}</span>`).join('')}</div>
    <div class="bit-strip mono"></div>`;
  panel.appendChild(stripBox);
  // Find the empty strip inside the box we just made.
  const strip = stripBox.querySelector('.bit-strip');
  // One <span> per bit, so update() can mark bits as arrived/flipped.
  let stripSpans = [];

  /*
   * drawBitStrip(): writes every bit as a coloured <span>1</span> or <span>0</span>.
   */
  function drawBitStrip() {
    strip.innerHTML = packet.bits
      .map((b, i) => `<span style="color:${SECTIONS[packet.sectionOf[i]].css}">${b}</span>`)
      .join('');
    // Keep a normal array of those spans for quick access by bit number.
    stripSpans = Array.from(strip.children);
  }

  // Read the received bits back into text (some letters may be broken by noise).
  // receivedBits(): the bits as the headphones got them (flipped ones swapped).
  function receivedBits() {
    return packet.bits.map((b, i) => (flipped[i] ? 1 - b : b));
  }

  /*
   * receivedText(): cut the payload out of the received bits and decode it.
   *   The payload starts after preamble (8) + address (32) + header.
   *   Every 8 bits are joined into a string like "01001000" and
   *   parseInt(..., 2) reads it as a base-2 number (a byte).
   *   TextDecoder turns UTF-8 bytes back into text. Broken bytes become �.
   */
  function receivedText() {
    const bits = receivedBits();
    const start = 8 + 32 + packet.headerLength;
    const payload = bits.slice(start, start + packet.payloadLength);
    const bytes = [];
    for (let i = 0; i + 8 <= payload.length; i += 8) bytes.push(parseInt(payload.slice(i, i + 8).join(''), 2));
    return new TextDecoder().decode(new Uint8Array(bytes));
  }

  /*
   * checkCodeOK(): what the headphones do on arrival. Recalculate the CRC over
   * the received header + payload, and compare with the CRC that arrived.
   * Equal = the packet is (almost certainly) perfect.
   */
  function checkCodeOK() {
    const bits = receivedBits();
    const dataStart = 8 + 32; // header starts after preamble + address
    // If the wake-up pattern or address got damaged, the headphones can't
    // even tell the packet is for them, so it's lost too.
    // .some(Boolean) = "is any entry true?"
    if (flipped.slice(0, dataStart).some(Boolean)) return false;
    // Where the data ends and the 24 CRC bits begin.
    const dataEnd = dataStart + packet.headerLength + packet.payloadLength;
    // The CRC that arrived, read as one number.
    const sentCode = parseInt(bits.slice(dataEnd).join(''), 2);
    // Our own calculation must match it.
    return crc24(bits.slice(dataStart, dataEnd)) === sentCode;
  }

  /*
   * updateReadouts(): rewrite all the number boxes from the current state.
   */
  function updateReadouts() {
    const n = packet.bits.length;
    // Which bit is at the front right now (clamped into 0..n-1).
    const frontBit = Math.min(n - 1, Math.max(0, Math.floor(travelled / BIT_LENGTH)));
    // ...and which packet part it is in.
    const section = SECTIONS[packet.sectionOf[frontBit]];
    // "Now sending": the part name in its colour, or Done once all bits have left.
    show('part', travelled / BIT_LENGTH >= n ? 'Done ✓' : `<span style="color:${section.css}">● ${section.name}</span>`);
    show('progress', `${arrivedCount} / ${n}`);
    // Tries in red if it took more than one go.
    show('tries', tries, tries > 1 ? 'bad' : '');
    // How many bits got flipped so far (count the `true`s).
    const flips = flipped.filter(Boolean).length;
    // The CRC verdict box, with "bit"/"bits" spelled correctly.
    if (status === 'sending') show('status', flips ? `⏳ Waiting… (${flips} bit${flips > 1 ? 's' : ''} flipped so far)` : '⏳ Waiting for the whole packet…');
    else if (status === 'ok') show('status', '✅ Matches! Packet is perfect', 'good');
    else show('status', `❌ Damaged: ${flips} bit${flips === 1 ? '' : 's'} flipped${autoResend ? ', asking again' : ''}`, 'bad');
    // What the headphones ended up with.
    if (status === 'ok') show('received', `🎧 “${receivedText()}”`, 'good');
    else if (status === 'bad') show('received', `🗑️ Thrown away (it said “${receivedText()}”)`, 'bad');
    else show('received', '…');
  }

  // A helper object never added to the scene: we set its position/scale, ask
  // it to compute its matrix, and copy that matrix into an instance.
  const dummy = new THREE.Object3D();
  // A reusable Color, so we don't make new objects every frame.
  const colour = new THREE.Color();
  // Send the first packet straight away.
  send();

  return {
    /*
     * update(dt): called by main.js every frame. dt = seconds since last frame.
     */
    update(dt) {
      const n = packet.bits.length; // number of bits in the packet
      const travelSpan = END_X - START_X; // distance from phone to headphones (12)

      // Move forward: bits per second * length of a bit * seconds = distance this frame.
      if (status === 'sending') travelled += bitsPerSecond * BIT_LENGTH * dt;

      // Decide flips for bits whose centre just crossed the noise cloud (x = 0).
      let changed = false;
      for (let i = 0; i < n; i++) {
        // Bit 0 is at the front, so later bits are further back (to the left).
        const centreX = START_X + travelled - (i + 0.5) * BIT_LENGTH;
        if (centreX < 0) break; // later bits haven't reached it yet
        if (flipped[i] === undefined) {
          // PROBABILITY: Math.random() gives a number from 0 up to (not including) 1,
          // spread evenly. It is below `noise` exactly `noise` of the time, e.g.
          // noise = 0.1 => true 10% of the time. Each bit gets judged only once.
          flipped[i] = Math.random() < noise;
          changed = true;
        }
      }
      if (changed) {
        // Some bits were judged: recompute the after-noise phases and the text boxes.
        phaseReceived = computePhases(true);
        updateReadouts();
      }

      // How many bits have reached the headphones?
      // Bits arrive once the packet front has gone past END_X; clamp into 0..n.
      const arrived = Math.max(0, Math.min(n, Math.floor((travelled - travelSpan) / BIT_LENGTH)));
      if (arrived !== arrivedCount) {
        // Mark the newly arrived bits in the panel's strip (CSS classes change their look).
        for (let i = arrivedCount; i < arrived; i++) {
          stripSpans[i].classList.add('arrived');
          if (flipped[i]) stripSpans[i].classList.add('flipped');
        }
        arrivedCount = arrived;
        // Whole packet in? Time for the CRC check.
        if (arrived === n && status === 'sending') {
          status = checkCodeOK() ? 'ok' : 'bad';
          if (status === 'ok') ackProgress = 0; // launch the green ACK ball
          resendTimer = 1.2; // pause before a retry, so you can see what happened
        }
        updateReadouts();
      }

      // Damaged? Wait a moment, then send again.
      if (status === 'bad' && autoResend) {
        resendTimer -= dt;
        if (resendTimer <= 0) send({ newTry: true });
      }

      // ----- Draw the wave -----
      // For each of the 600 sample points along the runway...
      for (let k = 0; k < SAMPLES; k++) {
        // ...its x position, evenly spread from START_X to END_X.
        const x = START_X + (k / (SAMPLES - 1)) * travelSpan;
        const s = travelled - (x - START_X); // position along the packet
        // Which bit is at this point (s / bit length, rounded down).
        const i = Math.floor(s / BIT_LENGTH);
        let y = WAVE_Y; // flat line by default
        let hex = '#c9c4d8'; // grey = nothing here
        if (i >= 0 && i < n) {
          // Right of the cloud (x > 0) we show the bit as received (maybe flipped).
          const afterNoise = x > 0 && flipped[i];
          const bit = afterNoise ? 1 - packet.bits[i] : packet.bits[i];
          // Left of the cloud use the sent phases, right of it the received ones.
          const phases = x > 0 ? phaseReceived : phaseSent;
          // Phase = where this bit started + how far we are into the bit (0..1)
          // times that bit's wiggles * 2π. This keeps the wave continuous.
          const phase = phases[i] + 2 * Math.PI * WIGGLES[bit] * ((s - i * BIT_LENGTH) / BIT_LENGTH);
          // sin() turns the phase into an up-and-down value from -1 to 1.
          y += WAVE_HEIGHT * Math.sin(phase);
          if (x > 0 && noise > 0) y += (Math.random() - 0.5) * noise * 0.8; // fuzzy after the noise
          // Colour: red if damaged, otherwise the colour of its packet part.
          hex = afterNoise ? RED : SECTIONS[packet.sectionOf[i]].css;
        }
        // Turn the "#rrggbb" text into r, g, b numbers 0..1.
        colour.set(hex);
        const thickness = 0.06; // half the ribbon's height
        // Write this sample's top and bottom points into the positions array.
        // k * 6 = where this sample's 6 numbers start (2 points * x,y,z).
        positions.set([x, y + thickness, 0, x, y - thickness, 0], k * 6);
        // Same colour for both points.
        colours.set([colour.r, colour.g, colour.b, colour.r, colour.g, colour.b], k * 6);
      }
      // needsUpdate = true tells Three.js "these arrays changed, send them to
      // the graphics card again". Without it the wave would never move.
      ribbonGeometry.attributes.position.needsUpdate = true;
      ribbonGeometry.attributes.color.needsUpdate = true;

      // ----- Draw the bit blocks -----
      let count = 0; // how many instances we've filled this frame
      // Bits that already reached the headphones are skipped.
      const firstBit = Math.max(0, Math.floor((travelled - travelSpan) / BIT_LENGTH));
      for (let i = firstBit; i < n && count < MAX_BLOCKS; i++) {
        // This bit's centre x.
        const x = START_X + travelled - (i + 0.5) * BIT_LENGTH;
        if (x < START_X) break; // still inside the phone: this and later bits not sent yet
        if (x > END_X) continue; // already past the headphones
        const afterNoise = x > 0 && flipped[i];
        const bit = afterNoise ? 1 - packet.bits[i] : packet.bits[i];
        // Tall for 1, short for 0.
        const height = bit ? 0.6 : 0.18;
        // Place the dummy: bottom of the block sits at height 2.3.
        dummy.position.set(x, 2.3 + height / 2, 0);
        // The box is 1 tall, so scaling y by `height` makes it that tall.
        dummy.scale.set(1, height, 1);
        // Combine position + rotation + scale into one 4x4 matrix.
        dummy.updateMatrix();
        // Give that matrix and a colour to instance number `count`.
        blocks.setMatrixAt(count, dummy.matrix);
        blocks.setColorAt(count, colour.set(afterNoise ? RED : SECTIONS[packet.sectionOf[i]].css));
        count++;
      }
      // Only draw the instances we filled in this frame.
      blocks.count = count;
      // As with the ribbon, tell Three.js to re-upload the matrices and colours.
      blocks.instanceMatrix.needsUpdate = true;
      // instanceColor only exists after the first setColorAt, so check first.
      if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;

      // ----- Noise cloud grows with the noise slider and wobbles -----
      const size = 0.4 + noise * 6;
      // performance.now() = milliseconds since the page loaded; sin of it wobbles.
      // `(noise > 0)` is true/false, which counts as 1/0 in maths: no wobble at zero noise.
      cloud.scale.setScalar(size * (1 + Math.sin(performance.now() / 120) * 0.05 * (noise > 0)));
      cloud.material.opacity = noise > 0 ? 0.18 : 0.05;

      // ----- The "OK!" ball flies back to the phone -----
      if (ackProgress >= 0) {
        // Progress 0..1, takes about 1.25 seconds.
        ackProgress = Math.min(1, ackProgress + dt * 0.8);
        ack.visible = ackProgress < 1; // vanish when it lands
        // x: LERP (linear interpolation) slides from headphones to phone as progress goes 0 -> 1.
        // y: sin(progress * π) goes 0 -> 1 -> 0, making an arc like a thrown ball.
        ack.position.set(THREE.MathUtils.lerp(END_X, START_X, ackProgress), 0.5 + Math.sin(ackProgress * Math.PI) * 2.5, 0);
      }
    },
    /*
     * stop(): called by main.js when leaving the step. disposeGroup removes the
     * group from the scene and frees all its geometries, materials and textures
     * from GPU memory (Three.js does not free them by itself).
     */
    stop() {
      disposeGroup(group);
    },
  };
}
