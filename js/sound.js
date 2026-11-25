// js/sound.js : ALL THE SOUND (background music + sound effects)
//
// No audio files: every sound is made live with the Web Audio API.
//   tone(...) plays one note: an oscillator (makes the pitch) through a gain
//   (a volume knob that fades in and out so there's no click).
// Browsers only allow sound after a click, so main.js calls startAudio()
// when you press Start. Until then every function here quietly does nothing.

let ctx = null; // the AudioContext (the sound engine)
let master = null; // master volume: everything goes through here
let musicVolume = null; // the music's own volume, under the master
let muted = false;

// MIDI note number -> frequency in Hz. 69 = the A above middle C = 440 Hz.
const freq = (note) => 440 * Math.pow(2, (note - 69) / 12);

/*
 * tone(hz, start, length, options): play one note.
 *   type    'sine' (soft), 'triangle' (flute-y), 'square' (buzzy)
 *   volume  0..1
 *   attack  seconds to fade in
 *   slideTo a pitch to slide to (for whooshes and pops)
 *   out     where to send it (master or the music volume)
 */
function tone(hz, start, length, { type = 'sine', volume = 0.2, attack = 0.01, slideTo, out = master } = {}) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(hz, start);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + length);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(out);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

// ----- Sound effects -----
// Each one is a few notes. `if (!ctx) return` = no sound before Start.
let lastTick = 0;
export const sfx = {
  click() {
    if (!ctx) return;
    tone(1100, ctx.currentTime, 0.06, { type: 'triangle', volume: 0.12 });
  },
  // Slider moved. Only every 40 ms, or dragging a slider would buzz.
  tick() {
    if (!ctx || ctx.currentTime - lastTick < 0.04) return;
    lastTick = ctx.currentTime;
    tone(1600, ctx.currentTime, 0.03, { volume: 0.05 });
  },
  // New step: a rising whoosh.
  whoosh() {
    if (!ctx) return;
    tone(250, ctx.currentTime, 0.35, { volume: 0.12, attack: 0.08, slideTo: 900 });
    tone(375, ctx.currentTime, 0.35, { type: 'triangle', volume: 0.05, attack: 0.08, slideTo: 1350 });
  },
  // Picked something up / put it down.
  grab() {
    if (!ctx) return;
    tone(500, ctx.currentTime, 0.1, { volume: 0.15, slideTo: 900 });
  },
  drop() {
    if (!ctx) return;
    tone(700, ctx.currentTime, 0.12, { volume: 0.12, slideTo: 350 });
  },
  // Start button: a happy rising arpeggio.
  start() {
    if (!ctx) return;
    [72, 76, 79, 84].forEach((n, i) => tone(freq(n), ctx.currentTime + i * 0.08, 0.3, { type: 'triangle', volume: 0.15 }));
  },
  // Finish: a little fanfare.
  finish() {
    if (!ctx) return;
    [72, 76, 79, 84, 79, 84].forEach((n, i) => tone(freq(n), ctx.currentTime + i * 0.11, 0.4, { type: 'triangle', volume: 0.15 }));
  },
};

// ----- Background music: a different little tune for each step -----
// chords: 4 chords (MIDI notes), each lasts one bar (8 eighth-notes).
// arp:    which note of the chord to play on each eighth-note (an "arpeggio").
// Step 6 has null: it plays its own music (which stutters on purpose).
const SONGS = [
  { bpm: 84, chords: [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 67]], arp: [0, 1, 2, 3, 2, 1, 0, 2] }, // dreamy waves
  { bpm: 112, chords: [[62, 65, 69], [55, 59, 62], [60, 64, 67], [57, 61, 64]], arp: [0, 2, 1, 2, 0, 2, 1, 2] }, // bouncy hopping
  { bpm: 96, chords: [[64, 67, 71], [60, 64, 67], [55, 59, 62], [62, 66, 69]], arp: [0, 1, 2, 1] }, // curious searching
  { bpm: 76, chords: [[57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]], arp: [0, 1, 2, 1, 2, 1] }, // secret pairing
  { bpm: 120, chords: [[53, 57, 60], [55, 59, 62], [52, 55, 59], [57, 60, 64]], arp: [0, 0, 2, 1, 0, 2, 1, 2] }, // techy data
  null,
];
let song = null; // the tune playing now (null = silence)
let beat = 0; // which eighth-note we're on
let nextBeatTime = 0; // when (on the audio clock) the next eighth-note plays

// Called by main.js on every step change.
export function playMusicFor(stepIndex) {
  song = SONGS[stepIndex] || null;
  beat = 0;
  setMusicConnected(true); // a new step starts with music back on
}

// Out of reach = no music. Steps call this when the signal is lost or found.
// The music volume fades over 0.3 s instead of cutting with a click.
export function setMusicConnected(connected) {
  if (!musicVolume) return;
  musicVolume.gain.setTargetAtTime(connected ? 0.5 : 0, ctx.currentTime, 0.1);
}

// Every 50 ms, book in any notes due in the next 0.2 s. Booking slightly
// ahead keeps the rhythm steady even if the page is busy for a moment.
function scheduleMusic() {
  if (!song) return;
  const eighth = 30 / song.bpm; // seconds per eighth-note
  if (nextBeatTime < ctx.currentTime) nextBeatTime = ctx.currentTime + 0.05;
  while (nextBeatTime < ctx.currentTime + 0.2) {
    const chord = song.chords[Math.floor(beat / 8) % song.chords.length];
    // First beat of a bar: a soft chord pad and a bass note.
    if (beat % 8 === 0) {
      chord.forEach((n) => tone(freq(n), nextBeatTime, eighth * 8, { type: 'triangle', volume: 0.04, attack: 0.5, out: musicVolume }));
      tone(freq(chord[0] - 24), nextBeatTime, eighth * 6, { type: 'triangle', volume: 0.18, attack: 0.05, out: musicVolume });
    }
    // Every beat: one plucky arpeggio note, an octave up.
    const note = chord[song.arp[beat % song.arp.length] % chord.length] + 12;
    tone(freq(note), nextBeatTime, eighth * 1.6, { volume: 0.09, out: musicVolume });
    nextBeatTime += eighth;
    beat++;
  }
}

// Turn sound on (must be called from a click).
export function startAudio() {
  if (ctx) return;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.6;
  master.connect(ctx.destination);
  musicVolume = ctx.createGain();
  musicVolume.gain.value = 0.5;
  musicVolume.connect(master);
  setInterval(scheduleMusic, 50);
}

// Mute button: returns true if now muted.
export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.6;
  return muted;
}
